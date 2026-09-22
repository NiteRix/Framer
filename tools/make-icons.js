/**
 * Generates the panel icons: a 16:9 frame with a 9:16 frame standing inside
 * it, which is the whole extension in 23 pixels.
 *
 * Written as code rather than committed art so the icons can be tweaked
 * without a graphics editor:  node tools/make-icons.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var SIZE = 23;

function encodePng(width, height, rgba) {
  function chunk(type, data) {
    var len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    var crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  }

  var table = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); }
    table[n] = c >>> 0;
  }
  function crc32(buf) {
    var c = 0xffffffff;
    for (var i = 0; i < buf.length; i++) { c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8); }
    return (c ^ 0xffffffff) >>> 0;
  }

  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw scanlines, each prefixed with filter type 0.
  var raw = Buffer.alloc((width * 4 + 1) * height);
  for (var y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function hex(value) {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16)
  ];
}

function makeIcon(frameColor, accentColor) {
  var buf = Buffer.alloc(SIZE * SIZE * 4);          // transparent
  var frame = hex(frameColor);
  var accent = hex(accentColor);

  function set(x, y, rgb, alpha) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) { return; }
    var i = (y * SIZE + x) * 4;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
    buf[i + 3] = alpha === undefined ? 255 : alpha;
  }

  function outline(x0, y0, x1, y1, rgb) {
    for (var x = x0; x <= x1; x++) { set(x, y0, rgb); set(x, y1, rgb); }
    for (var y = y0; y <= y1; y++) { set(x0, y, rgb); set(x1, y, rgb); }
  }

  // The horizontal source frame.
  outline(1, 6, 21, 16, frame);
  // The vertical crop standing through it, with a faint fill.
  for (var y = 3; y <= 19; y++) {
    for (var x = 8; x <= 14; x++) { set(x, y, accent, 46); }
  }
  outline(8, 3, 14, 19, accent);

  return encodePng(SIZE, SIZE, buf);
}

var outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }

fs.writeFileSync(path.join(outDir, 'icon-normal.png'), makeIcon('#9aa3b0', '#4aa8ff'));
fs.writeFileSync(path.join(outDir, 'icon-rollover.png'), makeIcon('#e4e7ec', '#78c0ff'));

process.stdout.write('wrote icons/icon-normal.png and icons/icon-rollover.png\n');
