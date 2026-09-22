/**
 * Framer - video frame size from an MP4 / MOV header (ExtendScript / ES3)
 * ----------------------------------------------------------------------
 * Premiere's metadata does not reliably carry a clip's pixel size to scripts,
 * and everything Framer computes depends on it. MP4 and MOV are both ISO base
 * media files, so the size can be read straight out of the file: find the
 * moov box, walk its trak boxes, and take the first tkhd whose width and height
 * are non-zero (audio tracks carry 0x0).
 *
 * Only headers are read - a few hundred bytes wherever the boxes sit, never
 * the media data - so this is cheap even on a multi-gigabyte recording whose
 * moov box sits at the end of the file.
 *
 * The parser works over a reader {length, read(pos, count)} rather than a File
 * so it can be tested outside Premiere.
 */

/** Big-endian unsigned 32-bit int from a byte string. */
function fIsoU32(bytes, at) {
    // Multiply the top byte instead of shifting it, so values past 2^31 stay
    // positive in ES3's signed 32-bit shift arithmetic.
    return (bytes.charCodeAt(at) & 255) * 16777216 +
           ((bytes.charCodeAt(at + 1) & 255) << 16) +
           ((bytes.charCodeAt(at + 2) & 255) << 8) +
           (bytes.charCodeAt(at + 3) & 255);
}

/**
 * Visit the boxes between start and end. visit(type, bodyStart, bodyEnd)
 * returns true to stop scanning siblings.
 */
function fIsoEachBox(reader, start, end, visit) {
    var pos = start;
    var guard = 0;
    while (pos + 8 <= end && guard < 100000) {
        guard++;
        var head = reader.read(pos, 16);
        if (!head || head.length < 8) { return; }

        var size = fIsoU32(head, 0);
        var type = head.substr(4, 4);
        var headerLength = 8;

        if (size === 1) {
            // 64-bit size follows the type: used by large mdat boxes.
            if (head.length < 16) { return; }
            size = fIsoU32(head, 8) * 4294967296 + fIsoU32(head, 12);
            headerLength = 16;
        } else if (size === 0) {
            size = end - pos;             // box runs to the end of its parent
        }

        if (size < headerLength || pos + size > end + 8) { return; }   // corrupt
        if (visit(type, pos + headerLength, Math.min(pos + size, end)) === true) { return; }
        pos += size;
    }
}

/**
 * Display size of the first video track, or null.
 * A 90 or 270 degree rotation matrix (phone footage) swaps width and height,
 * because that is how Premiere presents the clip.
 */
function fIsoVideoSize(reader) {
    if (!reader || !reader.length) { return null; }
    var found = null;

    fIsoEachBox(reader, 0, reader.length, function (type, moovStart, moovEnd) {
        if (type !== 'moov') { return false; }

        fIsoEachBox(reader, moovStart, moovEnd, function (trakType, trakStart, trakEnd) {
            if (trakType !== 'trak') { return false; }

            fIsoEachBox(reader, trakStart, trakEnd, function (boxType, bodyStart, bodyEnd) {
                if (boxType !== 'tkhd') { return false; }

                var body = reader.read(bodyStart, Math.min(96, bodyEnd - bodyStart));
                // Version 1 widens the three time fields to 64 bits.
                var sizeAt = ((body.charCodeAt(0) & 255) === 1) ? 88 : 76;
                if (body.length < sizeAt + 8) { return true; }

                var width = fIsoU32(body, sizeAt) / 65536;      // 16.16 fixed point
                var height = fIsoU32(body, sizeAt + 4) / 65536;
                if (width > 0 && height > 0) {
                    // Matrix a and d are both zero when the track is rotated a
                    // quarter turn.
                    var matrixAt = sizeAt - 36;
                    var rotated = fIsoU32(body, matrixAt) === 0 && fIsoU32(body, matrixAt + 16) === 0;
                    found = rotated
                        ? { width: Math.round(height), height: Math.round(width), rotated: true }
                        : { width: Math.round(width), height: Math.round(height), rotated: false };
                }
                return true;                                   // one tkhd per trak
            });
            return found !== null;
        });
        return true;                                           // one moov per file
    });

    return found;
}

/** A reader over a file on disk, or null if it cannot be opened. */
function fIsoFileReader(path) {
    var file = new File(path);
    if (!file.exists) { return null; }
    file.encoding = 'BINARY';
    if (!file.open('r')) { return null; }
    return {
        length: file.length,
        read: function (pos, count) {
            if (!file.seek(pos, 0)) { return ''; }
            return file.read(count);
        },
        close: function () { file.close(); }
    };
}

/** Frame size of a video file on disk, or null. Never throws. */
function fIsoVideoSizeOfFile(path) {
    var reader = null;
    try {
        reader = fIsoFileReader(path);
        return reader ? fIsoVideoSize(reader) : null;
    } catch (e) {
        return null;
    } finally {
        if (reader) { try { reader.close(); } catch (e2) {} }
    }
}
