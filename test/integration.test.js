/**
 * End to end over the pure modules: a synthetic 1920x1080 capture with a
 * webcam overlay goes in, and the Crop/Motion values Premiere would receive
 * come out. Simulating those values must put the webcam region exactly where
 * the layout says it goes.
 */
'use strict';

var h = require('./harness');
var test = h.test, assert = h.assert;
var L = require('../extension/js/core/layout.js');
var D = require('../extension/js/core/detect.js');
var simulate = require('./layout.test.js').simulate;

var SOURCE = { width: 1920, height: 1080 };
var OUTPUT = { width: 1080, height: 1920 };
var TRUE_BOX = { x: 0.035, y: 0.07, w: 0.26, h: 0.40 };

/** A capture with a moving scene and a bordered webcam box over it. */
function capture(frameCount) {
  var W = 384, H = 216;
  var bx0 = Math.round(TRUE_BOX.x * W), by0 = Math.round(TRUE_BOX.y * H);
  var bx1 = Math.round((TRUE_BOX.x + TRUE_BOX.w) * W), by1 = Math.round((TRUE_BOX.y + TRUE_BOX.h) * H);
  var frames = [];

  for (var f = 0; f < frameCount; f++) {
    var data = new Uint8ClampedArray(W * H * 4);
    var phase = f * 1.1;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var v;
        if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) {
          if (x <= bx0 + 1 || x >= bx1 - 1 || y <= by0 + 1 || y >= by1 - 1) {
            v = 250;
          } else {
            var cx = (bx0 + bx1) / 2 + Math.sin(phase * 0.3) * 2;
            var cy = (by0 + by1) / 2 + Math.cos(phase * 0.3) * 2;
            var r2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            v = 115 + 45 * Math.exp(-r2 / 260);
          }
        } else {
          v = 100 + 58 * Math.sin(x * 0.045 + phase) * Math.cos(y * 0.037 - phase * 0.6);
        }
        var i = (y * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    frames.push({ width: W, height: H, data: data });
  }
  return frames;
}

function iou(a, b) {
  var ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  var iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  var inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

test('detect then plan then simulate: the webcam lands on its target', function () {
  var found = D.findWebcamRegion(capture(8));
  assert.ok(found.rect, 'the webcam box was found');
  assert.ok(iou(found.rect, TRUE_BOX) > 0.5, 'detection iou=' + iou(found.rect, TRUE_BOX).toFixed(2));

  var ids = L.layoutIds();
  for (var i = 0; i < ids.length; i++) {
    var plan = L.buildPlan({
      source: SOURCE, output: OUTPUT, layout: ids[i],
      regions: {
        gameplay: D.suggestGameplayRegion(found.rect, OUTPUT.width / OUTPUT.height, SOURCE),
        webcam: found.rect
      }
    });

    for (var k = 0; k < plan.layers.length; k++) {
      var layer = plan.layers[k];
      if (layer.role === 'background') { continue; }
      var got = simulate(layer, SOURCE, OUTPUT);
      assert.close(got.x, layer.target.x, 1, ids[i] + '/' + layer.role + ' x');
      assert.close(got.y, layer.target.y, 1, ids[i] + '/' + layer.role + ' y');
      assert.close(got.w, layer.target.w, 1, ids[i] + '/' + layer.role + ' w');
      assert.close(got.h, layer.target.h, 1, ids[i] + '/' + layer.role + ' h');
    }
  }
});

test('the webcam is always on the highest track of the layouts that use it', function () {
  var ids = L.layoutIds();
  for (var i = 0; i < ids.length; i++) {
    if (!L.LAYOUTS[ids[i]].usesWebcam) { continue; }
    var plan = L.buildPlan({
      source: SOURCE, output: OUTPUT, layout: ids[i],
      regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: TRUE_BOX }
    });
    var top = plan.layers[plan.layers.length - 1];
    assert.equal(top.role, 'webcam', ids[i] + ' puts the webcam on top');
    for (var k = 0; k < plan.layers.length; k++) {
      assert.equal(plan.layers[k].track, k, ids[i] + ' track numbering is contiguous from V1');
    }
  }
});

test('the host payload carries everything framerBuild needs', function () {
  var plan = L.buildPlan({
    source: SOURCE, output: OUTPUT, layout: 'blur',
    regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: TRUE_BOX }
  });

  for (var i = 0; i < plan.layers.length; i++) {
    var layer = plan.layers[i];
    assert.ok(typeof layer.role === 'string', 'role');
    assert.ok(typeof layer.track === 'number', 'track');
    assert.ok(typeof layer.scale === 'number' && isFinite(layer.scale), 'scale is a finite number');
    assert.ok(layer.scale > 0, 'scale is positive');
    assert.ok(layer.position.length === 2, 'position is a pair');
    assert.ok(isFinite(layer.position[0]) && isFinite(layer.position[1]), 'position is finite');
    if (layer.crop) {
      var keys = ['left', 'top', 'right', 'bottom'];
      for (var k = 0; k < keys.length; k++) {
        assert.ok(isFinite(layer.crop[keys[k]]), 'crop.' + keys[k] + ' is finite');
      }
    }
  }

  // Round-tripping through JSON is how it reaches ExtendScript.
  var json = JSON.stringify({ output: plan.output, layers: plan.layers });
  var back = JSON.parse(json);
  assert.equal(back.layers.length, plan.layers.length, 'survives JSON');
});

test('a detected box near the frame edge still produces a legal crop', function () {
  var edgeBox = { x: 0, y: 0, w: 0.2, h: 0.3 };
  var plan = L.buildPlan({
    source: SOURCE, output: OUTPUT, layout: 'overlay',
    regions: { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: edgeBox }
  });
  var cam = plan.layers[plan.layers.length - 1];
  assert.ok(cam.crop.left >= 0 && cam.crop.top >= 0, 'no negative crop at the frame edge');
  assert.ok(cam.rect.x >= 0 && cam.rect.y >= 0, 'region stays inside the frame');
  assert.ok(cam.rect.x + cam.rect.w <= 1.0001, 'region does not run past the right edge');
});
