/**
 * framerBuild and framerFocus against a fake Premiere timeline
 * (test/fake-timeline.js): what ends up on which track, how many copies of the
 * audio there are, and what a Focus moment does to the pieces of a cut.
 */
'use strict';

var h = require('./harness');
var fake = require('./fake-timeline');
var L = require('../extension/js/core/layout.js');
var test = h.test, assert = h.assert;

var SOURCE = { width: 1920, height: 1080 };
var REGIONS = { gameplay: { x: 0.26, y: 0, w: 0.48, h: 1 }, webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.3 } };

function plan(layout, extra) {
  return L.buildPlan(Object.assign({ source: SOURCE, layout: layout, regions: REGIONS }, extra || {}));
}

/** The payload the panel sends. */
function payload(p, options, trim) {
  return {
    output: p.output,
    layers: p.layers.map(function (l) {
      return { role: l.role, track: l.track, crop: l.crop, scale: l.scale, position: l.position, blur: l.blur, shadow: l.shadow };
    }),
    source: null,
    trim: trim || null,
    options: Object.assign({ sequenceName: 'Vertical', includeAudio: true, cropUnits: 'percent' }, options || {})
  };
}

/** The build record the panel keeps for Focus. */
function record(p) {
  var spec = { source: SOURCE, output: p.output, regions: REGIONS };
  return {
    name: 'Vertical',
    layers: payload(p).layers,
    focus: {
      gameplay: L.focusTransform(spec, 'gameplay'),
      webcam: L.focusTransform(spec, 'webcam')
    }
  };
}

/* ---------------------------------------------------------------------- *
 * Build                                                                  *
 * ---------------------------------------------------------------------- */

test('build puts the audio in exactly once (the duplicated-audio report)', function () {
  var pr = fake.create();
  var res = pr.call('framerBuild', payload(plan('split', { options: { gap: 40 } })));
  assert.ok(res.ok, 'built: ' + res.error + ' ' + JSON.stringify(res.log));
  assert.equal(pr.audioClips(), 1, 'one audio clip in the whole sequence');
  assert.equal(res.audioClips, 1, 'and the host says so');
  assert.equal(pr.clipsAt('Audio', 0).length, 1, 'on A1');
  for (var t = 0; t < 3; t++) {
    assert.equal(pr.clipsAt('Video', t).length, 1, 'one clip on V' + (t + 1));
    assert.ok(!pr.clipsAt('Video', t)[0].projectItem._audio, 'V' + (t + 1) + ' holds video only');
  }
  assert.ok(res.subclip, 'layers came from a subclip');
});

test('build keeps one audio copy even on a Premiere without subclips', function () {
  var pr = fake.create({ subclips: false });
  var res = pr.call('framerBuild', payload(plan('blur')));
  assert.ok(res.ok, 'built');
  assert.equal(pr.audioClips(), 1, 'extra audio copies removed: ' + JSON.stringify(res.log));
  for (var t = 0; t < 3; t++) {
    assert.equal(pr.clipsAt('Video', t).length, 1, 'V' + (t + 1) + ' still has its layer');
  }
  assert.ok(res.log.some(function (l) { return /removed 2 extra audio copies/.test(l); }), 'says what it removed');
});

test('build leaves no audio when Keep audio is off', function () {
  [true, false].forEach(function (subclips) {
    var pr = fake.create({ subclips: subclips });
    var res = pr.call('framerBuild', payload(plan('overlay'), { includeAudio: false }));
    assert.ok(res.ok, 'built');
    assert.equal(pr.audioClips(), 0, 'no audio (subclips ' + subclips + ')');
    assert.equal(pr.clipsAt('Video', 0).length + pr.clipsAt('Video', 1).length, 2, 'both layers placed');
  });
});

test('build trims through the subclip and leaves the source clip alone', function () {
  var pr = fake.create();
  var res = pr.call('framerBuild', payload(plan('overlay'), {}, { inPoint: 4, outPoint: 9.5 }));
  assert.ok(res.ok, 'built');
  var layer = pr.clipsAt('Video', 0)[0];
  assert.close(layer.end.seconds - layer.start.seconds, 5.5, 1e-6, 'the layer is the trimmed length');
  assert.close(layer.projectItem._in, 4, 1e-6, 'subclip starts at the trim');
  assert.equal(pr.source._in, 0, 'source in point untouched');
  assert.equal(pr.source._out, 30, 'source out point untouched');
  assert.close(pr.clipsAt('Audio', 0)[0].end.seconds, 5.5, 1e-6, 'the audio is trimmed the same');
});

test('subclips are filed in a Framer bin and never overwrite each other', function () {
  var pr = fake.create();
  pr.call('framerBuild', payload(plan('overlay')));
  pr.app.project.activeSequence = pr.app.project.sequences[0];
  pr.call('framerBuild', payload(plan('overlay')));
  var bins = pr.root._children.filter(function (c) { return c.type === 2 && c.name === 'Framer'; });
  assert.equal(bins.length, 1, 'one Framer bin');
  var names = bins[0]._children.map(function (c) { return c.name; });
  assert.equal(names.length, 4, 'video + audio subclip for each build: ' + names.join(', '));
  assert.ok(names.indexOf('capture.mp4 (Framer video)') >= 0 && names.indexOf('capture.mp4 (Framer video 2)') >= 0,
            'second build gets its own names: ' + names.join(', '));
});

test('with the full frame kept, only the webcam gets a Crop, and only along its bottom', function () {
  var pr = fake.create();
  var p = plan('split');
  var res = pr.call('framerBuild', payload(p));
  assert.ok(res.ok, 'built');
  var gameplay = pr.clipsAt('Video', 0)[0];
  var webcam = pr.clipsAt('Video', 1)[0];
  assert.ok(!pr.hasEffect(gameplay, 'Crop'), 'gameplay is not cropped at all');
  assert.ok(pr.hasEffect(webcam, 'Crop'), 'webcam has a Crop');
  assert.equal(pr.value(webcam, 'Crop', 'Left'), 0, 'left untouched');
  assert.equal(pr.value(webcam, 'Crop', 'Top'), 0, 'top untouched');
  assert.equal(pr.value(webcam, 'Crop', 'Right'), 0, 'right untouched');
  assert.close(pr.value(webcam, 'Crop', 'Bottom'), p.layers[1].crop.bottom, 1e-6, 'bottom cut where the gameplay starts');
  assert.close(pr.value(gameplay, 'Motion', 'Scale'), p.layers[0].scale, 1e-6, 'gameplay scale');
  assert.equal(JSON.stringify(pr.value(gameplay, 'Motion', 'Position')), JSON.stringify(p.layers[0].position),
               'gameplay position');
  assert.ok(res.sequence.id, 'the sequence ID comes back, for Focus to find it later');
});

/* ---------------------------------------------------------------------- *
 * Focus                                                                  *
 * ---------------------------------------------------------------------- */

function builtAndCut() {
  var pr = fake.create();
  var p = plan('split');
  var res = pr.call('framerBuild', payload(p));
  var records = {};
  records[res.sequence.id] = record(p);
  pr.razor(10);
  pr.razor(14);
  return { pr: pr, plan: p, records: records };
}

test('Gameplay only: the cut piece fills the frame and the webcam piece is switched off', function () {
  var s = builtAndCut();
  var pr = s.pr;
  pr.clipsAt('Video', 0)[1].setSelected(true);          // the middle gameplay piece
  var res = pr.call('framerFocus', { mode: 'gameplay', records: s.records });
  assert.ok(res.ok, 'focused: ' + res.error + ' ' + JSON.stringify(res.log));
  assert.equal(res.moments, 1, 'one moment');

  var play = pr.clipsAt('Video', 0), cam = pr.clipsAt('Video', 1);
  var full = s.records[Object.keys(s.records)[0]].focus.gameplay;
  assert.close(pr.value(play[1], 'Motion', 'Scale'), full.scale, 1e-6, 'gameplay scaled to fill');
  assert.ok(cam[1].disabled, 'webcam piece in the moment is off');
  assert.ok(!cam[0].disabled && !cam[2].disabled, 'webcam either side is untouched');
  assert.close(pr.value(play[0], 'Motion', 'Scale'), s.plan.layers[0].scale, 1e-6, 'gameplay before the moment untouched');
  assert.close(pr.value(play[2], 'Motion', 'Scale'), s.plan.layers[0].scale, 1e-6, 'gameplay after the moment untouched');
});

test('Webcam only zeroes the webcam crop so the whole frame can fill the canvas', function () {
  var s = builtAndCut();
  var pr = s.pr;
  pr.clipsAt('Video', 1)[1].setSelected(true);          // select the webcam piece this time
  var res = pr.call('framerFocus', { mode: 'webcam', records: s.records });
  assert.ok(res.ok, 'focused: ' + res.error);
  var cam = pr.clipsAt('Video', 1)[1], play = pr.clipsAt('Video', 0)[1];
  assert.equal(pr.value(cam, 'Crop', 'Bottom'), 0, 'crop cleared');
  assert.ok(!cam.disabled, 'webcam on');
  assert.ok(play.disabled, 'gameplay piece off');
});

test('Back to layout restores the built values and switches everything on', function () {
  var s = builtAndCut();
  var pr = s.pr;
  pr.clipsAt('Video', 0)[1].setSelected(true);
  pr.call('framerFocus', { mode: 'webcam', records: s.records });
  var res = pr.call('framerFocus', { mode: 'layout', records: s.records });
  assert.ok(res.ok, 'restored');
  var play = pr.clipsAt('Video', 0)[1], cam = pr.clipsAt('Video', 1)[1];
  assert.ok(!play.disabled && !cam.disabled, 'both on');
  assert.close(pr.value(cam, 'Crop', 'Bottom'), s.plan.layers[1].crop.bottom, 1e-6, 'webcam crop back');
  assert.close(pr.value(play, 'Motion', 'Scale'), s.plan.layers[0].scale, 1e-6, 'gameplay scale back');
  assert.close(pr.value(cam, 'Motion', 'Scale'), s.plan.layers[1].scale, 1e-6, 'webcam scale back');
});

test('Focus leaves a layer alone, and says so, when it is not cut at the same points', function () {
  var pr = fake.create();
  var p = plan('split');
  var res = pr.call('framerBuild', payload(p));
  var records = {};
  records[res.sequence.id] = record(p);
  // Cut the gameplay track only.
  var gameplay = pr.clipsAt('Video', 0)[0];
  var cam = pr.clipsAt('Video', 1)[0];
  pr.razor(10);
  cam.end = fake.seconds(30);
  pr.clipsAt('Video', 1).splice(1);                      // undo the webcam cut
  gameplay.setSelected(true);

  var out = pr.call('framerFocus', { mode: 'gameplay', records: records });
  assert.ok(out.ok, 'the gameplay piece still changes');
  assert.ok(out.warnings > 0, 'with a warning');
  assert.ok(!pr.clipsAt('Video', 1)[0].disabled, 'the whole webcam clip is not switched off');
  assert.ok(out.log.some(function (l) { return /Add Edit to All Tracks/.test(l); }), 'tells the user how to cut');
});

test('Focus explains what to do when nothing is selected', function () {
  var s = builtAndCut();
  var res = s.pr.call('framerFocus', { mode: 'gameplay', records: s.records });
  assert.ok(!res.ok, 'fails');
  assert.ok(/Add Edit to All Tracks/.test(res.error), res.error);
});

test('Focus refuses a sequence Framer did not build', function () {
  var s = builtAndCut();
  s.pr.clipsAt('Video', 0)[1].setSelected(true);
  var res = s.pr.call('framerFocus', { mode: 'gameplay', records: {} });
  assert.ok(!res.ok, 'fails');
  assert.ok(/not built by Framer/.test(res.error), res.error);
});
