/**
 * Builds ISO base media (MP4/MOV) byte layouts for tests - just the boxes the
 * frame-size reader walks, with padding where real files carry media.
 */
'use strict';

function u32(n) { var b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }

function box(type) {
  var body = Buffer.concat(Array.prototype.slice.call(arguments, 1));
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
}

/** A box using the 64-bit size form, as large mdat boxes do. */
function largeBox(type, body) {
  var size = 16 + body.length;
  return Buffer.concat([u32(1), Buffer.from(type, 'latin1'),
                        u32(Math.floor(size / 4294967296)), u32(size % 4294967296), body]);
}

var IDENTITY = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
var ROTATE_90 = [0, 0x00010000, 0, 0xFFFF0000, 0, 0, 0, 0, 0x40000000];

function tkhd(version, width, height, matrix) {
  return box('tkhd', Buffer.concat([
    Buffer.from([version, 0, 0, 7]),               // version + flags
    Buffer.alloc(version === 1 ? 32 : 20),         // times, track id, duration
    Buffer.alloc(8),                               // reserved
    Buffer.alloc(8),                               // layer, group, volume, reserved
    Buffer.concat((matrix || IDENTITY).map(u32)),
    u32(Math.round(width * 65536)),
    u32(Math.round(height * 65536))
  ]));
}

function trak(width, height, version, matrix) {
  return box('trak', tkhd(version || 0, width, height, matrix), box('mdia', Buffer.alloc(24)));
}

var FTYP = box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2avc1mp41', 'latin1'));
var MVHD = box('mvhd', Buffer.alloc(100));

/** A small but structurally real MP4: audio track, then video, moov last. */
function mp4(width, height) {
  return Buffer.concat([FTYP, box('mdat', Buffer.alloc(4096)), box('moov', MVHD, trak(0, 0), trak(width, height))]);
}

module.exports = {
  u32: u32, box: box, largeBox: largeBox, tkhd: tkhd, trak: trak,
  FTYP: FTYP, MVHD: MVHD, IDENTITY: IDENTITY, ROTATE_90: ROTATE_90, mp4: mp4
};
