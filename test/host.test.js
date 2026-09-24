/**
 * The Premiere host script, run under Node against a fake Premiere shaped like
 * the build that failed in the field (26.0.1):
 *
 *   - Sequence.exportFramePNG does not exist on the DOM
 *   - QE is available, and its exportFramePNG(timecode, path) appends ".png"
 *     to the path it is given
 *   - the clip's metadata carries no frame size
 *
 * These are the two bugs a user hit: no reference frame, and no dimensions.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var h = require('./harness');
var shim = require('./extendscript-shim');
var fx = require('./mp4-fixture');
var test = h.test, assert = h.assert;

var JSX = path.join(__dirname, '..', 'extension', 'jsx');
var SCRIPTS = [path.join(JSX, 'mp4dims.jsx'), path.join(JSX, 'framer.jsx')];
var FPS = 30;
var PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function seconds(s) { var t = new shim.Time(); t.seconds = s; return t; }

/** HH;MM;SS;FF - the shape of QE's CTI.timecode. */
function timecode(ticks) {
  var total = Number(ticks) / shim.TICKS_PER_SECOND;
  var frames = Math.round(total * FPS);
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return pad(Math.floor(frames / (FPS * 3600))) + ';' + pad(Math.floor(frames / (FPS * 60)) % 60) + ';' +
         pad(Math.floor(frames / FPS) % 60) + ';' + pad(frames % FPS);
}

/**
 * A fake Premiere. opts:
 *   exportDelay   $.sleep calls before a QE export lands on disk
 *   qe            false for a build with no QE
 *   qeExportWorks false for a QE whose export writes nothing
 *   item          overrides for the selected clip's project item
 */
function premiere(opts) {
  opts = opts || {};
  var playhead = Number(seconds(opts.playheadAt || 5).ticks);
  var pending = [];
  var calls = { moves: [], exports: [] };

  var projectItem = Object.assign({
    name: 'clip_source.mp4',
    nodeId: 'node-7',
    getMediaPath: function () { return ''; },
    getXMPMetadata: function () { return ''; },
    getProjectMetadata: function () {
      return '<premierePrivateProjectMetaData:Column.Intrinsic.MediaType>Movie' +
             '</premierePrivateProjectMetaData:Column.Intrinsic.MediaType>';
    },
    getInPoint: function () { return seconds(0); },
    getOutPoint: function () { return seconds(30); },
    hasAudio: function () { return true; },
    hasVideo: function () { return true; }
  }, opts.item || {});

  var trackItem = {
    projectItem: projectItem,
    inPoint: seconds(2), outPoint: seconds(14),
    start: seconds(10), end: seconds(22)
  };

  var seq = {
    name: 'clip_source',
    frameSizeHorizontal: 1920,
    frameSizeVertical: 1080,
    getPlayerPosition: function () { var t = new shim.Time(); t.ticks = String(playhead); return t; },
    setPlayerPosition: function (ticks) { playhead = Number(ticks); calls.moves.push(Number(ticks)); },
    getSelection: function () { return opts.selection === undefined ? [trackItem] : opts.selection; }
    // No exportFramePNG here: Premiere 26.0.1 does not have it on the DOM.
  };

  var qeSeq = {
    CTI: {},
    exportFramePNG: function (tc, base) {
      calls.exports.push({ timecode: tc, base: base });
      if (opts.qeExportWorks === false) { return; }
      pending.push({ file: base + '.png', due: opts.exportDelay || 0 });
      flush(0);
    }
  };
  Object.defineProperty(qeSeq.CTI, 'timecode', { get: function () { return timecode(playhead); } });

  function flush(sleeps) {
    pending = pending.filter(function (p) {
      if (sleeps >= p.due) { fs.writeFileSync(p.file, PNG); return false; }
      return true;
    });
  }

  var sleepsSinceExport = 0;
  var host = shim.createHost({
    os: opts.os,
    scripts: SCRIPTS,
    app: {
      version: '26.0.1',
      project: { activeSequence: seq, getSelection: function () { return []; } },
      enableQE: function () {}
    },
    qe: opts.qe === false ? undefined : { project: { getActiveSequence: function () { return qeSeq; } } },
    onSleep: function () { sleepsSinceExport++; flush(sleepsSinceExport); }
  });

  return {
    host: host, calls: calls, seq: seq,
    playhead: function () { return playhead; },
    call: function (fn, arg) {
      sleepsSinceExport = 0;
      var raw = arg === undefined ? host[fn]() : host[fn](JSON.stringify(arg));
      return JSON.parse(raw);
    }
  };
}

/* ---------------------------------------------------------------------- *
 * Stills                                                                 *
 * ---------------------------------------------------------------------- */

test('renders a still through QE when the DOM has no exportFramePNG (Premiere 26)', function () {
  var p = premiere();
  var res = p.call('framerExportStills', { times: [12] });
  assert.ok(res.ok, 'export succeeded: ' + res.error + ' ' + JSON.stringify(res.log));
  assert.equal(res.stills.length, 1, 'one still');
  assert.ok(fs.existsSync(res.stills[0].path), 'the returned path exists');
  assert.ok(/\.png$/.test(res.stills[0].path), 'Premiere appended .png and the host found it');
  assert.equal(res.width, 1920, 'still width is the sequence width');
  assert.equal(res.height, 1080, 'still height is the sequence height');
});

test('hands QE a path without an extension, as its exportFramePNG expects', function () {
  var p = premiere();
  p.call('framerExportStills', { times: [12] });
  assert.equal(p.calls.exports.length, 1, 'one export call');
  assert.ok(!/\.png$/.test(p.calls.exports[0].base), 'no extension on the base path');
});

test('moves the playhead to each requested time and exports that timecode', function () {
  var p = premiere();
  var res = p.call('framerExportStills', { times: [10.5, 15, 20] });
  assert.equal(res.stills.length, 3, 'three stills');
  assert.equal(p.calls.exports[0].timecode, '00;00;10;15', 'first export at 10.5s');
  assert.equal(p.calls.exports[1].timecode, '00;00;15;00', 'second at 15s');
  assert.equal(p.calls.exports[2].timecode, '00;00;20;00', 'third at 20s');
  assert.close(res.stills[1].seconds, 15, 0.001, 'reports the time it rendered');
});

test('puts the playhead back where the user left it', function () {
  var p = premiere({ playheadAt: 7 });
  var before = p.playhead();
  p.call('framerExportStills', { times: [11, 16] });
  assert.equal(p.playhead(), before, 'playhead restored');
});

test('waits for an export that lands on disk after the call returns', function () {
  var p = premiere({ exportDelay: 4 });
  var res = p.call('framerExportStills', { times: [12] });
  assert.ok(res.ok, 'export succeeded after a delay: ' + res.error);
  assert.ok(fs.existsSync(res.stills[0].path), 'file present');
});

test('with no times, renders the frame under the playhead without moving it', function () {
  var p = premiere({ playheadAt: 9 });
  var res = p.call('framerExportStills', {});
  assert.ok(res.ok, 'rendered');
  assert.equal(p.calls.moves.length, 0, 'playhead never moved');
  assert.equal(p.calls.exports[0].timecode, '00;00;09;00', 'exported the current frame');
});

test('clears stills from earlier renders', function () {
  var p = premiere();
  var folder = path.join(p.host.__tempDir, 'framer');
  fs.mkdirSync(folder, { recursive: true });
  var stale = path.join(folder, 'framer_still_ref_old_0.png');
  var other = path.join(folder, 'framer_still_safe_old_0.png');
  fs.writeFileSync(other, PNG);
  fs.writeFileSync(stale, PNG);
  var mine = path.join(folder, 'keep-me.txt');
  fs.writeFileSync(mine, 'x');
  p.call('framerExportStills', { times: [12] });
  assert.ok(!fs.existsSync(stale), 'old still removed');
  assert.ok(fs.existsSync(mine), 'unrelated files left alone');
  assert.ok(fs.existsSync(other), 'stills rendered for another purpose left alone');
});

test('builds Windows paths with backslashes on Windows', function () {
  var p = premiere({ os: 'Windows 10' });
  p.call('framerExportStills', { times: [12] });
  var base = p.calls.exports[0].base;
  assert.ok(base.indexOf('\\framer_still_') !== -1, 'separator before the file name is a backslash: ' + base);
});

test('reports a clear failure when no export path works', function () {
  var p = premiere({ qe: false });
  var res = p.call('framerExportStills', { times: [12] });
  assert.ok(!res.ok, 'fails');
  assert.ok(/would not render a still/.test(res.error), 'says why: ' + res.error);
  assert.ok(res.log.some(function (l) { return /exportFramePNG/.test(l); }), 'logs what it tried');
});

test('gives up on the batch when the first frame cannot be rendered', function () {
  var p = premiere({ qeExportWorks: false });
  var res = p.call('framerExportStills', { times: [11, 12, 13, 14] });
  assert.ok(!res.ok, 'fails');
  assert.equal(p.calls.exports.length, 1, 'did not keep trying every time');
});

/* ---------------------------------------------------------------------- *
 * Source dimensions                                                      *
 * ---------------------------------------------------------------------- */

test('reads the frame size from the file header when metadata has none (the field failure)', function () {
  var p = premiere();
  var media = path.join(p.host.__tempDir, 'clip_source.mp4');
  fs.writeFileSync(media, fx.mp4(1920, 1080));
  p.seq.getSelection()[0].projectItem.getMediaPath = function () { return media; };

  var res = p.call('framerInspect');
  assert.ok(res.ok, 'inspect succeeded');
  assert.equal(res.source.width, 1920, 'width');
  assert.equal(res.source.height, 1080, 'height');
  assert.equal(res.source.dimensionsFrom, 'fileHeader', 'came from the header');
});

test('reads element-form XMP frame size', function () {
  var p = premiere({ item: { getXMPMetadata: function () {
    return '<xmpDM:videoFrameSize rdf:parseType="Resource"><stDim:w>2560</stDim:w>' +
           '<stDim:h>1440</stDim:h><stDim:unit>pixel</stDim:unit></xmpDM:videoFrameSize>';
  } } });
  var res = p.call('framerInspect');
  assert.equal(res.source.width, 2560, 'width');
  assert.equal(res.source.height, 1440, 'height');
  assert.equal(res.source.dimensionsFrom, 'xmp');
});

test('reads attribute-form XMP frame size', function () {
  var p = premiere({ item: { getXMPMetadata: function () {
    return '<xmpDM:videoFrameSize stDim:w="1280" stDim:h="720" stDim:unit="pixel"/>';
  } } });
  var res = p.call('framerInspect');
  assert.equal(res.source.width, 1280, 'width');
  assert.equal(res.source.height, 720, 'height');
});

test("reads the project's Video Info column", function () {
  var p = premiere({ item: { getProjectMetadata: function () {
    return '<premierePrivateProjectMetaData:Column.Intrinsic.VideoInfo>3840 x 2160 (1.0)' +
           '</premierePrivateProjectMetaData:Column.Intrinsic.VideoInfo>';
  } } });
  var res = p.call('framerInspect');
  assert.equal(res.source.width, 3840, 'width');
  assert.equal(res.source.height, 2160, 'height');
  assert.equal(res.source.dimensionsFrom, 'projectMetadata');
});

test('returns null dimensions, not a guess, when nothing is readable', function () {
  var p = premiere();
  var res = p.call('framerInspect');
  assert.ok(res.ok, 'inspect still succeeds');
  assert.equal(res.source.width, null, 'no width invented');
  assert.ok(res.log.some(function (l) { return /could not determine/.test(l); }), 'logged');
});

test('reports where the clip sits on the timeline, for addressing stills', function () {
  var p = premiere();
  var res = p.call('framerInspect');
  assert.equal(res.source.seqStart, 10, 'sequence start');
  assert.equal(res.source.seqEnd, 22, 'sequence end');
  assert.equal(res.source.inPoint, 2, 'source in point still reported');
});

test('asks for a selection when nothing is selected', function () {
  var p = premiere({ selection: [] });
  var res = p.call('framerInspect');
  assert.ok(!res.ok, 'fails');
  assert.ok(/Select the horizontal clip/.test(res.error), res.error);
});
