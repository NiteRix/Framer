/**
 * Framer - Premiere Pro host script (ExtendScript / ES3)
 * -----------------------------------------------------
 * Everything that touches the Premiere DOM lives here. The panel does the
 * geometry and hands over a plan; this file creates the vertical sequence,
 * stacks one copy of the source clip per layer, and writes Crop and Motion
 * values onto each copy.
 *
 * Every entry point returns a JSON string: {"ok":true, ...} or
 * {"ok":false,"error":"..."} plus a "log" array, so failures surface in the
 * panel instead of in a modal alert nobody can copy out of.
 *
 * Deliberately defensive: names of effects and parameters are localised, and
 * several APIs came and went across versions, so lookups try a few spellings
 * and fall back to documented parameter ordering.
 */

// @include "json2.jsx"
// @include "mp4dims.jsx"

// ---------------------------------------------------------------------------
// Small helpers (ES3 - no forEach/map/indexOf on arrays, no let/const)
// ---------------------------------------------------------------------------

var FRAMER_VERSION = '1.0.1';

function fLog(log, msg) {
    if (log) { log.push(String(msg)); }
}

function fIndexOf(arr, value) {
    for (var i = 0; i < arr.length; i++) { if (arr[i] === value) { return i; } }
    return -1;
}

function fSafe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
}

function fStr(v) {
    if (v === undefined || v === null) { return ''; }
    return String(v);
}

function fResult(obj, log) {
    obj.log = log || [];
    obj.version = FRAMER_VERSION;
    return JSON.stringify(obj);
}

function fError(message, log) {
    return fResult({ ok: false, error: fStr(message) }, log);
}

/** Lowercase, strip spaces - so "Gaussian Blur" matches "gaussianblur". */
function fKey(s) {
    return fStr(s).toLowerCase().replace(/[\s_\-]/g, '');
}

// ---------------------------------------------------------------------------
// Project item / source discovery
// ---------------------------------------------------------------------------

/** Depth-first walk of the project panel, collecting every footage item. */
function fAllProjectItems(root, out) {
    out = out || [];
    var children = fSafe(function () { return root.children; }, null);
    if (!children) { return out; }
    for (var i = 0; i < children.numItems; i++) {
        var item = children[i];
        out.push(item);
        fAllProjectItems(item, out);
    }
    return out;
}

function fFindProjectItemByNodeId(nodeId) {
    var items = fAllProjectItems(app.project.rootItem, []);
    for (var i = 0; i < items.length; i++) {
        if (fSafe(function () { return items[i].nodeId; }, null) === nodeId) { return items[i]; }
    }
    return null;
}

/**
 * Source pixel dimensions for a project item. The DOM has no direct property,
 * so try, in order:
 *   1. XMP videoFrameSize - written either as attributes or as child elements
 *   2. the project's Video Info column, e.g. "1920 x 1080 (1.0)"
 *   3. the MP4/MOV header itself, which needs no metadata at all
 * Returns null when none of those work; the panel then falls back to the size
 * of the frame Premiere renders, and says so.
 */
function fSourceDimensions(projectItem, log) {
    var xmp = fSafe(function () { return projectItem.getXMPMetadata(); }, '');
    if (xmp) {
        var w = xmp.match(/stDim:w\s*=\s*"(\d+)"/) || xmp.match(/<stDim:w>\s*(\d+)\s*</);
        var h = xmp.match(/stDim:h\s*=\s*"(\d+)"/) || xmp.match(/<stDim:h>\s*(\d+)\s*</);
        if (w && h && fPlausibleSize(w[1], h[1])) {
            fLog(log, 'source dimensions from XMP: ' + w[1] + 'x' + h[1]);
            return { width: parseInt(w[1], 10), height: parseInt(h[1], 10), from: 'xmp' };
        }
        fLog(log, 'XMP carries no frame size');
    } else {
        fLog(log, 'no XMP metadata on this item');
    }

    var meta = fSafe(function () { return projectItem.getProjectMetadata(); }, '');
    if (meta) {
        var m = meta.match(/Column\.Intrinsic\.(?:VideoInfo|ImageSize)[^>]*>\s*(\d+)\s*[xX×]\s*(\d+)/);
        if (m && fPlausibleSize(m[1], m[2])) {
            fLog(log, 'source dimensions from project metadata: ' + m[1] + 'x' + m[2]);
            return { width: parseInt(m[1], 10), height: parseInt(m[2], 10), from: 'projectMetadata' };
        }
        fLog(log, 'project metadata carries no Video Info size');
    }

    var mediaPath = fMediaPath(projectItem);
    if (mediaPath) {
        var header = fIsoVideoSizeOfFile(mediaPath);
        if (header && fPlausibleSize(header.width, header.height)) {
            fLog(log, 'source dimensions from the file header: ' + header.width + 'x' + header.height +
                      (header.rotated ? ' (rotated track)' : ''));
            return { width: header.width, height: header.height, from: 'fileHeader' };
        }
        fLog(log, 'file header unreadable (not MP4/MOV, or no video track)');
    }

    fLog(log, 'could not determine source dimensions');
    return null;
}

function fPlausibleSize(w, h) {
    var width = Number(w), height = Number(h);
    return width >= 16 && height >= 16 && width <= 16384 && height <= 16384;
}

function fMediaPath(projectItem) {
    return fSafe(function () { return projectItem.getMediaPath(); }, '');
}

/**
 * What should we reframe? Preference order:
 *   1. a clip selected on the active sequence (keeps its trim)
 *   2. a single item selected in the project panel
 */
function fResolveSource(log) {
    var seq = fSafe(function () { return app.project.activeSequence; }, null);

    if (seq) {
        var selection = fSafe(function () { return seq.getSelection(); }, null);
        if (selection && selection.length > 0) {
            for (var i = 0; i < selection.length; i++) {
                var trackItem = selection[i];
                var pItem = fSafe(function () { return trackItem.projectItem; }, null);
                if (!pItem) { continue; }
                fLog(log, 'source: clip selected on sequence "' + fSafe(function () { return seq.name; }, '?') + '"');
                return {
                    projectItem: pItem,
                    trackItem: trackItem,
                    origin: 'sequenceSelection',
                    inPoint: fSafe(function () { return trackItem.inPoint.seconds; }, 0),
                    outPoint: fSafe(function () { return trackItem.outPoint.seconds; }, 0),
                    // Sequence time, which is what a rendered still is addressed by.
                    seqStart: fSafe(function () { return trackItem.start.seconds; }, null),
                    seqEnd: fSafe(function () { return trackItem.end.seconds; }, null),
                    sequence: seq
                };
            }
        }
    }

    var projSel = fSafe(function () { return app.project.getSelection(); }, null);
    if (projSel && projSel.length > 0) {
        for (var j = 0; j < projSel.length; j++) {
            var candidate = projSel[j];
            var clipType = fSafe(function () { return ProjectItemType.CLIP; }, 1);
            if (fSafe(function () { return candidate.type; }, -1) === clipType ||
                fMediaPath(candidate)) {
                fLog(log, 'source: item selected in the project panel');
                return {
                    projectItem: candidate,
                    trackItem: null,
                    origin: 'projectSelection',
                    inPoint: fSafe(function () { return candidate.getInPoint().seconds; }, 0),
                    outPoint: fSafe(function () { return candidate.getOutPoint().seconds; }, 0),
                    sequence: seq
                };
            }
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// Entry point: diagnostics
// ---------------------------------------------------------------------------

function framerDiagnostics() {
    var log = [];
    try {
        var qeOk = false;
        try { app.enableQE(); qeOk = (typeof qe !== 'undefined' && !!qe.project); } catch (e) { qeOk = false; }

        var seq = fSafe(function () { return app.project.activeSequence; }, null);
        var caps = {
            createNewSequenceFromClips: fSafe(function () { return typeof app.project.createNewSequenceFromClips === 'function'; }, false),
            createNewSequence: fSafe(function () { return typeof app.project.createNewSequence === 'function'; }, false),
            sequenceGetSettings: !!(seq && fSafe(function () { return typeof seq.getSettings === 'function'; }, false)),
            sequenceSetSettings: !!(seq && fSafe(function () { return typeof seq.setSettings === 'function'; }, false)),
            exportFramePNG: !!(seq && fSafe(function () { return typeof seq.exportFramePNG === 'function'; }, false)),
            exportFrameJPEG: !!(seq && fSafe(function () { return typeof seq.exportFrameJPEG === 'function'; }, false)),
            qe: qeOk
        };

        return fResult({
            ok: true,
            app: {
                version: fSafe(function () { return app.version; }, '?'),
                build: fSafe(function () { return app.build; }, '?'),
                locale: fSafe(function () { return $.locale; }, '?')
            },
            project: {
                open: !!fSafe(function () { return app.project; }, null),
                name: fSafe(function () { return app.project.name; }, ''),
                path: fSafe(function () { return app.project.path; }, ''),
                sequenceCount: fSafe(function () { return app.project.sequences.numSequences; }, 0)
            },
            activeSequence: seq ? {
                name: fSafe(function () { return seq.name; }, ''),
                width: fSafe(function () { return seq.frameSizeHorizontal; }, null),
                height: fSafe(function () { return seq.frameSizeVertical; }, null),
                videoTracks: fSafe(function () { return seq.videoTracks.numTracks; }, 0),
                audioTracks: fSafe(function () { return seq.audioTracks.numTracks; }, 0)
            } : null,
            capabilities: caps
        }, log);
    } catch (e) {
        return fError('diagnostics failed: ' + e, log);
    }
}

// ---------------------------------------------------------------------------
// Entry point: inspect the current selection
// ---------------------------------------------------------------------------

function framerInspect() {
    var log = [];
    try {
        if (!app.project) { return fError('No project is open.', log); }

        var src = fResolveSource(log);
        if (!src) {
            return fError('Select the horizontal clip first - either on a sequence or in the Project panel.', log);
        }

        var dims = fSourceDimensions(src.projectItem, log);
        var duration = fSafe(function () { return src.projectItem.getOutPoint().seconds - src.projectItem.getInPoint().seconds; }, 0);

        return fResult({
            ok: true,
            source: {
                name: fSafe(function () { return src.projectItem.name; }, ''),
                nodeId: fSafe(function () { return src.projectItem.nodeId; }, ''),
                mediaPath: fMediaPath(src.projectItem),
                width: dims ? dims.width : null,
                height: dims ? dims.height : null,
                dimensionsFrom: dims ? dims.from : null,
                origin: src.origin,
                inPoint: src.inPoint,
                outPoint: src.outPoint,
                clipDuration: src.outPoint - src.inPoint,
                seqStart: (src.seqStart === undefined) ? null : src.seqStart,
                seqEnd: (src.seqEnd === undefined) ? null : src.seqEnd,
                mediaDuration: duration,
                hasAudio: fSafe(function () { return src.projectItem.hasAudio(); }, false),
                hasVideo: fSafe(function () { return src.projectItem.hasVideo(); }, true)
            },
            sequence: src.sequence ? {
                name: fSafe(function () { return src.sequence.name; }, ''),
                width: fSafe(function () { return src.sequence.frameSizeHorizontal; }, null),
                height: fSafe(function () { return src.sequence.frameSizeVertical; }, null)
            } : null
        }, log);
    } catch (e) {
        return fError('inspect failed: ' + e, log);
    }
}

// ---------------------------------------------------------------------------
// Entry point: render reference stills from the active sequence
// ---------------------------------------------------------------------------

var STILL_PREFIX = 'framer_still_';

function fIsWindows() {
    return fStr(fSafe(function () { return $.os; }, '')).indexOf('Windows') !== -1;
}

/** Remove stills left over from earlier renders; they are only ever temporary. */
function fCleanStills(folder) {
    var old = fSafe(function () { return folder.getFiles(STILL_PREFIX + '*'); }, null);
    if (!old) { return; }
    for (var i = 0; i < old.length; i++) {
        fSafe(function () { old[i].remove(); return true; }, false);
    }
}

/**
 * Wait for Premiere to finish writing one of `paths`. The export call can
 * return before the file is on disk, and a file that is still growing would
 * load as a broken image, so it has to exist and hold its size across a check.
 */
function fWaitForFile(paths, timeoutMs) {
    var waited = 0;
    var step = 100;
    var lastSize = -1;
    while (waited <= timeoutMs) {
        for (var i = 0; i < paths.length; i++) {
            var f = new File(paths[i]);
            if (f.exists && f.length > 0) {
                if (f.length === lastSize) { return f; }
                lastSize = f.length;
            }
        }
        $.sleep(step);
        waited += step;
    }
    return null;
}

/**
 * Render the frame under the playhead (optionally moving it first).
 *
 * Premiere exposes frame export on the QE sequence, not the DOM one:
 * exportFramePNG(timecode, path) takes a timecode string and a path WITHOUT an
 * extension, and appends ".png" itself. That is the call Adobe's own sample
 * panel makes. The DOM Sequence.exportFramePNG is tried afterwards only
 * because it has appeared in some builds.
 */
function fRenderFrame(seq, qeSeq, seconds, folder, index, log) {
    if (seconds !== null && seconds !== undefined) {
        var target = new Time();
        target.seconds = Number(seconds);
        fSafe(function () { seq.setPlayerPosition(target.ticks); return true; }, false);
    }
    var at = fSafe(function () { return seq.getPlayerPosition().seconds; }, seconds);

    var sep = fIsWindows() ? '\\' : '/';
    var base = folder.fsName + sep + STILL_PREFIX + (new Date()).getTime() + '_' + index;

    var attempts = [];
    if (qeSeq) {
        attempts.push({ label: 'QE exportFramePNG', outputs: [base + '.png', base], run: function () {
            qeSeq.exportFramePNG(qeSeq.CTI.timecode, base);
        } });
        attempts.push({ label: 'QE exportFrameJPEG', outputs: [base + '.jpg', base], run: function () {
            qeSeq.exportFrameJPEG(qeSeq.CTI.timecode, base);
        } });
    }
    attempts.push({ label: 'Sequence.exportFramePNG', outputs: [base + '.png'], run: function () {
        var t = seq.getPlayerPosition();
        seq.exportFramePNG(t.ticks, base + '.png');
    } });

    for (var i = 0; i < attempts.length; i++) {
        var attempt = attempts[i];
        try {
            attempt.run();
        } catch (e) {
            fLog(log, attempt.label + ' unavailable: ' + e);
            continue;
        }
        var file = fWaitForFile(attempt.outputs, 8000);
        if (file) {
            if (index === 0) { fLog(log, 'stills rendered with ' + attempt.label); }
            return { path: file.fsName, seconds: at };
        }
        fLog(log, attempt.label + ' ran but no file appeared');
    }
    return null;
}

/**
 * framerExportStills({times: [seconds, ...]})
 *
 * Render frames of the active sequence to disk, at sequence times. With no
 * times, renders the frame under the playhead. The playhead is put back where
 * it was afterwards.
 *
 * This is the primary way the panel gets a reference frame: Premiere decodes
 * whatever it can import, while the panel's embedded browser cannot decode
 * most camera and capture codecs.
 */
function framerExportStills(argJson) {
    var log = [];
    var seq = null;
    var original = null;
    try {
        var args = JSON.parse(argJson || '{}');
        seq = fSafe(function () { return app.project.activeSequence; }, null);
        if (!seq) { return fError('No active sequence to render a still from.', log); }

        var qeSeq = fSafe(function () { app.enableQE(); return qe.project.getActiveSequence(); }, null);
        if (!qeSeq) { fLog(log, 'QE is unavailable - trying the standard DOM only'); }

        var folder = new Folder(Folder.temp.fsName + '/framer');
        if (!folder.exists) { folder.create(); }
        fCleanStills(folder);

        var times = (args.times && args.times.length) ? args.times : [null];
        // Only remember (and later restore) the playhead if we are going to move it.
        if (times[0] !== null) { original = fSafe(function () { return seq.getPlayerPosition(); }, null); }

        var stills = [];
        for (var i = 0; i < times.length; i++) {
            var rendered = fRenderFrame(seq, qeSeq, times[i], folder, i, log);
            if (rendered) { stills.push(rendered); }
            else if (i === 0) { break; }           // if the first fails, the rest will too
        }

        if (!stills.length) {
            return fError('Premiere would not render a still frame from the active sequence.', log);
        }
        if (stills.length < times.length) {
            fLog(log, 'rendered ' + stills.length + ' of ' + times.length + ' stills');
        }

        return fResult({
            ok: true,
            stills: stills,
            sequence: fSafe(function () { return seq.name; }, ''),
            width: fSafe(function () { return seq.frameSizeHorizontal; }, null),
            height: fSafe(function () { return seq.frameSizeVertical; }, null)
        }, log);
    } catch (e) {
        return fError('still export failed: ' + e, log);
    } finally {
        if (seq && original) {
            fSafe(function () { seq.setPlayerPosition(original.ticks); return true; }, false);
        }
    }
}

// ---------------------------------------------------------------------------
// Sequence creation
// ---------------------------------------------------------------------------

function fClearAllTrackItems(seq, log) {
    var removed = 0;
    var tracks = ['videoTracks', 'audioTracks'];
    for (var t = 0; t < tracks.length; t++) {
        var collection = fSafe(function () { return seq[tracks[t]]; }, null);
        if (!collection) { continue; }
        for (var i = 0; i < collection.numTracks; i++) {
            var track = collection[i];
            // Walk backwards: removing shifts the collection.
            for (var c = fSafe(function () { return track.clips.numItems; }, 0) - 1; c >= 0; c--) {
                var clip = fSafe(function () { return track.clips[c]; }, null);
                if (!clip) { continue; }
                var done = false;
                try { clip.remove(false, false); done = true; } catch (e1) {}
                if (!done) { try { clip.remove(0, 0); done = true; } catch (e2) {} }
                if (done) { removed++; }
            }
        }
    }
    fLog(log, 'cleared ' + removed + ' clip(s) from the new sequence');
    return removed;
}

function fApplySequenceSettings(seq, width, height, log) {
    if (!fSafe(function () { return typeof seq.getSettings === 'function'; }, false)) {
        fLog(log, 'this build has no Sequence.getSettings - frame size left unchanged');
        return false;
    }
    var settings = fSafe(function () { return seq.getSettings(); }, null);
    if (!settings) { fLog(log, 'could not read sequence settings'); return false; }

    try {
        settings.videoFrameWidth = width;
        settings.videoFrameHeight = height;
    } catch (e) {
        fLog(log, 'could not set frame size on settings object: ' + e);
        return false;
    }

    // Keep previews at the sequence size, otherwise some builds reject the
    // settings or render previews at the old aspect.
    fSafe(function () { settings.previewFrameWidth = width; return true; }, false);
    fSafe(function () { settings.previewFrameHeight = height; return true; }, false);
    fSafe(function () { settings.videoPixelAspectRatio = 1; return true; }, false);

    var applied = false;
    try { seq.setSettings(settings); applied = true; } catch (e2) { fLog(log, 'setSettings failed: ' + e2); }

    if (applied) {
        var nowW = fSafe(function () { return seq.frameSizeHorizontal; }, null);
        var nowH = fSafe(function () { return seq.frameSizeVertical; }, null);
        fLog(log, 'sequence frame size is now ' + nowW + 'x' + nowH);
        if (nowW && nowH && (Number(nowW) !== Number(width) || Number(nowH) !== Number(height))) {
            fLog(log, 'WARNING: requested ' + width + 'x' + height + ' but Premiere reports ' + nowW + 'x' + nowH);
        }
    }
    return applied;
}

function fCreateVerticalSequence(name, projectItem, width, height, log) {
    var seq = null;

    if (fSafe(function () { return typeof app.project.createNewSequenceFromClips === 'function'; }, false)) {
        seq = fSafe(function () {
            return app.project.createNewSequenceFromClips(name, [projectItem], app.project.rootItem);
        }, null);
        if (!seq) {
            seq = fSafe(function () { return app.project.createNewSequenceFromClips(name, [projectItem]); }, null);
        }
        if (seq) { fLog(log, 'created sequence via createNewSequenceFromClips'); }
    }

    if (!seq && fSafe(function () { return typeof app.project.createNewSequence === 'function'; }, false)) {
        seq = fSafe(function () { return app.project.createNewSequence(name, ''); }, null);
        if (seq) { fLog(log, 'created sequence via createNewSequence'); }
    }

    if (!seq) { return null; }

    fSafe(function () { app.project.activeSequence = seq; return true; }, false);
    fClearAllTrackItems(seq, log);
    fApplySequenceSettings(seq, width, height, log);
    return seq;
}

/** Make sure the sequence has at least `needed` video tracks. */
function fEnsureVideoTracks(seq, needed, log) {
    var have = fSafe(function () { return seq.videoTracks.numTracks; }, 0);
    if (have >= needed) { return have; }

    var missing = needed - have;
    try {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        // QE: addTracks(videoCount, videoInsertIndex, audioCount, audioType, audioInsertIndex)
        var added = false;
        try { qeSeq.addTracks(missing, have, 0, 1, 0); added = true; } catch (e1) {}
        if (!added) { try { qeSeq.addTracks(missing); added = true; } catch (e2) {} }
        if (added) { fLog(log, 'added ' + missing + ' video track(s)'); }
    } catch (e) {
        fLog(log, 'could not add video tracks: ' + e);
    }

    have = fSafe(function () { return seq.videoTracks.numTracks; }, have);
    if (have < needed) {
        fLog(log, 'WARNING: wanted ' + needed + ' video tracks, sequence has ' + have);
    }
    return have;
}

// ---------------------------------------------------------------------------
// Effects: add via QE, set parameters via the standard DOM
// ---------------------------------------------------------------------------

/** First real clip on a QE video track (QE counts gaps as items too). */
function fQEClipOnTrack(qeTrack) {
    var count = fSafe(function () { return qeTrack.numItems; }, 0);
    for (var i = 0; i < count; i++) {
        var item = fSafe(function () { return qeTrack.getItemAt(i); }, null);
        if (!item) { continue; }
        var type = fKey(fSafe(function () { return item.type; }, ''));
        if (type === 'clip') { return item; }
        // Older builds do not report a type: fall back to anything named.
        if (!type && fSafe(function () { return item.name; }, '')) { return item; }
    }
    return null;
}

function fAddVideoEffect(trackIndex, effectNames, log) {
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) { fLog(log, 'QE has no active sequence'); return false; }

    var qeTrack = fSafe(function () { return qeSeq.getVideoTrackAt(trackIndex); }, null);
    if (!qeTrack) { fLog(log, 'QE could not reach video track ' + trackIndex); return false; }

    var qeClip = fQEClipOnTrack(qeTrack);
    if (!qeClip) { fLog(log, 'QE found no clip on video track ' + trackIndex); return false; }

    for (var i = 0; i < effectNames.length; i++) {
        var fx = fSafe(function () { return qe.project.getVideoEffectByName(effectNames[i]); }, null);
        if (!fx) { continue; }
        var ok = fSafe(function () { qeClip.addVideoEffect(fx); return true; }, false);
        if (ok) { fLog(log, 'applied effect "' + effectNames[i] + '" to V' + (trackIndex + 1)); return true; }
    }

    fLog(log, 'WARNING: could not apply effect (' + effectNames.join(' / ') + ') to V' + (trackIndex + 1) +
              ' - it may be named differently in this language');
    return false;
}

function fFindComponent(trackItem, names) {
    var comps = fSafe(function () { return trackItem.components; }, null);
    if (!comps) { return null; }
    var wanted = [];
    for (var n = 0; n < names.length; n++) { wanted.push(fKey(names[n])); }

    for (var i = 0; i < comps.numItems; i++) {
        var c = comps[i];
        var display = fKey(fSafe(function () { return c.displayName; }, ''));
        var match = fKey(fSafe(function () { return c.matchName; }, ''));
        if (fIndexOf(wanted, display) >= 0 || fIndexOf(wanted, match) >= 0) { return c; }
        // matchName often carries a prefix, e.g. "AE.ADBE Gaussian Blur 2".
        for (var w = 0; w < wanted.length; w++) {
            if (match && match.length && match.indexOf(wanted[w]) >= 0) { return c; }
        }
    }
    return null;
}

/**
 * Find a parameter by name, falling back to its documented position in the
 * effect's parameter list. The fallback is what keeps this working on
 * non-English installations, where displayName is localised.
 */
function fFindProperty(component, names, fallbackIndex) {
    var props = fSafe(function () { return component.properties; }, null);
    if (!props) { return null; }
    var wanted = [];
    for (var n = 0; n < names.length; n++) { wanted.push(fKey(names[n])); }

    for (var i = 0; i < props.numItems; i++) {
        var p = props[i];
        var display = fKey(fSafe(function () { return p.displayName; }, ''));
        if (fIndexOf(wanted, display) >= 0) { return p; }
    }
    if (fallbackIndex !== undefined && fallbackIndex !== null) {
        var byIndex = fSafe(function () { return props[fallbackIndex]; }, null);
        if (byIndex) { return byIndex; }
    }
    return null;
}

function fSetProperty(component, names, fallbackIndex, value, label, log) {
    var prop = fFindProperty(component, names, fallbackIndex);
    if (!prop) {
        fLog(log, 'WARNING: parameter not found: ' + label);
        return false;
    }
    var ok = fSafe(function () { prop.setValue(value, true); return true; }, false);
    if (!ok) { ok = fSafe(function () { prop.setValue(value); return true; }, false); }
    if (!ok) { fLog(log, 'WARNING: could not set ' + label); }
    return ok;
}

var FX_NAMES = {
    motion:  ['Motion', 'AE.ADBE Motion', 'ADBE Motion'],
    opacity: ['Opacity', 'AE.ADBE Opacity', 'ADBE Opacity'],
    crop:    ['Crop', 'AE.ADBE Crop', 'ADBE Crop'],
    blur:    ['Gaussian Blur', 'AE.ADBE Gaussian Blur 2', 'ADBE Gaussian Blur 2', 'Gaussian Blur (Legacy)'],
    shadow:  ['Drop Shadow', 'AE.ADBE Drop Shadow', 'ADBE Drop Shadow']
};

/** Motion parameter order, used when displayName is localised. */
var MOTION_INDEX = { position: 0, scale: 1, scaleWidth: 2, uniformScale: 3, rotation: 4, anchor: 5 };
/** Crop parameter order: Left, Top, Right, Bottom, Zoom, Edge Feather. */
var CROP_INDEX = { left: 0, top: 1, right: 2, bottom: 3 };

function fApplyLayerTransform(trackItem, layer, cropUnits, log) {
    var applied = { crop: false, scale: false, position: false, blur: false, shadow: false };

    // --- Crop -------------------------------------------------------------
    if (layer.crop) {
        var cropComp = fFindComponent(trackItem, FX_NAMES.crop);
        if (!cropComp) {
            fLog(log, 'WARNING: Crop effect not present on the ' + layer.role + ' layer');
        } else {
            var k = (cropUnits === 'normalized') ? 0.01 : 1;
            var a = fSetProperty(cropComp, ['Left'], CROP_INDEX.left, layer.crop.left * k, 'Crop > Left', log);
            var b = fSetProperty(cropComp, ['Top'], CROP_INDEX.top, layer.crop.top * k, 'Crop > Top', log);
            var c = fSetProperty(cropComp, ['Right'], CROP_INDEX.right, layer.crop.right * k, 'Crop > Right', log);
            var d = fSetProperty(cropComp, ['Bottom'], CROP_INDEX.bottom, layer.crop.bottom * k, 'Crop > Bottom', log);
            applied.crop = a && b && c && d;
        }
    }

    // --- Motion -----------------------------------------------------------
    var motion = fFindComponent(trackItem, FX_NAMES.motion);
    if (!motion) {
        fLog(log, 'WARNING: Motion not found on the ' + layer.role + ' layer - cannot scale or position it');
    } else {
        // Uniform scale first, so setting Scale drives both axes.
        fSetProperty(motion, ['Uniform Scale'], MOTION_INDEX.uniformScale, true, 'Motion > Uniform Scale', log);
        applied.scale = fSetProperty(motion, ['Scale'], MOTION_INDEX.scale, layer.scale, 'Motion > Scale', log);
        applied.position = fSetProperty(motion, ['Position'], MOTION_INDEX.position,
                                        [layer.position[0], layer.position[1]], 'Motion > Position', log);
    }

    // --- Optional looks ---------------------------------------------------
    if (layer.blur > 0) {
        var blurComp = fFindComponent(trackItem, FX_NAMES.blur);
        if (blurComp) {
            applied.blur = fSetProperty(blurComp, ['Blurriness'], 0, layer.blur, 'Gaussian Blur > Blurriness', log);
            // Without this the blurred edges pull in transparency.
            fSetProperty(blurComp, ['Repeat Edge Pixels'], 2, true, 'Gaussian Blur > Repeat Edge Pixels', log);
        }
    }

    if (layer.shadow) {
        var shadowComp = fFindComponent(trackItem, FX_NAMES.shadow);
        if (shadowComp) {
            fSetProperty(shadowComp, ['Opacity'], 1, 55, 'Drop Shadow > Opacity', log);
            fSetProperty(shadowComp, ['Distance'], 3, 14, 'Drop Shadow > Distance', log);
            fSetProperty(shadowComp, ['Softness'], 4, 40, 'Drop Shadow > Softness', log);
            applied.shadow = true;
        }
    }

    return applied;
}

// ---------------------------------------------------------------------------
// Entry point: build the vertical sequence
// ---------------------------------------------------------------------------

/**
 * framerBuild(planJson)
 *
 * plan = {
 *   output: {width, height},
 *   layers: [ {role, track, crop|null, scale, position:[x,y], blur, shadow}, ... ],
 *   source: {nodeId},           // optional; falls back to the current selection
 *   trim:   {inPoint, outPoint}, // seconds, optional
 *   options:{ sequenceName, includeAudio, cropUnits, colorLabels }
 * }
 */
function framerBuild(planJson) {
    var log = [];
    var restore = null;
    try {
        if (!app.project) { return fError('No project is open.', log); }

        var plan = JSON.parse(planJson);
        if (!plan || !plan.layers || !plan.layers.length) { return fError('The plan has no layers.', log); }

        var options = plan.options || {};
        var cropUnits = options.cropUnits || 'percent';

        // --- resolve the source clip -------------------------------------
        var projectItem = null;
        var src = null;
        if (plan.source && plan.source.nodeId) {
            projectItem = fFindProjectItemByNodeId(plan.source.nodeId);
            if (projectItem) { fLog(log, 'source resolved by nodeId'); }
        }
        if (!projectItem) {
            src = fResolveSource(log);
            if (!src) { return fError('Select the horizontal clip first, then build again.', log); }
            projectItem = src.projectItem;
        }

        var sourceName = fSafe(function () { return projectItem.name; }, 'clip');

        // --- trim: applied to the project item, restored afterwards -------
        var trim = plan.trim || null;
        if (trim && trim.outPoint > trim.inPoint) {
            restore = {
                item: projectItem,
                inPoint: fSafe(function () { return projectItem.getInPoint().seconds; }, null),
                outPoint: fSafe(function () { return projectItem.getOutPoint().seconds; }, null)
            };
            var setIn = fSafe(function () { projectItem.setInPoint(trim.inPoint, 4); return true; }, false);
            if (!setIn) { setIn = fSafe(function () { projectItem.setInPoint(trim.inPoint); return true; }, false); }
            var setOut = fSafe(function () { projectItem.setOutPoint(trim.outPoint, 4); return true; }, false);
            if (!setOut) { setOut = fSafe(function () { projectItem.setOutPoint(trim.outPoint); return true; }, false); }
            fLog(log, (setIn && setOut)
                ? ('trimmed source to ' + trim.inPoint.toFixed(3) + 's - ' + trim.outPoint.toFixed(3) + 's')
                : 'WARNING: could not apply the trim - the full clip will be used');
        }

        // --- create the vertical sequence ---------------------------------
        var out = plan.output || { width: 1080, height: 1920 };
        var seqName = options.sequenceName || (sourceName + ' - Vertical');
        var seq = fCreateVerticalSequence(seqName, projectItem, out.width, out.height, log);
        if (!seq) { return fError('Premiere would not create a new sequence.', log); }

        fEnsureVideoTracks(seq, plan.layers.length, log);

        // --- stack one copy of the clip per layer -------------------------
        var results = [];
        var placed = 0;

        for (var i = 0; i < plan.layers.length; i++) {
            var layer = plan.layers[i];
            var trackIndex = (layer.track === undefined) ? i : layer.track;
            var track = fSafe(function () { return seq.videoTracks[trackIndex]; }, null);

            if (!track) {
                fLog(log, 'WARNING: no video track ' + (trackIndex + 1) + ' for the ' + layer.role + ' layer - skipped');
                results.push({ role: layer.role, track: trackIndex + 1, placed: false, reason: 'track missing' });
                continue;
            }

            var inserted = fSafe(function () { track.insertClip(projectItem, 0); return true; }, false);
            if (!inserted) {
                inserted = fSafe(function () { track.overwriteClip(projectItem, 0); return true; }, false);
            }
            if (!inserted) {
                fLog(log, 'WARNING: could not place the ' + layer.role + ' layer on V' + (trackIndex + 1));
                results.push({ role: layer.role, track: trackIndex + 1, placed: false, reason: 'insert failed' });
                continue;
            }
            placed++;

            // Effects must exist before their parameters can be written.
            if (layer.crop) { fAddVideoEffect(trackIndex, FX_NAMES.crop, log); }
            if (layer.blur > 0) { fAddVideoEffect(trackIndex, FX_NAMES.blur, log); }
            if (layer.shadow) { fAddVideoEffect(trackIndex, FX_NAMES.shadow, log); }

            var trackItem = fSafe(function () { return seq.videoTracks[trackIndex].clips[0]; }, null);
            if (!trackItem) {
                fLog(log, 'WARNING: placed the ' + layer.role + ' layer but could not read it back');
                results.push({ role: layer.role, track: trackIndex + 1, placed: true, transformed: false });
                continue;
            }

            var applied = fApplyLayerTransform(trackItem, layer, cropUnits, log);

            if (options.colorLabels !== false) {
                var label = (layer.role === 'webcam') ? 4 : (layer.role === 'gameplay' ? 2 : 8);
                fSafe(function () { trackItem.setColorLabel(label); return true; }, false);
            }

            results.push({
                role: layer.role,
                track: trackIndex + 1,
                placed: true,
                transformed: applied.scale && applied.position,
                applied: applied,
                duration: fSafe(function () { return trackItem.end.seconds - trackItem.start.seconds; }, null)
            });
        }

        // --- audio: exactly one copy --------------------------------------
        var audioAdded = false;
        if (options.includeAudio !== false && fSafe(function () { return projectItem.hasAudio(); }, false)) {
            var audioClips = 0;
            var aTracks = fSafe(function () { return seq.audioTracks.numTracks; }, 0);
            for (var a = 0; a < aTracks; a++) {
                audioClips += fSafe(function () { return seq.audioTracks[a].clips.numItems; }, 0);
            }
            if (audioClips > 0) {
                fLog(log, 'audio came across with the video (' + audioClips + ' clip(s))');
                audioAdded = true;
            } else if (aTracks > 0) {
                audioAdded = fSafe(function () { seq.audioTracks[0].insertClip(projectItem, 0); return true; }, false);
                fLog(log, audioAdded ? 'inserted audio on A1' : 'WARNING: could not insert audio - add it by hand if needed');
            }
        }

        if (!placed) { return fError('No layers could be placed in the new sequence.', log); }

        return fResult({
            ok: true,
            sequence: {
                name: fSafe(function () { return seq.name; }, seqName),
                width: fSafe(function () { return seq.frameSizeHorizontal; }, out.width),
                height: fSafe(function () { return seq.frameSizeVertical; }, out.height),
                videoTracks: fSafe(function () { return seq.videoTracks.numTracks; }, 0)
            },
            layers: results,
            placed: placed,
            audio: audioAdded
        }, log);

    } catch (e) {
        return fError('build failed: ' + e + (e.line ? (' (line ' + e.line + ')') : ''), log);
    } finally {
        // Leave the project item's in/out the way we found it.
        if (restore && restore.inPoint !== null) {
            fSafe(function () { restore.item.setInPoint(restore.inPoint, 4); return true; }, false);
            fSafe(function () { restore.item.setOutPoint(restore.outPoint, 4); return true; }, false);
        }
    }
}

// ---------------------------------------------------------------------------
// Entry point: Crop unit calibration
// ---------------------------------------------------------------------------

/**
 * Premiere's Crop parameters read as percentages in Effect Controls, but the
 * value a script writes has been reported as both 0-100 and 0-1 across
 * versions. This applies Crop to the selected clip and sets Left using the
 * panel's current assumption, so the user can confirm what Effect Controls
 * shows and flip the setting once if needed.
 */
function framerCalibrateCrop(argJson) {
    var log = [];
    try {
        var args = JSON.parse(argJson || '{}');
        var units = args.cropUnits || 'percent';
        var probe = (args.probe === undefined) ? 25 : Number(args.probe);

        var seq = fSafe(function () { return app.project.activeSequence; }, null);
        if (!seq) { return fError('Open a sequence and select a clip to calibrate against.', log); }

        var selection = fSafe(function () { return seq.getSelection(); }, null);
        if (!selection || !selection.length) {
            return fError('Select a clip on the timeline first, then calibrate.', log);
        }
        var trackItem = selection[0];

        // Which track is it on? Needed for the QE lookup that adds the effect.
        var trackIndex = -1;
        var vTracks = fSafe(function () { return seq.videoTracks.numTracks; }, 0);
        for (var t = 0; t < vTracks && trackIndex < 0; t++) {
            var clips = fSafe(function () { return seq.videoTracks[t].clips; }, null);
            if (!clips) { continue; }
            for (var c = 0; c < clips.numItems; c++) {
                if (fSafe(function () { return clips[c].start.ticks === trackItem.start.ticks &&
                                               clips[c].nodeId === trackItem.nodeId; }, false)) {
                    trackIndex = t; break;
                }
            }
        }
        if (trackIndex < 0) { trackIndex = 0; }

        if (!fFindComponent(trackItem, FX_NAMES.crop)) {
            fAddVideoEffect(trackIndex, FX_NAMES.crop, log);
        }
        var cropComp = fFindComponent(trackItem, FX_NAMES.crop);
        if (!cropComp) { return fError('Could not apply the Crop effect to that clip.', log); }

        var written = probe * ((units === 'normalized') ? 0.01 : 1);
        fSetProperty(cropComp, ['Left'], CROP_INDEX.left, written, 'Crop > Left', log);
        var readBack = fSafe(function () {
            return fFindProperty(cropComp, ['Left'], CROP_INDEX.left).getValue();
        }, null);

        return fResult({
            ok: true, probe: probe, units: units, wrote: written, readBack: readBack,
            message: 'Crop > Left was set on "' + fSafe(function () { return trackItem.name; }, 'the clip') +
                     '". Effect Controls should read ' + probe + '%.'
        }, log);
    } catch (e) {
        return fError('calibration failed: ' + e, log);
    }
}

/** Lets the panel confirm the host script actually loaded. */
function framerPing() {
    return fResult({ ok: true, pong: true, appVersion: fSafe(function () { return app.version; }, '?') }, []);
}
