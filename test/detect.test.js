/**
 * Detection tests run against synthetic captures: a moving "gameplay" scene
 * with a bordered webcam box composited over one corner, which is the shape of
 * the real problem.
 */
'use strict';

var h = require('./harness');
var test = h.test, assert = h.assert;
var D = require('../extension/js/core/detect.js');

function makeFrame(width, height, painter) {
  var data = new Uint8ClampedArray(width * height * 4);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var i = (y * width + x) * 4;
      var v = painter(x, y);
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { width: width, height: height, data: data };
}

/**
 * Build a sequence of frames: smooth, shifting background (lots of temporal
 * change, little spatial detail - like a panning game camera) plus a webcam box
 * with a bright border and a slowly drifting blob inside.
 */
function synthCapture(opts) {
  var W = opts.width || 320, H = opts.height || 180;
  var box = opts.box;                       // normalised {x,y,w,h}
  var frames = [];
  var bx0 = Math.round(box.x * W), by0 = Math.round(box.y * H);
  var bx1 = Math.round((box.x + box.w) * W), by1 = Math.round((box.y + box.h) * H);

  for (var f = 0; f < (opts.frames || 8); f++) {
    var phase = f * 0.9;
    frames.push(makeFrame(W, H, function (x, y) {
      var inBox = x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
      if (inBox) {
        var onBorder = x <= bx0 + 1 || x >= bx1 - 1 || y <= by0 + 1 || y >= by1 - 1;
        if (onBorder) { return 245; }                  // bright frame around the cam
        // A face-ish blob that drifts slowly: some motion, but much less than
        // the background.
        var cx = (bx0 + bx1) / 2 + Math.sin(phase * 0.35) * 3;
        var cy = (by0 + by1) / 2 + Math.cos(phase * 0.35) * 2;
        var r = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        return 110 + 40 * Math.exp(-(r * r) / 220);
      }
      // Background: broad smooth gradients that slide frame to frame.
      return 100 + 55 * Math.sin((x * 0.05) + phase) * Math.cos((y * 0.04) - phase * 0.7);
    }));
  }
  return { frames: frames, truth: box, width: W, height: H };
}

function iou(a, b) {
  var ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  var iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  var inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

test('grayDownsample averages down to the requested grid', function () {
  var frame = makeFrame(64, 32, function (x) { return x < 32 ? 0 : 255; });
  var grid = D.grayDownsample(frame, 8, 4);
  assert.equal(grid.length, 32, 'grid length');
  assert.close(grid[0], 0, 1, 'left half dark');
  assert.close(grid[7], 255, 1, 'right half bright');
});

test('temporalStats reports zero variance for a still frame', function () {
  var frame = makeFrame(16, 16, function () { return 128; });
  var grid = D.grayDownsample(frame, 8, 8);
  var stats = D.temporalStats([grid, grid, grid], 64);
  assert.close(stats.mean[0], 128, 0.5, 'mean');
  assert.close(stats.variance[0], 0, 0.001, 'variance');
});

test('finds a bordered webcam box in the top-left corner', function () {
  var cap = synthCapture({ box: { x: 0.03, y: 0.06, w: 0.30, h: 0.40 } });
  var got = D.findWebcamRegion(cap.frames);
  assert.ok(got.rect, 'a region was returned');
  assert.ok(iou(got.rect, cap.truth) > 0.55,
            'overlap with truth ' + JSON.stringify(got.rect) + ' iou=' + iou(got.rect, cap.truth).toFixed(2));
});

test('finds a webcam box in each corner', function () {
  var boxes = [
    { x: 0.04, y: 0.06, w: 0.28, h: 0.38 },
    { x: 0.66, y: 0.06, w: 0.28, h: 0.38 },
    { x: 0.04, y: 0.54, w: 0.28, h: 0.38 },
    { x: 0.66, y: 0.54, w: 0.28, h: 0.38 }
  ];
  for (var i = 0; i < boxes.length; i++) {
    var cap = synthCapture({ box: boxes[i] });
    var got = D.findWebcamRegion(cap.frames);
    assert.ok(got.rect, 'region found for corner ' + i);
    assert.ok(iou(got.rect, boxes[i]) > 0.5,
              'corner ' + i + ' iou=' + iou(got.rect, boxes[i]).toFixed(2) + ' got=' + JSON.stringify(got.rect));
  }
});

test('reports confidence and ranked alternatives', function () {
  var cap = synthCapture({ box: { x: 0.04, y: 0.06, w: 0.28, h: 0.38 } });
  var got = D.findWebcamRegion(cap.frames);
  assert.ok(['low', 'medium', 'high'].indexOf(got.confidence) >= 0, 'confidence is reported');
  assert.ok(got.candidates.length >= 1, 'alternatives are returned');
  for (var i = 1; i < got.candidates.length; i++) {
    assert.ok(got.candidates[i - 1].score >= got.candidates[i].score, 'candidates are sorted');
  }
});

test('a single frame still yields a guess from edges alone', function () {
  var cap = synthCapture({ box: { x: 0.05, y: 0.08, w: 0.30, h: 0.40 }, frames: 1 });
  var got = D.findWebcamRegion([cap.frames[0]]);
  assert.ok(got.rect, 'region found from one frame');
  assert.ok(iou(got.rect, cap.truth) > 0.4, 'single-frame iou=' + iou(got.rect, cap.truth).toFixed(2));
});

test('no frames is handled without throwing', function () {
  var got = D.findWebcamRegion([]);
  assert.equal(got.rect, null, 'no rect');
  assert.equal(got.confidence, 'none');
  assert.ok(got.reason, 'a reason is given');
});

test('a featureless capture does not invent a high-confidence box', function () {
  var flat = [];
  for (var i = 0; i < 4; i++) {
    flat.push(makeFrame(160, 90, function () { return 120; }));
  }
  var got = D.findWebcamRegion(flat);
  assert.ok(got.confidence !== 'high', 'flat footage is not reported as a confident hit');
});

test('suggestGameplayRegion avoids the webcam box', function () {
  var source = { width: 1920, height: 1080 };
  var cam = { x: 0.0, y: 0.0, w: 0.3, h: 0.45 };
  var rect = D.suggestGameplayRegion(cam, 1080 / 1920, source);
  var overlap = D._internals.overlaps(rect, cam);
  assert.ok(!overlap, 'suggested gameplay region is not the webcam box');
  assert.ok(rect.w > 0.2 && rect.h > 0.2, 'suggestion is usable in size');
});

test('suggestGameplayRegion centres the largest crop when there is no webcam', function () {
  var source = { width: 1920, height: 1080 };
  var rect = D.suggestGameplayRegion(null, 9 / 16, source);
  assert.close(rect.h, 1, 1e-9, 'full height');
  assert.close(rect.w * 1920 / (rect.h * 1080), 9 / 16, 1e-6, 'the requested aspect');
  assert.close(rect.x + rect.w / 2, 0.5, 1e-9, 'centred across');

  var wide = D.suggestGameplayRegion(null, 16 / 9, source);
  assert.close(wide.w, 1, 1e-9, 'a 16:9 band takes the whole 16:9 frame');
  assert.close(wide.h, 1, 1e-9, 'all of it');
});

test('suggestGameplayRegion stays centred when the webcam is out of the way', function () {
  var source = { width: 1920, height: 1080 };
  var rect = D.suggestGameplayRegion({ x: 0.02, y: 0.03, w: 0.28, h: 0.28 }, 9 / 16, source);
  assert.close(rect.x + rect.w / 2, 0.5, 1e-9, 'a 9:16 crop clears a corner webcam without moving');
});

test('suggestGameplayRegion moves only as far as it must to clear the webcam', function () {
  var source = { width: 1920, height: 1080 };
  var cam = { x: 0.02, y: 0.03, w: 0.28, h: 0.28 };
  var band = 1080 / 1267;                       // the split template's gameplay band
  var rect = D.suggestGameplayRegion(cam, band, source);
  assert.ok(!D._internals.intersects(rect, cam), 'clear of the webcam');
  assert.close(rect.x, cam.x + cam.w + 0.02, 1e-9, 'pushed just past the webcam edge, plus clearance');
  assert.close(rect.h, 1, 1e-9, 'keeps the full height');
  assert.close(rect.w * 1920 / (rect.h * 1080), band, 1e-6, 'keeps the band aspect');

  var mirrored = D.suggestGameplayRegion({ x: 0.70, y: 0.62, w: 0.28, h: 0.36 }, band, source);
  assert.ok(!D._internals.intersects(mirrored, { x: 0.70, y: 0.62, w: 0.28, h: 0.36 }), 'clear on the other side');
  assert.close(mirrored.x + mirrored.w, 0.68, 1e-9, 'pushed just short of a right-hand webcam, plus clearance');
});

test('suggestGameplayRegion goes below a webcam that spans the top middle', function () {
  var source = { width: 1920, height: 1080 };
  var cam = { x: 0.4, y: 0, w: 0.2, h: 0.25 };
  var rect = D.suggestGameplayRegion(cam, 1080 / 1267, source);
  assert.ok(!D._internals.intersects(rect, cam), 'clear of the webcam');
  assert.close(rect.x + rect.w / 2, 0.5, 1e-9, 'still centred across');
  assert.ok(rect.y >= cam.y + cam.h + 0.02 - 1e-9, 'below the webcam, with clearance');
});
