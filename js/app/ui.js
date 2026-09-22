/**
 * Framer - panel controller
 * -------------------------
 * Owns the panel state, keeps the preview honest (it renders the same plan the
 * host builds), and hands that plan to Premiere on Build.
 */
(function (root) {
  'use strict';

  var L = root.Framer.layout;
  var D = root.Framer.detect;
  var host = root.Framer.host;
  var media = root.Framer.media;
  var preview = root.Framer.preview;

  var STORE_KEY = 'framer.settings.v2';

  var state = {
    source: null,          // what framerInspect() reported
    sourceDims: null,      // {width,height} - from metadata, media, or typed in
    frameImage: null,      // <img> or <canvas> used for both previews
    video: null,           // decoded media, when the panel can read the codec
    frameOrigin: '',
    regions: null,
    layout: 'overlay',
    options: {},           // per layout id
    output: { width: 1080, height: 1920 },
    cropUnits: 'percent',
    scrub: 0.35,
    plan: null,
    busy: false
  };

  /* ------------------------------------------------------------------ *
   * Layout option descriptors                                          *
   * ------------------------------------------------------------------ */

  function pct(v) { return Math.round(v * 100) + '%'; }
  function px(v) { return Math.round(v) + 'px'; }

  var OPTION_CONTROLS = {
    split: [
      { key: 'webcamShare', label: 'Webcam band', type: 'range', min: 0.15, max: 0.6, step: 0.01, format: pct },
      { key: 'gap', label: 'Gap', type: 'range', min: 0, max: 140, step: 2, format: px },
      { key: 'webcamFirst', label: 'Webcam on top', type: 'check' },
      { key: 'blurriness', label: 'Gap blur', type: 'range', min: 0, max: 120, step: 2, format: px,
        enabledWhen: function (o) { return o.gap > 0; } }
    ],
    overlay: [
      { key: 'webcamWidth', label: 'Webcam size', type: 'range', min: 0.2, max: 0.9, step: 0.01, format: pct },
      { key: 'anchor', label: 'Position', type: 'select', options: [
        ['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'],
        ['middle-left', 'Middle left'], ['middle-center', 'Middle centre'], ['middle-right', 'Middle right'],
        ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right']
      ] },
      { key: 'marginX', label: 'Side margin', type: 'range', min: 0, max: 0.2, step: 0.005, format: pct },
      { key: 'marginY', label: 'Top margin', type: 'range', min: 0, max: 0.2, step: 0.005, format: pct },
      { key: 'shadow', label: 'Drop shadow', type: 'check' }
    ],
    blur: [
      { key: 'gameplayWidth', label: 'Gameplay width', type: 'range', min: 0.5, max: 1, step: 0.01, format: pct },
      { key: 'gameplayCentreY', label: 'Gameplay height', type: 'range', min: 0.2, max: 0.85, step: 0.01, format: pct },
      { key: 'blurriness', label: 'Background blur', type: 'range', min: 0, max: 140, step: 2, format: px },
      { key: 'webcamWidth', label: 'Webcam size', type: 'range', min: 0.2, max: 1, step: 0.01, format: pct },
      { key: 'webcamGap', label: 'Webcam gap', type: 'range', min: 0, max: 0.15, step: 0.005, format: pct },
      { key: 'shadow', label: 'Drop shadow', type: 'check' }
    ],
    full: []
  };

  /**
   * Which regions the layout sizes itself around. Those stay free-form; the
   * rest are aspect-locked in the picker so the box the user drags is exactly
   * the box that gets used.
   */
  var ADAPTIVE_REGIONS = {
    split: [],
    overlay: ['webcam'],
    blur: ['webcam', 'gameplay'],
    full: []
  };

  /* ------------------------------------------------------------------ *
   * DOM plumbing                                                       *
   * ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }

  var el = {};
  ['status', 'btn-read', 'btn-frame', 'btn-diagnostics', 'fact-name', 'fact-size', 'fact-range',
   'fact-frame', 'scrub', 'src-w', 'src-h', 'btn-apply-size', 'tab-gameplay', 'tab-webcam',
   'picker', 'btn-detect', 'btn-suggest', 'btn-reset-regions', 'detect-note', 'r-x', 'r-y',
   'r-w', 'r-h', 'layout', 'layout-hint', 'layout-options', 'output', 'composite',
   'plan-summary', 'opt-audio', 'opt-trim', 'opt-labels', 'seq-name', 'btn-build',
   'crop-units', 'btn-calibrate', 'btn-copy-log', 'btn-clear-log', 'log'].forEach(function (id) {
    el[id] = $(id);
  });

  var logLines = [];

  function log(line) {
    var stamp = new Date().toLocaleTimeString();
    logLines.push('[' + stamp + '] ' + line);
    if (logLines.length > 400) { logLines.shift(); }
    el.log.textContent = logLines.join('\n');
    el.log.scrollTop = el.log.scrollHeight;
  }

  function setStatus(message, kind) {
    el.status.textContent = message;
    el.status.className = 'status' + (kind ? ' is-' + kind : '');
    if (kind === 'error' || kind === 'warn') { log((kind === 'error' ? 'ERROR: ' : 'WARN: ') + message); }
  }

  function busy(on, message) {
    state.busy = on;
    if (message) { setStatus(message, on ? 'busy' : 'ok'); }
    refreshEnabled();
  }

  function refreshEnabled() {
    var hasSource = !!state.source;
    var hasDims = !!state.sourceDims;
    var hasFrame = !!state.frameImage;

    el['btn-read'].disabled = state.busy;
    el['btn-frame'].disabled = state.busy || !hasSource;
    el.scrub.disabled = state.busy || !state.video;
    el['btn-detect'].disabled = state.busy || !hasFrame;
    el['btn-suggest'].disabled = state.busy || !hasDims;
    el['btn-build'].disabled = state.busy || !hasSource || !hasDims;
  }

  /* ------------------------------------------------------------------ *
   * Settings persistence                                               *
   * ------------------------------------------------------------------ */

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        layout: state.layout,
        options: state.options,
        output: state.output,
        cropUnits: state.cropUnits,
        scrub: state.scrub,
        audio: el['opt-audio'].checked,
        trim: el['opt-trim'].checked,
        labels: el['opt-labels'].checked
      }));
    } catch (e) { /* a panel with no storage is still a working panel */ }
  }

  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    var saved = null;
    if (raw) { try { saved = JSON.parse(raw); } catch (e) { saved = null; } }

    var ids = L.layoutIds();
    for (var i = 0; i < ids.length; i++) { state.options[ids[i]] = L.layoutDefaults(ids[i]); }

    if (!saved) { return; }
    if (saved.layout && L.LAYOUTS[saved.layout]) { state.layout = saved.layout; }
    if (saved.options) {
      for (var id in saved.options) {
        if (!saved.options.hasOwnProperty(id) || !state.options[id]) { continue; }
        var defaults = state.options[id];
        for (var k in saved.options[id]) {
          if (defaults.hasOwnProperty(k)) { defaults[k] = saved.options[id][k]; }
        }
      }
    }
    if (saved.output) { state.output = saved.output; }
    if (saved.cropUnits) { state.cropUnits = saved.cropUnits; }
    if (typeof saved.scrub === 'number') { state.scrub = saved.scrub; }
    if (saved.audio !== undefined) { el['opt-audio'].checked = !!saved.audio; }
    if (saved.trim !== undefined) { el['opt-trim'].checked = !!saved.trim; }
    if (saved.labels !== undefined) { el['opt-labels'].checked = !!saved.labels; }
  }

  /* ------------------------------------------------------------------ *
   * Layout option rendering                                            *
   * ------------------------------------------------------------------ */

  function renderLayoutOptions() {
    var controls = OPTION_CONTROLS[state.layout] || [];
    var values = state.options[state.layout];
    el['layout-options'].innerHTML = '';

    if (!controls.length) {
      el['layout-options'].innerHTML = '<p class="hint">This template has no options.</p>';
      return;
    }

    controls.forEach(function (control) {
      var row = document.createElement('label');
      row.className = 'opt';

      var name = document.createElement('span');
      name.textContent = control.label;
      row.appendChild(name);

      var input, readout;

      if (control.type === 'check') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!values[control.key];
        row.insertBefore(input, name);
      } else if (control.type === 'select') {
        input = document.createElement('select');
        control.options.forEach(function (pair) {
          var option = document.createElement('option');
          option.value = pair[0];
          option.textContent = pair[1];
          if (pair[0] === values[control.key]) { option.selected = true; }
          input.appendChild(option);
        });
        input.style.flex = '1';
        row.appendChild(input);
      } else {
        input = document.createElement('input');
        input.type = 'range';
        input.min = control.min;
        input.max = control.max;
        input.step = control.step;
        input.value = values[control.key];
        row.appendChild(input);
        readout = document.createElement('output');
        readout.textContent = control.format ? control.format(Number(values[control.key])) : values[control.key];
        row.appendChild(readout);
      }

      if (control.enabledWhen && !control.enabledWhen(values)) {
        input.disabled = true;
        row.style.opacity = '0.5';
      }

      input.addEventListener('input', function () {
        values[control.key] = (control.type === 'check') ? input.checked
          : (control.type === 'select' ? input.value : Number(input.value));
        if (readout && control.format) { readout.textContent = control.format(Number(input.value)); }
        // A toggle can enable another control, so re-render on those.
        if (control.type === 'check' || control.type === 'select') { renderLayoutOptions(); }
        recompute();
        persist();
      });

      el['layout-options'].appendChild(row);
    });
  }

  /* ------------------------------------------------------------------ *
   * Plan + preview                                                     *
   * ------------------------------------------------------------------ */

  var pickerCtl = null;

  function ensurePicker() {
    if (pickerCtl) { return pickerCtl; }
    pickerCtl = preview.picker(el.picker, {
      onChange: function (role, rect) {
        state.regions[role] = rect;
        writeRegionFields();
        recompute();
      },
      onCommit: function () { persist(); }
    });
    return pickerCtl;
  }

  function applyRegionLocks() {
    if (!state.plan) { return; }
    var adaptive = ADAPTIVE_REGIONS[state.layout] || [];
    var roles = ['gameplay', 'webcam'];
    roles.forEach(function (role) {
      var layer = null;
      for (var i = 0; i < state.plan.layers.length; i++) {
        if (state.plan.layers[i].role === role) { layer = state.plan.layers[i]; }
      }
      var free = adaptive.indexOf(role) >= 0 || !layer;
      ensurePicker().setLock(role, free ? null : layer.target.w / layer.target.h);
    });
  }

  function recompute() {
    if (!state.sourceDims) {
      state.plan = null;
      el['plan-summary'].innerHTML = '';
      preview.composite(el.composite, null, { output: state.output, layers: [] }, { width: 16, height: 9 });
      refreshEnabled();
      return;
    }

    if (!state.regions) { state.regions = L.defaultRegions(state.sourceDims); }

    try {
      state.plan = L.buildPlan({
        source: state.sourceDims,
        output: state.output,
        layout: state.layout,
        options: state.options[state.layout],
        regions: state.regions
      });
    } catch (e) {
      setStatus(e.message, 'error');
      state.plan = null;
      refreshEnabled();
      return;
    }

    applyRegionLocks();
    renderComposite();
    renderSummary();
    refreshEnabled();
  }

  function renderComposite() {
    // Keep the backing store at the output aspect so nothing is distorted.
    var maxW = 360;
    el.composite.width = maxW;
    el.composite.height = Math.round(maxW * state.output.height / state.output.width);
    preview.composite(el.composite, state.frameImage, state.plan, state.sourceDims);
  }

  function renderSummary() {
    if (!state.plan) { el['plan-summary'].innerHTML = ''; return; }
    var html = '';
    // Top track first, which is how the timeline reads.
    for (var i = state.plan.layers.length - 1; i >= 0; i--) {
      var layer = state.plan.layers[i];
      var detail = 'scale ' + layer.scale.toFixed(1) + '%';
      if (layer.blur > 0) { detail += ' &middot; blur ' + layer.blur; }
      if (layer.shadow) { detail += ' &middot; shadow'; }
      html += '<li><span class="role ' + layer.role + '">V' + (layer.track + 1) + ' ' + layer.role +
              '</span><span class="num">' + detail + '</span></li>';
    }
    var scaleWarning = '';
    for (var j = 0; j < state.plan.layers.length; j++) {
      if (state.plan.layers[j].scale > 260) {
        scaleWarning = '<li><span class="role">note</span><span>' +
          'the ' + state.plan.layers[j].role + ' layer is scaled past 260% &mdash; it will look soft' +
          '</span></li>';
        break;
      }
    }
    el['plan-summary'].innerHTML = html + scaleWarning;
  }

  function writeRegionFields() {
    var role = ensurePicker().getActive();
    var rect = state.regions[role];
    el['r-x'].value = (rect.x * 100).toFixed(1);
    el['r-y'].value = (rect.y * 100).toFixed(1);
    el['r-w'].value = (rect.w * 100).toFixed(1);
    el['r-h'].value = (rect.h * 100).toFixed(1);
  }

  function readRegionFields() {
    var role = ensurePicker().getActive();
    var rect = {
      x: Number(el['r-x'].value) / 100,
      y: Number(el['r-y'].value) / 100,
      w: Number(el['r-w'].value) / 100,
      h: Number(el['r-h'].value) / 100
    };
    if (!isFinite(rect.x) || !isFinite(rect.y) || !isFinite(rect.w) || !isFinite(rect.h)) { return; }
    state.regions[role] = rect;
    ensurePicker().setRegions(state.regions);
    state.regions = ensurePicker().getRegions();
    writeRegionFields();
    recompute();
    persist();
  }

  /* ------------------------------------------------------------------ *
   * Source + reference frame                                           *
   * ------------------------------------------------------------------ */

  function readSelection() {
    busy(true, 'Reading the selected clip...');
    host.inspect().then(function (res) {
      state.source = res.source;
      state.video = null;
      state.frameImage = null;
      state.frameOrigin = '';

      el['fact-name'].textContent = res.source.name || '(unnamed)';
      el['fact-range'].textContent = res.source.clipDuration
        ? (res.source.inPoint.toFixed(2) + 's - ' + res.source.outPoint.toFixed(2) + 's (' +
           res.source.clipDuration.toFixed(2) + 's)')
        : 'whole clip';
      el['seq-name'].placeholder = (res.source.name || 'clip') + ' - Vertical';

      if (res.source.width && res.source.height) {
        setSourceDims({ width: res.source.width, height: res.source.height },
                      'Premiere (' + res.source.dimensionsFrom + ')');
      } else {
        el['fact-size'].textContent = 'unknown - loading media to measure it';
      }

      log('source: ' + res.source.name + ' | ' + (res.source.mediaPath || 'no media path'));
      busy(false);
      setStatus('Loading a reference frame...', 'busy');
      return loadReferenceFrame();
    }).catch(function (err) {
      busy(false);
      setStatus(err.message, 'error');
    });
  }

  function setSourceDims(dims, provenance) {
    state.sourceDims = dims;
    el['fact-size'].textContent = dims.width + ' x ' + dims.height +
      (provenance ? ' (' + provenance + ')' : '');
    el['src-w'].value = dims.width;
    el['src-h'].value = dims.height;
    if (!state.regions) { state.regions = L.defaultRegions(dims); }
    ensurePicker().setSource(dims);
    ensurePicker().setRegions(state.regions);
    writeRegionFields();
  }

  /**
   * Prefer the media file: it shows the clip alone, at source resolution, and
   * can be scrubbed. Fall back to a still rendered by Premiere for codecs the
   * panel cannot decode - that one includes any higher tracks, so say so.
   */
  function loadReferenceFrame() {
    if (!state.source) { return Promise.resolve(); }
    var path = state.source.mediaPath;

    var viaMedia = path
      ? media.loadVideo(path).then(function (loaded) {
          state.video = loaded.video;
          if (!state.sourceDims || state.sourceDims.width !== loaded.width) {
            setSourceDims({ width: loaded.width, height: loaded.height }, 'media file');
          }
          var from = state.source.inPoint || 0;
          var to = state.source.outPoint > from ? state.source.outPoint : (loaded.duration || 0);
          var at = from + (to - from) * state.scrub;
          return media.grabFrame(loaded.video, at, 1280).then(function (frameCanvas) {
            state.frameImage = frameCanvas;
            state.frameOrigin = 'media file';
            el['fact-frame'].textContent = 'media file at ' + at.toFixed(2) + 's';
          });
        })
      : Promise.reject(new Error('Premiere did not report a media path for this clip.'));

    return viaMedia.then(function () {
      setStatus('Reference frame loaded. Pick the webcam region, or auto-detect it.', 'ok');
      afterFrameLoaded();
    }).catch(function (mediaErr) {
      log('media path unusable: ' + mediaErr.message);
      return host.exportStill({ seconds: undefined }).then(function (res) {
        return media.loadImage(res.path).then(function (img) {
          state.frameImage = img;
          state.frameOrigin = 'sequence still';
          el['fact-frame'].textContent = 'sequence still (' + res.width + ' x ' + res.height + ')';
          if (!state.sourceDims) {
            setSourceDims({ width: res.width, height: res.height }, 'sequence still');
          }
          setStatus('Using a still rendered from the sequence - it shows every visible track, ' +
                    'not just this clip.', 'warn');
          afterFrameLoaded();
        });
      }).catch(function (stillErr) {
        setStatus('No reference frame: ' + mediaErr.message + ' Still export also failed: ' +
                  stillErr.message, 'error');
        afterFrameLoaded();
      });
    });
  }

  function afterFrameLoaded() {
    if (state.frameImage) {
      ensurePicker().setImage(state.frameImage, state.sourceDims);
    }
    recompute();
    refreshEnabled();
  }

  /* ------------------------------------------------------------------ *
   * Detection                                                          *
   * ------------------------------------------------------------------ */

  function detectWebcam() {
    if (!state.frameImage) { return; }
    busy(true, 'Sampling frames and looking for the webcam box...');
    el['detect-note'].textContent = '';

    var framesPromise;
    if (state.video) {
      var from = state.source ? (state.source.inPoint || 0) : 0;
      var to = state.source && state.source.outPoint > from ? state.source.outPoint : 0;
      framesPromise = media.sampleFrames(state.video, 10, { width: 320, from: from, to: to });
    } else {
      // One frame still gives the detector the edge evidence to work with.
      framesPromise = Promise.resolve([media.imageToFrame(state.frameImage, 320)]);
    }

    framesPromise.then(function (frames) {
      var found = D.findWebcamRegion(frames);
      busy(false);

      if (!found.rect) {
        el['detect-note'].className = 'hint warn';
        el['detect-note'].textContent = 'No webcam box found (' + (found.reason || 'no candidates') +
          '). Drag the box by hand.';
        setStatus('Could not find a webcam region automatically.', 'warn');
        return;
      }

      state.regions.webcam = found.rect;
      ensurePicker().setActive('webcam');
      setActiveTab('webcam');
      ensurePicker().setRegions(state.regions);
      state.regions = ensurePicker().getRegions();
      writeRegionFields();
      recompute();
      persist();

      var wording = {
        high: 'Confident match',
        medium: 'Likely match - check the box',
        low: 'Rough guess - adjust the box'
      }[found.confidence] || 'Match';
      el['detect-note'].className = 'hint ' + (found.confidence === 'high' ? 'ok' : 'warn');
      el['detect-note'].textContent = wording + ' from ' + frames.length + ' frame(s), score ' +
        found.score.toFixed(2) + '.';
      setStatus(wording + '. Adjust the box if it is off, then build.',
                found.confidence === 'high' ? 'ok' : 'warn');
      log('detected webcam at ' + JSON.stringify(found.rect) + ' confidence=' + found.confidence);
    }).catch(function (err) {
      busy(false);
      setStatus('Detection failed: ' + err.message, 'error');
    });
  }

  function suggestGameplay() {
    if (!state.sourceDims || !state.plan) { return; }
    var gameplayLayer = null;
    for (var i = 0; i < state.plan.layers.length; i++) {
      if (state.plan.layers[i].role === 'gameplay') { gameplayLayer = state.plan.layers[i]; }
    }
    if (!gameplayLayer) { return; }

    var aspect = gameplayLayer.target.w / gameplayLayer.target.h;
    var rect = D.suggestGameplayRegion(state.regions.webcam, aspect, state.sourceDims);
    state.regions.gameplay = rect;
    ensurePicker().setActive('gameplay');
    setActiveTab('gameplay');
    ensurePicker().setRegions(state.regions);
    state.regions = ensurePicker().getRegions();
    writeRegionFields();
    recompute();
    persist();
    setStatus('Gameplay region moved clear of the webcam box.', 'ok');
  }

  /* ------------------------------------------------------------------ *
   * Build                                                              *
   * ------------------------------------------------------------------ */

  function buildSequence() {
    if (!state.plan) { setStatus('Nothing to build yet.', 'warn'); return; }

    // Send only what the host needs - the panel keeps the rest.
    var layers = state.plan.layers.map(function (layer) {
      return {
        role: layer.role,
        track: layer.track,
        crop: layer.crop,
        scale: layer.scale,
        position: layer.position,
        blur: layer.blur,
        shadow: layer.shadow
      };
    });

    var payload = {
      output: state.plan.output,
      layers: layers,
      source: state.source ? { nodeId: state.source.nodeId } : null,
      options: {
        sequenceName: el['seq-name'].value.trim() ||
                      ((state.source && state.source.name ? state.source.name : 'Clip') + ' - Vertical'),
        includeAudio: el['opt-audio'].checked,
        colorLabels: el['opt-labels'].checked,
        cropUnits: state.cropUnits
      }
    };

    if (el['opt-trim'].checked && state.source && state.source.outPoint > state.source.inPoint) {
      payload.trim = { inPoint: state.source.inPoint, outPoint: state.source.outPoint };
    }

    busy(true, 'Building the vertical sequence...');
    host.build(payload).then(function (res) {
      busy(false);
      var failed = res.layers.filter(function (r) { return !r.placed || r.transformed === false; });
      var summary = 'Built "' + res.sequence.name + '" at ' + res.sequence.width + ' x ' + res.sequence.height +
                    ' with ' + res.placed + ' layer(s).';
      if (failed.length) {
        setStatus(summary + ' ' + failed.length + ' layer(s) need a look - see Advanced > log.', 'warn');
      } else {
        setStatus(summary, 'ok');
      }
      log('build: ' + JSON.stringify(res.layers));
    }).catch(function (err) {
      busy(false);
      setStatus('Build failed: ' + err.message, 'error');
    });
  }

  /* ------------------------------------------------------------------ *
   * Wiring                                                             *
   * ------------------------------------------------------------------ */

  function setActiveTab(role) {
    el['tab-gameplay'].classList.toggle('is-on', role === 'gameplay');
    el['tab-webcam'].classList.toggle('is-on', role === 'webcam');
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function wire() {
    el['btn-read'].addEventListener('click', readSelection);
    el['btn-frame'].addEventListener('click', function () {
      busy(true, 'Reloading the reference frame...');
      loadReferenceFrame().then(function () { busy(false); });
    });

    el['btn-diagnostics'].addEventListener('click', function () {
      busy(true, 'Checking this Premiere build...');
      host.diagnostics().then(function (res) {
        busy(false);
        log('diagnostics: ' + JSON.stringify(res, null, 1));
        var caps = res.capabilities;
        var missing = Object.keys(caps).filter(function (k) { return !caps[k]; });
        setStatus('Premiere ' + res.app.version + ', ' + res.project.sequenceCount + ' sequence(s). ' +
          (missing.length ? ('Unavailable here: ' + missing.join(', ') + '. See the log.')
                          : 'Everything Framer needs is available.'),
          missing.length ? 'warn' : 'ok');
      }).catch(function (err) {
        busy(false);
        setStatus('Diagnostics failed: ' + err.message, 'error');
      });
    });

    el['btn-apply-size'].addEventListener('click', function () {
      var w = Number(el['src-w'].value), h = Number(el['src-h'].value);
      if (!(w > 15 && h > 15)) { setStatus('Enter a sensible pixel size.', 'warn'); return; }
      setSourceDims({ width: w, height: h }, 'entered by hand');
      recompute();
      setStatus('Using ' + w + ' x ' + h + ' as the source size.', 'ok');
    });

    el.scrub.addEventListener('input', debounce(function () {
      state.scrub = Number(el.scrub.value);
      persist();
      if (state.video) {
        loadReferenceFrame();
      }
    }, 220));

    el['tab-gameplay'].addEventListener('click', function () {
      ensurePicker().setActive('gameplay');
      setActiveTab('gameplay');
      writeRegionFields();
    });
    el['tab-webcam'].addEventListener('click', function () {
      ensurePicker().setActive('webcam');
      setActiveTab('webcam');
      writeRegionFields();
    });

    el['btn-detect'].addEventListener('click', detectWebcam);
    el['btn-suggest'].addEventListener('click', suggestGameplay);
    el['btn-reset-regions'].addEventListener('click', function () {
      state.regions = L.defaultRegions(state.sourceDims || { width: 1920, height: 1080 });
      ensurePicker().setRegions(state.regions);
      writeRegionFields();
      recompute();
      persist();
      setStatus('Regions reset.', 'ok');
    });

    ['r-x', 'r-y', 'r-w', 'r-h'].forEach(function (id) {
      el[id].addEventListener('change', readRegionFields);
    });

    el.layout.addEventListener('change', function () {
      state.layout = el.layout.value;
      el['layout-hint'].textContent = L.LAYOUTS[state.layout].hint;
      renderLayoutOptions();
      recompute();
      persist();
    });

    el.output.addEventListener('change', function () {
      var parts = el.output.value.split('x');
      state.output = { width: Number(parts[0]), height: Number(parts[1]) };
      recompute();
      persist();
    });

    el['crop-units'].addEventListener('change', function () {
      state.cropUnits = el['crop-units'].value;
      persist();
      log('crop units set to ' + state.cropUnits);
    });

    el['btn-calibrate'].addEventListener('click', function () {
      busy(true, 'Writing a test crop to the selected clip...');
      host.calibrateCrop({ cropUnits: state.cropUnits, probe: 25 }).then(function (res) {
        busy(false);
        setStatus(res.message + ' If it reads anything else, switch the setting above and rebuild.', 'warn');
        log('calibrate: wrote ' + res.wrote + ', read back ' + res.readBack);
      }).catch(function (err) {
        busy(false);
        setStatus('Calibration failed: ' + err.message, 'error');
      });
    });

    el['btn-build'].addEventListener('click', buildSequence);

    ['opt-audio', 'opt-trim', 'opt-labels'].forEach(function (id) {
      el[id].addEventListener('change', persist);
    });

    el['btn-copy-log'].addEventListener('click', function () {
      var text = logLines.join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          setStatus('Log copied to the clipboard.', 'ok');
        }).catch(function () { selectLog(); });
      } else { selectLog(); }
    });

    el['btn-clear-log'].addEventListener('click', function () {
      logLines = [];
      el.log.textContent = '';
    });

    function selectLog() {
      var range = document.createRange();
      range.selectNodeContents(el.log);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      setStatus('Log selected - press Cmd/Ctrl+C to copy.', 'warn');
    }
  }

  /* ------------------------------------------------------------------ *
   * Start                                                              *
   * ------------------------------------------------------------------ */

  function init() {
    host.onLog(function (line) { log(line); });

    L.layoutIds().forEach(function (id) {
      var option = document.createElement('option');
      option.value = id;
      option.textContent = L.LAYOUTS[id].label;
      el.layout.appendChild(option);
    });

    restore();

    el.layout.value = state.layout;
    el['layout-hint'].textContent = L.LAYOUTS[state.layout].hint;
    el.output.value = state.output.width + 'x' + state.output.height;
    el['crop-units'].value = state.cropUnits;
    el.scrub.value = state.scrub;

    renderLayoutOptions();
    wire();
    ensurePicker();
    setActiveTab('webcam');
    recompute();
    refreshEnabled();

    host.ping().then(function (res) {
      log('host script ready, Premiere ' + res.appVersion);
    }).catch(function (err) {
      setStatus('The host script did not load: ' + err.message, 'error');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
