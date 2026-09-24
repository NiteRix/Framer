/**
 * The platform safe-zone geometry: each clear area really is clear of that
 * app's interface, the combined one is clear on all three, and coverage
 * reports the right share of a box for the right part of the interface.
 */
'use strict';

var h = require('./harness');
var SZ = require('../extension/js/core/safezones.js');
var L = require('../extension/js/core/layout.js');
var test = h.test, assert = h.assert;

function overlap(a, b) {
  var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  var hh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && hh > 0 ? w * hh : 0;
}

test('each platform’s clear area sits on the screen and clear of its interface', function () {
  SZ.ORDER.concat(['all']).forEach(function (id) {
    var p = SZ.platform(id);
    var s = p.safe;
    assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= 1080 && s.y + s.h <= 1920, id + ' clear area on screen');
    assert.ok(s.w > 600 && s.h > 1000, id + ' clear area is a usable size');
    p.zones.forEach(function (z) {
      assert.equal(overlap(s, z.rect), 0, id + ': clear area overlaps ' + z.label);
      assert.ok(z.rect.x >= 0 && z.rect.y >= 0 && z.rect.x + z.rect.w <= 1080 && z.rect.y + z.rect.h <= 1920,
                id + ': ' + z.label + ' is on screen');
    });
  });
});

test('the combined clear area is inside every platform’s', function () {
  var all = SZ.combinedSafe();
  SZ.ORDER.forEach(function (id) {
    var s = SZ.PLATFORMS[id].safe;
    assert.ok(all.x >= s.x && all.y >= s.y && all.x + all.w <= s.x + s.w && all.y + all.h <= s.y + s.h,
              'inside ' + id);
  });
  assert.equal(SZ.platform('all').zones.length,
               SZ.ORDER.reduce(function (n, id) { return n + SZ.PLATFORMS[id].zones.length; }, 0),
               'all carries every platform’s zones');
});

test('a 9:16 video fills the screen; 4:5 and 1:1 sit full width in the middle', function () {
  var full = SZ.videoOnScreen({ width: 1080, height: 1920 });
  assert.equal(full.x, 0); assert.equal(full.y, 0); assert.equal(full.w, 1080); assert.equal(full.h, 1920);
  var four = SZ.videoOnScreen({ width: 1080, height: 1350 });
  assert.equal(four.w, 1080, '4:5 full width');
  assert.close(four.y, (1920 - 1350) / 2, 1e-9, '4:5 centred');
  var hd = SZ.videoOnScreen({ width: 720, height: 1280 });
  assert.close(hd.scale, 1.5, 1e-9, '720p scaled up to the screen');
});

test('coverage names the part of the interface over a box, and how much', function () {
  var out = { width: 1080, height: 1920 };
  // A box straddling TikTok's top tabs: the top quarter of it is under them.
  var cov = SZ.coverage({ x: 100, y: 100, w: 400, h: 400 }, 'tiktok', out);
  assert.equal(cov.zones.length, 1, 'one zone');
  assert.equal(cov.zones[0].kind, 'top');
  assert.close(cov.zones[0].share, 0.25, 1e-9, 'a quarter of it');
  assert.close(cov.outside, 0.25, 1e-9, 'and a quarter outside the clear area');

  var clear = SZ.coverage({ x: 200, y: 400, w: 300, h: 300 }, 'all', out);
  assert.equal(clear.zones.length, 0, 'a box in the middle is clear everywhere');
  assert.equal(clear.outside, 0);

  // On 1:1 the video is centred, so a box at its top is well below the tabs.
  var square = SZ.coverage({ x: 100, y: 0, w: 400, h: 150 }, 'tiktok', { width: 1080, height: 1080 });
  assert.equal(square.zones.length, 0, 'the square video starts below the top bar');
});

test('the split template’s webcam band is flagged under the top bar', function () {
  var plan = L.buildPlan({
    source: { width: 1920, height: 1080 }, layout: 'split',
    regions: { gameplay: { x: 0.26, y: 0, w: 0.48, h: 1 }, webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.3 } }
  });
  var cam = plan.layers.filter(function (l) { return l.role === 'webcam'; })[0];
  var cov = SZ.coverage(cam.visible, 'tiktok', plan.output);
  assert.ok(cov.zones.length && cov.zones[0].kind === 'top', 'the top tabs sit over the webcam band');
});

test('unknown platforms are rejected', function () {
  assert.throws(function () { SZ.platform('myspace'); });
});
