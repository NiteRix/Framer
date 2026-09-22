/**
 * The MP4/MOV header reader, against hand-built ISO base media files. Each
 * case is a layout real encoders produce: moov first (web/"faststart"), moov
 * last (OBS, most recorders), 64-bit mdat sizes, an audio track listed before
 * the video one, version-1 headers, and rotated phone footage.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var h = require('./harness');
var shim = require('./extendscript-shim');
var test = h.test, assert = h.assert;

var MP4DIMS = path.join(__dirname, '..', 'extension', 'jsx', 'mp4dims.jsx');
var host = shim.createHost({ scripts: [MP4DIMS] });

var fx = require('./mp4-fixture');
var u32 = fx.u32, box = fx.box, largeBox = fx.largeBox, trak = fx.trak;
var FTYP = fx.FTYP, MVHD = fx.MVHD, ROTATE_90 = fx.ROTATE_90;

function reader(buf) {
  return {
    length: buf.length,
    read: function (pos, count) { return buf.slice(pos, pos + count).toString('latin1'); }
  };
}

function sizeOf(buf) { return host.fIsoVideoSize(reader(buf)); }

test('reads the size when moov comes first', function () {
  var file = Buffer.concat([FTYP, box('moov', MVHD, trak(1920, 1080)), box('mdat', Buffer.alloc(4096))]);
  var got = sizeOf(file);
  assert.equal(got.width, 1920, 'width');
  assert.equal(got.height, 1080, 'height');
});

test('reads the size when moov sits after a 64-bit mdat, as recorders write it', function () {
  var file = Buffer.concat([FTYP, largeBox('mdat', Buffer.alloc(8192)), box('moov', MVHD, trak(2560, 1440))]);
  var got = sizeOf(file);
  assert.equal(got.width, 2560, 'width');
  assert.equal(got.height, 1440, 'height');
});

test('skips an audio track listed before the video track', function () {
  var file = Buffer.concat([FTYP, box('moov', MVHD, trak(0, 0), trak(1280, 720))]);
  var got = sizeOf(file);
  assert.equal(got.width, 1280, 'width');
  assert.equal(got.height, 720, 'height');
});

test('handles version-1 track headers', function () {
  var file = Buffer.concat([FTYP, box('moov', MVHD, trak(3840, 2160, 1))]);
  var got = sizeOf(file);
  assert.equal(got.width, 3840, 'width');
  assert.equal(got.height, 2160, 'height');
});

test('swaps width and height for footage rotated a quarter turn', function () {
  var file = Buffer.concat([FTYP, box('moov', MVHD, trak(1920, 1080, 0, ROTATE_90))]);
  var got = sizeOf(file);
  assert.equal(got.width, 1080, 'presented width');
  assert.equal(got.height, 1920, 'presented height');
  assert.ok(got.rotated, 'flagged as rotated');
});

test('copes with a final box whose size is 0 (runs to end of file)', function () {
  var sizeZeroMdat = Buffer.concat([u32(0), Buffer.from('mdat', 'latin1'), Buffer.alloc(512)]);
  var file = Buffer.concat([FTYP, box('moov', MVHD, trak(1920, 1080)), sizeZeroMdat]);
  assert.equal(sizeOf(file).width, 1920, 'found before the open-ended box');
});

test('finds moov past the 4 GB mark without reading the media in between', function () {
  // A virtual 6 GB file: ftyp, a 64-bit mdat covering almost all of it, then
  // moov. Reads are served from the two real regions only.
  var moov = box('moov', MVHD, trak(1920, 1080));
  var mdatSize = 6 * 1024 * 1024 * 1024;
  var mdatHead = Buffer.concat([u32(1), Buffer.from('mdat', 'latin1'),
                                u32(Math.floor(mdatSize / 4294967296)), u32(mdatSize % 4294967296)]);
  var head = Buffer.concat([FTYP, mdatHead]);
  var moovAt = FTYP.length + mdatSize;
  var bytesRead = 0;
  var virtual = {
    length: moovAt + moov.length,
    read: function (pos, count) {
      bytesRead += count;
      if (pos < head.length) { return head.slice(pos, pos + count).toString('latin1'); }
      if (pos >= moovAt) { return moov.slice(pos - moovAt, pos - moovAt + count).toString('latin1'); }
      throw new Error('read inside mdat at ' + pos);
    }
  };
  var got = host.fIsoVideoSize(virtual);
  assert.ok(got, 'found');
  assert.equal(got.width, 1920, 'width');
  assert.ok(bytesRead < 2048, 'read only headers (' + bytesRead + ' bytes)');
});

test('returns null for a file that is not ISO media', function () {
  assert.equal(sizeOf(Buffer.from('RIFF....AVI LIST not an mp4 at all', 'latin1')), null);
});

test('returns null rather than throwing on a truncated file', function () {
  var whole = Buffer.concat([FTYP, box('moov', MVHD, trak(1920, 1080))]);
  var cut = whole.slice(0, FTYP.length + 40);
  assert.equal(sizeOf(cut), null);
});

test('reads a real file through the ExtendScript File API', function () {
  var file = path.join(host.__tempDir, 'clip.mp4');
  fs.writeFileSync(file, Buffer.concat([FTYP, box('mdat', Buffer.alloc(2048)), box('moov', MVHD, trak(1920, 1080))]));
  var got = host.fIsoVideoSizeOfFile(file);
  assert.ok(got, 'found');
  assert.equal(got.width, 1920, 'width');
  assert.equal(got.height, 1080, 'height');
  assert.equal(host.fIsoVideoSizeOfFile(path.join(host.__tempDir, 'missing.mp4')), null, 'missing file');
});
