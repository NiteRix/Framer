/**
 * A fake Premiere project with a working timeline, for running framerBuild
 * and framerFocus under Node.
 *
 * It models what those two depend on, the way Premiere behaves:
 *   - placing a clip that has audio on a video track also places its audio,
 *     linked, on the audio track with the same index
 *   - createSubClip(name, startTicks, endTicks, hard, takeVideo, takeAudio)
 *     makes a clip carrying only the streams asked for
 *   - effects are added through QE, and appear on the DOM clip's components
 *   - removing a linked clip removes only that clip
 *
 * opts.subclips   false for a build without ProjectItem.createSubClip
 * opts.unlink     false for a build without Sequence.unlinkSelection
 */
'use strict';

var path = require('path');
var shim = require('./extendscript-shim');

var JSX = path.join(__dirname, '..', 'extension', 'jsx');
var SCRIPTS = [path.join(JSX, 'mp4dims.jsx'), path.join(JSX, 'framer.jsx')];

function seconds(s) { var t = new shim.Time(); t.seconds = s; return t; }
function toSeconds(v) {
  if (v && typeof v === 'object' && 'seconds' in v) { return v.seconds; }
  if (typeof v === 'string') { return Number(v) / shim.TICKS_PER_SECOND; }
  return Number(v) || 0;
}

/** A collection that reads like Premiere's: numItems plus [index] access. */
function collection(arr, countKey) {
  var c = {};
  Object.defineProperty(c, countKey || 'numItems', { get: function () { return arr.length; } });
  for (var i = 0; i < 64; i++) {
    (function (k) { Object.defineProperty(c, k, { get: function () { return arr[k]; } }); }(i));
  }
  return c;
}

function param(name, value) {
  return {
    displayName: name,
    value: value,
    setValue: function (v) { this.value = Array.isArray(v) ? v.slice() : v; },
    getValue: function () { return this.value; }
  };
}

var EFFECTS = {
  Crop: ['Left', 'Top', 'Right', 'Bottom', 'Zoom', 'Edge Feather'],
  'Gaussian Blur': ['Blurriness', 'Blur Dimensions', 'Repeat Edge Pixels'],
  'Drop Shadow': ['Shadow Color', 'Opacity', 'Direction', 'Distance', 'Softness', 'Shadow Only']
};

function component(name, params) {
  var list = params.map(function (p) { return Array.isArray(p) ? param(p[0], p[1]) : param(p, 0); });
  return { displayName: name, matchName: 'ADBE ' + name, properties: collection(list), _params: list };
}

function create(opts) {
  opts = opts || {};
  var nodeIds = 0;
  var sequences = [];
  var rootChildren = [];

  function projectItem(props) {
    var item = Object.assign({
      nodeId: 'item-' + (++nodeIds),
      type: 1,
      _in: 0, _out: 30, _video: true, _audio: true,
      getMediaPath: function () { return ''; },
      getXMPMetadata: function () { return ''; },
      getProjectMetadata: function () { return ''; },
      getInPoint: function () { return seconds(this._in); },
      getOutPoint: function () { return seconds(this._out); },
      setInPoint: function (t) { this._in = toSeconds(t); },
      setOutPoint: function (t) { this._out = toSeconds(t); },
      hasAudio: function () { return this._audio; },
      hasVideo: function () { return this._video; },
      moveBin: function (bin) {
        var at = rootChildren.indexOf(this);
        if (at >= 0) { rootChildren.splice(at, 1); }
        bin._children.push(this);
        this._bin = bin;
      }
    }, props);
    item.children = collection([]);
    return item;
  }

  var source = projectItem({ name: 'capture.mp4' });
  if (opts.subclips !== false) {
    source.createSubClip = function (name, start, end, hard, takeVideo, takeAudio) {
      var sub = projectItem({
        name: name, _in: toSeconds(start), _out: toSeconds(end),
        _video: !!takeVideo, _audio: !!takeAudio && this._audio, _subclipOf: this
      });
      rootChildren.push(sub);
      return sub;
    };
  }
  rootChildren.push(source);

  var root = {
    _children: rootChildren,
    createBin: function (name) {
      var bin = projectItem({ name: name, type: 2, _video: false, _audio: false });
      bin._children = [];
      bin.children = collection(bin._children);
      rootChildren.push(bin);
      return bin;
    }
  };
  root.children = collection(rootChildren);

  function trackItem(seq, item, kind, start, end) {
    var ti = {
      nodeId: 'ti-' + (++nodeIds),
      name: item.name,
      projectItem: item,
      mediaType: kind,
      start: seconds(start),
      end: seconds(end),
      inPoint: seconds(item._in),
      outPoint: seconds(item._out),
      disabled: false,
      _selected: false,
      _link: null,
      _labels: [],
      isSelected: function () { return this._selected; },
      setSelected: function (on) { this._selected = !!on; },
      setColorLabel: function (l) { this._labels.push(l); },
      remove: function () {
        var list = this._track._clips;
        list.splice(list.indexOf(this), 1);
        if (this._link) { this._link._link = null; }
      }
    };
    var comps = kind === 'Video'
      ? [component('Opacity', ['Opacity', 'Blend Mode']),
         component('Motion', [['Position', [0.5, 0.5]], ['Scale', 100], ['Scale Width', 100],
                              ['Uniform Scale', true], ['Rotation', 0], ['Anchor Point', [0.5, 0.5]]])]
      : [component('Volume', ['Bypass', 'Level'])];
    ti._components = comps;
    ti.components = collection(comps);
    return ti;
  }

  function track(seq, kind, index) {
    var t = { _clips: [], _kind: kind, _index: index };
    t.clips = collection(t._clips);
    function place(item, at) {
      var start = toSeconds(at);
      var end = start + (item._out - item._in);
      var placed = null;
      if (kind === 'Video' ? item._video : item._audio) {
        placed = trackItem(seq, item, kind, start, end);
        placed._track = t;
        t._clips.push(placed);
      }
      // Premiere brings the other stream along, onto the matching track.
      var otherKind = kind === 'Video' ? 'Audio' : 'Video';
      var hasOther = kind === 'Video' ? item._audio : item._video;
      if (hasOther) {
        var others = kind === 'Video' ? seq._audio : seq._video;
        while (others.length <= index) { others.push(track(seq, otherKind, others.length)); }
        var partner = trackItem(seq, item, otherKind, start, end);
        partner._track = others[index];
        others[index]._clips.push(partner);
        if (placed) { placed._link = partner; partner._link = placed; }
      }
    }
    t.overwriteClip = place;
    t.insertClip = place;
    return t;
  }

  function sequence(name, width, height) {
    var seq = {
      name: name,
      sequenceID: 'seq-' + (sequences.length + 1),
      frameSizeHorizontal: width,
      frameSizeVertical: height,
      _video: [], _audio: []
    };
    for (var i = 0; i < 3; i++) {
      seq._video.push(track(seq, 'Video', i));
      seq._audio.push(track(seq, 'Audio', i));
    }
    seq.videoTracks = collection(seq._video, 'numTracks');
    seq.audioTracks = collection(seq._audio, 'numTracks');
    seq.getSettings = function () { return { videoFrameWidth: seq.frameSizeHorizontal, videoFrameHeight: seq.frameSizeVertical }; };
    seq.setSettings = function (s) { seq.frameSizeHorizontal = s.videoFrameWidth; seq.frameSizeVertical = s.videoFrameHeight; };
    seq.getSelection = function () {
      var out = [];
      seq._video.concat(seq._audio).forEach(function (tr) {
        tr._clips.forEach(function (c) { if (c._selected) { out.push(c); } });
      });
      return out;
    };
    if (opts.unlink !== false) {
      seq.unlinkSelection = function () {
        seq.getSelection().forEach(function (c) {
          if (c._link) { c._link._link = null; c._link = null; }
        });
      };
    }
    seq.getPlayerPosition = function () { return seconds(0); };
    seq.setPlayerPosition = function () {};
    sequences.push(seq);
    return seq;
  }

  var original = sequence('capture', 1920, 1080);
  original._video[0].overwriteClip(source, 0);

  var app = {
    version: '26.0.1',
    enableQE: function () {},
    project: {
      rootItem: root,
      activeSequence: original,
      getSelection: function () { return [source]; },
      sequences: collection(sequences, 'numSequences'),
      createNewSequenceFromClips: function (name, items) {
        var seq = sequence(name, 1920, 1080);
        seq._video[0].overwriteClip(items[0], 0);
        return seq;
      }
    }
  };

  var qe = {
    project: {
      getVideoEffectByName: function (name) { return EFFECTS[name] ? { name: name } : null; },
      getActiveSequence: function () {
        var seq = app.project.activeSequence;
        return {
          addTracks: function (count) {
            for (var i = 0; i < count; i++) { seq._video.push(track(seq, 'Video', seq._video.length)); }
          },
          getVideoTrackAt: function (i) {
            var tr = seq._video[i];
            if (!tr) { return null; }
            var ordered = tr._clips.slice().sort(function (a, b) { return a.start.seconds - b.start.seconds; });
            return {
              numItems: ordered.length,
              getItemAt: function (k) {
                var clip = ordered[k];
                return {
                  type: 'Clip',
                  name: clip.name,
                  addVideoEffect: function (fx) {
                    clip._components.push(component(fx.name, EFFECTS[fx.name]));
                  }
                };
              }
            };
          }
        };
      }
    }
  };

  var host = shim.createHost({ scripts: SCRIPTS, app: app, qe: qe });

  return {
    app: app,
    host: host,
    source: source,
    root: root,
    call: function (fn, arg) {
      return JSON.parse(arg === undefined ? host[fn]() : host[fn](JSON.stringify(arg)));
    },
    sequence: function () { return app.project.activeSequence; },
    /** Cut every track at `at` seconds, like Add Edit to All Tracks. */
    razor: function (at) {
      var seq = app.project.activeSequence;
      seq._video.concat(seq._audio).forEach(function (tr) {
        tr._clips.slice().forEach(function (c) {
          if (c.start.seconds < at && c.end.seconds > at) {
            var right = trackItem(seq, c.projectItem, c.mediaType, at, c.end.seconds);
            right._track = tr;
            // The new piece carries the same effects and values.
            right._components = JSON.parse(JSON.stringify(c._components.map(function (comp) {
              return { displayName: comp.displayName, params: comp._params.map(function (p) { return [p.displayName, p.value]; }) };
            }))).map(function (comp) { return component(comp.displayName, comp.params); });
            right.components = collection(right._components);
            right.disabled = c.disabled;
            c.end = seconds(at);
            tr._clips.push(right);
            tr._clips.sort(function (a, b) { return a.start.seconds - b.start.seconds; });
          }
        });
      });
    },
    clipsAt: function (kind, t) {
      var seq = app.project.activeSequence;
      return (kind === 'Video' ? seq._video : seq._audio)[t]._clips;
    },
    audioClips: function () {
      var seq = app.project.activeSequence;
      return seq._audio.reduce(function (n, tr) { return n + tr._clips.length; }, 0);
    },
    value: function (clip, comp, name) {
      var c = clip._components.filter(function (x) { return x.displayName === comp; })[0];
      if (!c) { return undefined; }
      return c._params.filter(function (p) { return p.displayName === name; })[0].value;
    },
    hasEffect: function (clip, comp) {
      return clip._components.some(function (x) { return x.displayName === comp; });
    }
  };
}

module.exports = { create: create, seconds: seconds };
