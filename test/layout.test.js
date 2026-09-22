/**
 * Verifies the layout solver by simulating what Premiere does with the values
 * it produces, then checking the region lands exactly on its target rectangle.
 */
'use strict';

var h = require('./harness');
var test = h.test, assert = h.assert;
var L = require('../extension/js/core/layout.js');

/**
 * Reproduce Premiere's clip transform pipeline:
 *   crop -> scale about the frame centre -> place the frame centre at Position
 * and return where a normalised source rectangle lands, in sequence pixels.
 * By default that rectangle is the layer's region (what must land on its
 * target); `useCrop` measures what survives the crop instead.
 */
function simulate(layer, source, output, useCrop) {
  var W = source.width, H = source.height;
  var SW = output.width, SH = output.height;
  var u0, u1, v0, v1;
  if (layer.rect && !useCrop) {
    u0 = layer.rect.x; u1 = layer.rect.x + layer.rect.w;
    v0 = layer.rect.y; v1 = layer.rect.y + layer.rect.h;
  } else {
    var c = layer.crop || { left: 0, top: 0, right: 0, bottom: 0 };
    u0 = c.left / 100; u1 = 1 - c.right / 100;
    v0 = c.top / 100; v1 = 1 - c.bottom / 100;
  }

  var regionW = (u1 - u0) * W;
  var regionH = (v1 - v0) * H;

  // Region centre measured from the frame centre, in source pixels.
  var dx = ((u0 + u1) / 2 - 0.5) * W;
  var dy = ((v0 + v1) / 2 - 0.5) * H;

  var s = layer.scale / 100;
  var frameCentreX = layer.position[0] * SW;
  var frameCentreY = layer.position[1] * SH;

  var cx = frameCentreX + s * dx;
  var cy = frameCentreY + s * dy;

  return { x: cx - s * regionW / 2, y: cy - s * regionH / 2, w: s * regionW, h: s * regionH };
}

var SOURCES = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1280, height: 720 },
  { width: 3840, height: 2160 }
];

var WEBCAMS = [
  { x: 0.02, y: 0.03, w: 0.28, h: 0.30 },   // top-left, portrait-ish
  { x: 0.70, y: 0.62, w: 0.28, h: 0.36 },   // bottom-right
  { x: 0.0,  y: 0.0,  w: 0.22, h: 0.22 },   // flush into the corner
  { x: 0.38, y: 0.40, w: 0.24, h: 0.20 }    // floating in the middle
];

test('solveLayer lands a region exactly on its target rectangle', function () {
  var source = { width: 1920, height: 1080 };
  var output = { width: 1080, height: 1920 };
  var target = { x: 0, y: 640, w: 1080, h: 1280 };
  var rect = L.fitRectToAspect({ x: 0.3, y: 0.2, w: 0.4, h: 0.5 },
                               target.w / target.h, source.width, source.height, 'expand');
  var solved = L.solveLayer({ source: source, output: output, rect: rect, target: target });
  var got = simulate(solved, source, output);

  assert.close(got.x, target.x, 0.5, 'x');
  assert.close(got.y, target.y, 0.5, 'y');
  assert.close(got.w, target.w, 0.5, 'width');
  assert.close(got.h, target.h, 0.5, 'height');
});

test('every layout places every layer on target, across sources and webcams', function () {
  var output = { width: 1080, height: 1920 };
  var ids = L.layoutIds();

  for (var s = 0; s < SOURCES.length; s++) {
    for (var c = 0; c < WEBCAMS.length; c++) {
      for (var i = 0; i < ids.length; i++) {
        var plan = L.buildPlan({
          source: SOURCES[s],
          output: output,
          layout: ids[i],
          regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: WEBCAMS[c] }
        });

        for (var k = 0; k < plan.layers.length; k++) {
          var layer = plan.layers[k];
          var got = simulate(layer, SOURCES[s], output);
          var label = ids[i] + '/' + layer.role + ' src=' + SOURCES[s].width + ' cam=' + c;

          if (layer.role === 'background') {
            // Cover fit: fills the frame, may overflow, never leaves a gap.
            assert.ok(got.w >= output.width - 1, label + ' bg width covers');
            assert.ok(got.h >= output.height - 1, label + ' bg height covers');
          } else {
            assert.close(got.x, layer.target.x, 1, label + ' x');
            assert.close(got.y, layer.target.y, 1, label + ' y');
            assert.close(got.w, layer.target.w, 1, label + ' w');
            assert.close(got.h, layer.target.h, 1, label + ' h');
          }
        }
      }
    }
  }
});

test('crop values stay inside legal bounds', function () {
  var output = { width: 1080, height: 1920 };
  var ids = L.layoutIds();
  for (var s = 0; s < SOURCES.length; s++) {
    for (var c = 0; c < WEBCAMS.length; c++) {
      for (var i = 0; i < ids.length; i++) {
        var plan = L.buildPlan({
          source: SOURCES[s], output: output, layout: ids[i],
          regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: WEBCAMS[c] }
        });
        for (var k = 0; k < plan.layers.length; k++) {
          var crop = plan.layers[k].crop;
          if (!crop) { continue; }
          var label = ids[i] + '/' + plan.layers[k].role;
          assert.between(crop.left, 0, 100, label + ' left');
          assert.between(crop.top, 0, 100, label + ' top');
          assert.between(crop.right, 0, 100, label + ' right');
          assert.between(crop.bottom, 0, 100, label + ' bottom');
          assert.ok(crop.left + crop.right < 100, label + ' horizontal crop leaves pixels');
          assert.ok(crop.top + crop.bottom < 100, label + ' vertical crop leaves pixels');
        }
      }
    }
  }
});

test('fitRectToAspect matches the requested aspect and stays in frame', function () {
  var W = 1920, H = 1080;
  var cases = [
    { rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, aspect: 1080 / 1280 },
    { rect: { x: 0.0, y: 0.0, w: 0.2, h: 0.2 }, aspect: 1080 / 640 },
    { rect: { x: 0.8, y: 0.8, w: 0.2, h: 0.2 }, aspect: 9 / 16 },
    { rect: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }, aspect: 16 / 9 },
    { rect: { x: 0.0, y: 0.3, w: 1.0, h: 0.4 }, aspect: 9 / 16 }
  ];
  for (var i = 0; i < cases.length; i++) {
    var fitted = L.fitRectToAspect(cases[i].rect, cases[i].aspect, W, H, 'expand');
    assert.close(L.regionAspect(fitted, W, H), cases[i].aspect, 0.001, 'aspect case ' + i);
    assert.between(fitted.x, 0, 1, 'x in frame, case ' + i);
    assert.between(fitted.y, 0, 1, 'y in frame, case ' + i);
    assert.ok(fitted.x + fitted.w <= 1.0001, 'right edge in frame, case ' + i);
    assert.ok(fitted.y + fitted.h <= 1.0001, 'bottom edge in frame, case ' + i);
  }
});

test('fitRectToAspect keeps the centre when there is room', function () {
  var fitted = L.fitRectToAspect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 1, 1920, 1080, 'expand');
  assert.close(fitted.x + fitted.w / 2, 0.5, 0.0001, 'centre x held');
  assert.close(fitted.y + fitted.h / 2, 0.5, 0.0001, 'centre y held');
});

test('split layout stacks the bands without gaps or overlap', function () {
  var plan = L.buildPlan({
    source: { width: 1920, height: 1080 }, layout: 'split',
    options: { webcamShare: 0.34, gap: 0, webcamFirst: true },
    regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.3 } }
  });
  var cam = null, play = null;
  for (var i = 0; i < plan.layers.length; i++) {
    if (plan.layers[i].role === 'webcam') { cam = plan.layers[i]; }
    if (plan.layers[i].role === 'gameplay') { play = plan.layers[i]; }
  }
  assert.ok(cam && play, 'both layers present');
  assert.equal(cam.target.y, 0, 'webcam band on top');
  assert.equal(cam.target.h + play.target.h, 1920, 'bands fill the height');
  assert.equal(play.target.y, cam.target.h, 'gameplay starts where webcam ends');
  assert.ok(cam.track > play.track, 'webcam sits on a higher track than gameplay');
});

test('overlay layout puts the webcam on the top track over a full-frame gameplay', function () {
  var plan = L.buildPlan({
    source: { width: 1920, height: 1080 }, layout: 'overlay',
    regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.3 } }
  });
  var last = plan.layers[plan.layers.length - 1];
  assert.equal(last.role, 'webcam', 'webcam is the topmost layer');
  var play = plan.layers[0];
  assert.equal(play.target.w, 1080, 'gameplay fills width');
  assert.equal(play.target.h, 1920, 'gameplay fills height');
  // The floating webcam box must sit inside the canvas.
  assert.ok(last.target.x >= 0 && last.target.x + last.target.w <= 1080, 'webcam box inside width');
  assert.ok(last.target.y >= 0 && last.target.y + last.target.h <= 1920, 'webcam box inside height');
});

test('overlay anchors move the webcam box to the requested corner', function () {
  function boxFor(anchor) {
    var plan = L.buildPlan({
      source: { width: 1920, height: 1080 }, layout: 'overlay',
      options: { anchor: anchor, webcamWidth: 0.4, marginX: 0.05, marginY: 0.05 },
      regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.3 } }
    });
    return plan.layers[plan.layers.length - 1].target;
  }
  var tl = boxFor('top-left'), br = boxFor('bottom-right'), tc = boxFor('top-centre');
  assert.equal(tl.x, 54, 'top-left x uses the margin');
  assert.equal(tl.y, 96, 'top-left y uses the margin');
  assert.equal(br.x + br.w, 1080 - 54, 'bottom-right hugs the right margin');
  assert.equal(br.y + br.h, 1920 - 96, 'bottom-right hugs the bottom margin');
  assert.close(tc.x + tc.w / 2, 540, 1, 'top-centre is horizontally centred');
});

test('blurred background layout keeps gameplay uncropped horizontally', function () {
  var plan = L.buildPlan({
    source: { width: 1920, height: 1080 }, layout: 'blur',
    options: { gameplayWidth: 1.0 },
    regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.3 } }
  });
  assert.equal(plan.layers[0].role, 'background', 'background is bottom-most');
  assert.ok(plan.layers[0].blur > 0, 'background carries a blur amount');
  var play = plan.layers[1];
  assert.equal(play.role, 'gameplay');
  assert.equal(play.target.w, 1080, 'gameplay spans the full width');
  assert.close(play.target.h, 1080 * 9 / 16, 1, 'gameplay keeps 16:9');
  assert.ok(!play.crop || (play.crop.left < 0.01 && play.crop.right < 0.01),
            'a full-width 16:9 band needs no horizontal crop');
});

test('full layout produces a single layer and no webcam', function () {
  var plan = L.buildPlan({
    source: { width: 1920, height: 1080 }, layout: 'full',
    regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.3 } }
  });
  assert.equal(plan.layers.length, 1, 'one layer');
  assert.equal(plan.layers[0].role, 'gameplay');
});

test('a 9:16 source still solves cleanly', function () {
  var source = { width: 1080, height: 1920 };
  var output = { width: 1080, height: 1920 };
  var plan = L.buildPlan({
    source: source, output: output, layout: 'overlay',
    regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 } }
  });
  for (var i = 0; i < plan.layers.length; i++) {
    var got = simulate(plan.layers[i], source, output);
    assert.close(got.w, plan.layers[i].target.w, 1, 'layer ' + i + ' width');
    assert.close(got.h, plan.layers[i].target.h, 1, 'layer ' + i + ' height');
  }
});

/**
 * What the finished sequence shows at a point: the topmost layer whose cropped
 * frame covers it, and which source pixel that layer puts there. This is the
 * whole Premiere composite, one point at a time.
 */
function sample(plan, source, output, px, py) {
  for (var i = plan.layers.length - 1; i >= 0; i--) {
    var layer = plan.layers[i];
    var box = simulate(layer, source, output, true);
    if (px < box.x || px >= box.x + box.w || py < box.y || py >= box.y + box.h) { continue; }
    var s = layer.scale / 100;
    return {
      layer: i,
      u: (px - layer.position[0] * output.width) / s + source.width / 2,
      v: (py - layer.position[1] * output.height) / s + source.height / 2
    };
  }
  return null;
}

test('keeping the full frame looks exactly like cropping every layer to its region', function () {
  var ids = L.layoutIds();
  var outputs = [{ width: 1080, height: 1920 }, { width: 1080, height: 1350 }];
  var optionSets = {
    split: [{}, { gap: 60 }, { webcamFirst: false }, { gap: 40, webcamFirst: false }],
    overlay: [{}, { anchor: 'bottom-right' }, { anchor: 'middle-center', webcamWidth: 0.8 }],
    blur: [{}, { gameplayWidth: 0.7 }],
    full: [{}]
  };
  var gameplays = [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.3, y: 0.1, w: 0.45, h: 0.8 }];

  for (var o = 0; o < outputs.length; o++) {
    for (var i = 0; i < ids.length; i++) {
      var sets = optionSets[ids[i]];
      for (var k = 0; k < sets.length; k++) {
        for (var c = 0; c < WEBCAMS.length; c++) {
          for (var g = 0; g < gameplays.length; g++) {
            var spec = {
              source: SOURCES[0], output: outputs[o], layout: ids[i], options: sets[k],
              regions: { gameplay: gameplays[g], webcam: WEBCAMS[c] }
            };
            var tight = L.buildPlan(Object.assign({ cropMode: 'tight' }, spec));
            var full = L.buildPlan(spec);
            var label = ids[i] + ' ' + JSON.stringify(sets[k]) + ' cam=' + c + ' play=' + g + ' out=' + outputs[o].height;

            // A grid over the canvas, off the pixel edges where rounding lives.
            for (var gy = 0; gy < 48; gy++) {
              for (var gx = 0; gx < 27; gx++) {
                var px = (gx + 0.37) * outputs[o].width / 27;
                var py = (gy + 0.41) * outputs[o].height / 48;
                var a = sample(tight, SOURCES[0], outputs[o], px, py);
                var b = sample(full, SOURCES[0], outputs[o], px, py);
                if (!a) { assert.ok(!b, label + ': full-frame layer shows over black at ' + px + ',' + py); continue; }
                assert.ok(b, label + ': point went black at ' + px + ',' + py);
                assert.equal(b.layer, a.layer, label + ': different layer on top at ' + px.toFixed(0) + ',' + py.toFixed(0));
                assert.close(b.u, a.u, 0.5, label + ': source x');
                assert.close(b.v, a.v, 0.5, label + ': source y');
              }
            }
          }
        }
      }
    }
  }
});

test('the full-frame mode crops only what would show over another layer', function () {
  var regions = { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.3 } };
  function crops(layout, options) {
    var plan = L.buildPlan({ source: SOURCES[0], layout: layout, options: options, regions: regions });
    var out = {};
    plan.layers.forEach(function (l) { out[l.role] = l.crop; });
    return out;
  }

  var split = crops('split', {});
  assert.equal(split.gameplay, null, 'split: the gameplay layer keeps its whole frame');
  assert.ok(split.webcam && split.webcam.bottom > 0, 'split: the webcam is cut off where the gameplay starts');
  assert.ok(!split.webcam.left && !split.webcam.right && !split.webcam.top,
            'split: nothing else of the webcam frame is cropped - it runs off the canvas');

  var below = crops('split', { webcamFirst: false });
  assert.ok(below.webcam.top > 0 && !below.webcam.bottom, 'split, webcam below: cropped along its top instead');

  var overlay = crops('overlay', {});
  assert.equal(overlay.gameplay, null, 'overlay: the gameplay layer keeps its whole frame');
  assert.ok(overlay.webcam.left > 0 && overlay.webcam.top > 0 && overlay.webcam.right > 0 && overlay.webcam.bottom > 0,
            'overlay: a floating webcam box is cropped on every side');

  assert.equal(crops('full', {}).gameplay, null, 'full: nothing is cropped');
});

test('focusTransform fills the canvas with one layer and crops nothing', function () {
  var output = { width: 1080, height: 1920 };
  for (var s = 0; s < SOURCES.length; s++) {
    for (var c = 0; c < WEBCAMS.length; c++) {
      var spec = { source: SOURCES[s], output: output,
                   regions: { gameplay: { x: 0.3, y: 0, w: 0.48, h: 1 }, webcam: WEBCAMS[c] } };
      ['gameplay', 'webcam'].forEach(function (role) {
        var t = L.focusTransform(spec, role);
        var label = role + ' src=' + SOURCES[s].width + ' cam=' + c;
        assert.equal(t.crop, null, label + ' has no crop');
        var got = simulate({ rect: t.rect, scale: t.scale, position: t.position }, SOURCES[s], output);
        assert.close(got.x, 0, 1, label + ' x');
        assert.close(got.y, 0, 1, label + ' y');
        assert.close(got.w, output.width, 1, label + ' fills the width');
        assert.close(got.h, output.height, 1, label + ' fills the height');
        // Inside the source frame, so the canvas never shows past its edge.
        assert.ok(t.rect.x >= -1e-9 && t.rect.y >= -1e-9, label + ' region starts inside the frame');
        assert.ok(t.rect.x + t.rect.w <= 1 + 1e-9 && t.rect.y + t.rect.h <= 1 + 1e-9, label + ' region ends inside');
      });
      var cam = WEBCAMS[c];
      var camFocus = L.focusTransform(spec, 'webcam').rect;
      assert.ok(camFocus.x >= cam.x - 1e-9 && camFocus.x + camFocus.w <= cam.x + cam.w + 1e-9,
                'webcam focus stays inside the webcam box, cam=' + c);
    }
  }
});

test('unknown layout is rejected', function () {
  assert.throws(function () {
    L.buildPlan({ source: { width: 1920, height: 1080 }, layout: 'nope' });
  });
});

test('missing source dimensions are rejected', function () {
  assert.throws(function () { L.buildPlan({ layout: 'split' }); });
});

module.exports = { simulate: simulate };
