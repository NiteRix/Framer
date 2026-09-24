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
  var SZ = root.Framer.safezones;
  var safeview = root.Framer.safeview;

  var STORE_KEY = 'framer.settings.v2';
  var BUILDS_KEY = 'framer.builds.v1';   // what was built where, for Focus moments
  var MAX_BUILDS = 30;

  var state = {
    source: null,          // what framerInspect() reported
    sourceDims: null,      // {width,height} - from metadata, media, or typed in
    frameImage: null,      // <img> or <canvas> used for both previews
    video: null,           // decoded media, when the panel can read the codec
    frameOrigin: '',       // 'premiere' | 'media file' | ''
    dimsAssumed: false,    // true when the source size was taken from the sequence frame
    frameRequest: 0,       // guards against a slow render overwriting a newer one
    regions: null,
    gameplayPlaced: false, // the user has put the gameplay box somewhere themselves
    layout: 'overlay',
    options: {},           // per layout id
    output: { width: 1080, height: 1920 },
    cropUnits: 'percent',
    cropMode: 'minimal',   // 'minimal' keeps each layer's full frame; 'tight' crops to the region
    scrub: 0.35,
    plan: null,
    busy: false,
    safe: {
      platform: 'tiktok',  // 'tiktok' | 'shorts' | 'reels' | 'all'
      source: 'preview',   // 'preview' (the layout being set up) | 'premiere' (the playhead)
      ui: true, outline: true, shade: false,
      follow: false,
      still: null,         // the last frame Premiere rendered at the playhead
      stillSize: null,     // that sequence's frame size
      inFlight: false,
      timer: null
    }
  };

  var SAFE_POLL_MS = 1500;
  var PLATFORM_IDS = ['tiktok', 'shorts', 'reels', 'all'];

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
   'plan-summary', 'opt-audio', 'opt-trim', 'opt-labels', 'opt-fullframe', 'seq-name', 'btn-build',
   'btn-centre-h', 'btn-centre-v', 'btn-focus-gameplay', 'btn-focus-webcam', 'btn-focus-layout', 'focus-note',
   'safe-tiktok', 'safe-shorts', 'safe-reels', 'safe-all', 'safe-src-preview', 'safe-src-premiere',
   'safe-canvas', 'safe-ui', 'safe-outline', 'safe-shade', 'safe-premiere-row', 'btn-safe-refresh',
   'safe-follow', 'safe-note',
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
    el.scrub.disabled = state.busy || !(state.video || (state.frameOrigin === 'premiere' && clipRange()));
    el['btn-detect'].disabled = state.busy || !hasFrame;
    el['btn-suggest'].disabled = state.busy || !hasDims;
    el['btn-centre-h'].disabled = state.busy || !hasDims;
    el['btn-centre-v'].disabled = state.busy || !hasDims;
    el['btn-build'].disabled = state.busy || !hasSource || !hasDims;
    el['btn-focus-gameplay'].disabled = state.busy;
    el['btn-focus-webcam'].disabled = state.busy;
    el['btn-focus-layout'].disabled = state.busy;
    el['btn-safe-refresh'].disabled = state.busy || state.safe.inFlight;
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
        cropMode: state.cropMode,
        safe: {
          platform: state.safe.platform, source: state.safe.source,
          ui: state.safe.ui, outline: state.safe.outline, shade: state.safe.shade
        },
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
    if (saved.cropMode === 'tight' || saved.cropMode === 'minimal') { state.cropMode = saved.cropMode; }
    if (saved.safe) {
      if (PLATFORM_IDS.indexOf(saved.safe.platform) >= 0) { state.safe.platform = saved.safe.platform; }
      if (saved.safe.source === 'premiere' || saved.safe.source === 'preview') { state.safe.source = saved.safe.source; }
      ['ui', 'outline', 'shade'].forEach(function (k) {
        if (typeof saved.safe[k] === 'boolean') { state.safe[k] = saved.safe[k]; }
      });
    }
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
        if (role === 'gameplay') { state.gameplayPlaced = true; }
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
      renderSafe();
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
        regions: state.regions,
        cropMode: state.cropMode
      });
    } catch (e) {
      setStatus(e.message, 'error');
      state.plan = null;
      refreshEnabled();
      return;
    }

    applyRegionLocks();
    showEffectiveRegions();
    renderComposite();
    renderSummary();
    renderSafe();
    refreshEnabled();
  }

  /**
   * The regions as the plan actually uses them. Where a layout fixes a layer's
   * shape, the region is fitted to it before use; the picker shows that fitted
   * box, so what is drawn over the frame is exactly what lands in the layer.
   * state.regions keeps what the user asked for, so switching templates
   * starts again from that rather than from another template's fit.
   */
  function effectiveRegions() {
    var eff = { gameplay: state.regions.gameplay, webcam: state.regions.webcam };
    if (state.plan) {
      state.plan.layers.forEach(function (layer) {
        if (layer.rect && eff.hasOwnProperty(layer.role)) { eff[layer.role] = layer.rect; }
      });
    }
    return eff;
  }

  function showEffectiveRegions() {
    ensurePicker().setRegions(effectiveRegions());
    writeRegionFields();
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
      if (layer.role !== 'background') { detail += ' &middot; ' + describeCrop(layer.crop); }
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

  function describeCrop(crop) {
    if (!crop) { return 'full frame'; }
    var sides = ['left', 'top', 'right', 'bottom'].filter(function (k) { return crop[k] > 0; });
    return sides.length === 4 ? 'cropped to region' : 'crop ' + sides.join(' + ');
  }

  function writeRegionFields() {
    var role = ensurePicker().getActive();
    var rect = effectiveRegions()[role];
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
    state.regions[role] = clampRegion(rect);
    if (role === 'gameplay') { state.gameplayPlaced = true; }
    recompute();
    persist();
  }

  /** Keep a typed or detected region inside the frame and at a usable size. */
  function clampRegion(rect) {
    var w = L.clamp(rect.w, 0.03, 1), h = L.clamp(rect.h, 0.03, 1);
    return { x: L.clamp(rect.x, 0, 1 - w), y: L.clamp(rect.y, 0, 1 - h), w: w, h: h };
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

      state.dimsAssumed = false;
      if (res.source.width && res.source.height) {
        setSourceDims({ width: res.source.width, height: res.source.height },
                      'Premiere (' + res.source.dimensionsFrom + ')');
      } else {
        state.sourceDims = null;
        el['fact-size'].textContent = 'unknown - Premiere could not report it';
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
    recompute();
  }

  /** The selected clip's span in sequence time, or null for a project-panel pick. */
  function clipRange() {
    var src = state.source;
    if (!src || src.seqStart === null || src.seqStart === undefined || !(src.seqEnd > src.seqStart)) {
      return null;
    }
    return { from: src.seqStart, to: src.seqEnd };
  }

  /** Sequence time a fraction of the way through the clip, kept clear of the cuts. */
  function timeInClip(range, fraction) {
    var f = Math.min(0.97, Math.max(0.03, fraction));
    return range.from + (range.to - range.from) * f;
  }

  /**
   * Premiere renders the reference frame. It decodes anything it can import,
   * whereas the panel's embedded browser cannot decode ordinary H.264 MP4s -
   * so decoding in the panel is only the fallback, for when Premiere refuses.
   */
  function loadReferenceFrame() {
    if (!state.source) { return Promise.resolve(); }
    var request = ++state.frameRequest;

    return renderStill().then(function (loaded) {
      if (request !== state.frameRequest) { return; }
      showStill(loaded);
      afterFrameLoaded();
    }).catch(function (stillErr) {
      if (request !== state.frameRequest) { return; }
      log('Premiere could not render a still: ' + stillErr.message);
      return loadFromMedia().then(function () {
        if (request !== state.frameRequest) { return; }
        setStatus('Reference frame decoded by the panel. Pick the webcam region, or auto-detect it.', 'ok');
        afterFrameLoaded();
      }).catch(function (mediaErr) {
        if (request !== state.frameRequest) { return; }
        setStatus('No reference frame. Premiere would not render one (' + stillErr.message +
                  ') and the panel could not decode the file (' + mediaErr.message + ').', 'error');
        afterFrameLoaded();
      });
    });
  }

  /** Ask Premiere for the frame at the scrub position and load it. */
  function renderStill() {
    var range = clipRange();
    var args = range ? { times: [timeInClip(range, state.scrub)] } : {};
    return host.exportStills(args).then(function (res) {
      var still = res.stills[0];
      return media.loadImage(still.path).then(function (img) {
        return { img: img, still: still, width: res.width, height: res.height };
      });
    });
  }

  function showStill(loaded) {
    state.video = null;
    state.frameImage = loaded.img;
    state.frameOrigin = 'premiere';
    el['fact-frame'].textContent = 'rendered by Premiere at ' + loaded.still.seconds.toFixed(2) + 's';

    if (!state.sourceDims) {
      // Nothing reported the clip's own size, so the sequence frame is the best
      // evidence left. Right whenever the clip fills the sequence unscaled.
      state.dimsAssumed = true;
      setSourceDims({ width: loaded.width, height: loaded.height }, 'assumed from the sequence');
      setStatus('Could not read the clip’s pixel size, so it is assumed to match the sequence (' +
                loaded.width + ' x ' + loaded.height + '). If the clip is a different size, set it under ' +
                '“Source size is wrong?”.', 'warn');
      return;
    }

    var clipAspect = state.sourceDims.width / state.sourceDims.height;
    var frameAspect = loaded.width / loaded.height;
    if (Math.abs(clipAspect - frameAspect) > 0.01) {
      setStatus('The sequence is ' + loaded.width + ' x ' + loaded.height + ' but the clip is ' +
                state.sourceDims.width + ' x ' + state.sourceDims.height + ', so the reference frame ' +
                'will not line up with the clip. Read the selection from a sequence that matches it.', 'warn');
      return;
    }
    if (!state.dimsAssumed) {
      setStatus('Reference frame loaded. Pick the webcam region, or auto-detect it.', 'ok');
    }
  }

  /** Fallback: decode the media file in the panel. Only some codecs work. */
  function loadFromMedia() {
    var path = state.source.mediaPath;
    if (!path) { return Promise.reject(new Error('no media path')); }
    return media.loadVideo(path).then(function (loaded) {
      state.video = loaded.video;
      if (!state.sourceDims || state.dimsAssumed) {
        state.dimsAssumed = false;
        setSourceDims({ width: loaded.width, height: loaded.height }, 'media file');
      }
      return grabFromVideo();
    });
  }

  function grabFromVideo() {
    var from = state.source.inPoint || 0;
    var to = state.source.outPoint > from ? state.source.outPoint : (state.video.duration || 0);
    var at = from + (to - from) * state.scrub;
    return media.grabFrame(state.video, at, 1280).then(function (frameCanvas) {
      state.frameImage = frameCanvas;
      state.frameOrigin = 'media file';
      el['fact-frame'].textContent = 'decoded by the panel at ' + at.toFixed(2) + 's';
    });
  }

  /** Scrubbing: fetch a new frame the same way the current one was fetched. */
  function refreshFrame() {
    var request = ++state.frameRequest;
    var next = state.frameOrigin === 'premiere' ? renderStill().then(function (loaded) {
      if (request === state.frameRequest) { showStill(loaded); }
    }) : (state.video ? grabFromVideo() : Promise.resolve());

    return next.then(function () {
      if (request === state.frameRequest) { afterFrameLoaded(); }
    }).catch(function (err) {
      log('could not refresh the frame: ' + err.message);
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
    var range = clipRange();
    if (state.frameOrigin === 'premiere' && range) {
      // Motion evidence needs frames from across the clip; Premiere renders them.
      var times = [];
      for (var i = 0; i < 8; i++) { times.push(timeInClip(range, (i + 0.5) / 8)); }
      setStatus('Rendering ' + times.length + ' frames in Premiere to look for the webcam box...', 'busy');
      framesPromise = host.exportStills({ times: times }).then(function (res) {
        return Promise.all(res.stills.map(function (still) { return media.loadImage(still.path); }));
      }).then(function (images) {
        return images.map(function (img) { return media.imageToFrame(img, 320); });
      });
    } else if (state.video) {
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

      state.regions.webcam = clampRegion(found.rect);
      ensurePicker().setActive('webcam');
      setActiveTab('webcam');
      recompute();
      persist();

      // A gameplay box nobody has placed yet would take the webcam in with it,
      // showing the face twice - so frame it clear of the webcam now.
      var autoFitted = false;
      if (!state.gameplayPlaced && L.LAYOUTS[state.layout].usesWebcam) {
        var gp = effectiveRegions().gameplay;
        if (D._internals.intersects(gp, state.regions.webcam)) {
          fitGameplay();
          ensurePicker().setActive('webcam');
          setActiveTab('webcam');
          writeRegionFields();
          autoFitted = true;
        }
      }

      var wording = {
        high: 'Confident match',
        medium: 'Likely match - check the box',
        low: 'Rough guess - adjust the box'
      }[found.confidence] || 'Match';
      el['detect-note'].className = 'hint ' + (found.confidence === 'high' ? 'ok' : 'warn');
      el['detect-note'].textContent = wording + ' from ' + frames.length + ' frame(s), score ' +
        found.score.toFixed(2) + '.';
      setStatus(wording + '. ' + (autoFitted ? 'The gameplay was moved clear of it. ' : '') +
                'Adjust the boxes if they are off, then build.',
                found.confidence === 'high' ? 'ok' : 'warn');
      log('detected webcam at ' + JSON.stringify(found.rect) + ' confidence=' + found.confidence);
    }).catch(function (err) {
      busy(false);
      setStatus('Detection failed: ' + err.message, 'error');
    });
  }

  function suggestGameplay() {
    var fitted = fitGameplay();
    if (!fitted) { return; }
    state.gameplayPlaced = true;
    ensurePicker().setActive('gameplay');
    setActiveTab('gameplay');
    writeRegionFields();

    var rect = fitted.rect, webcam = fitted.webcam;
    var cx = rect.x + rect.w / 2;
    var clear = !webcam || !D._internals.intersects(rect, webcam);
    if (!clear) {
      setStatus('The webcam box sits where no gameplay crop can avoid it, so the gameplay is centred over it. ' +
                'Drag it to taste.', 'warn');
    } else if (Math.abs(cx - 0.5) < 0.005) {
      setStatus('Gameplay centred' + (webcam ? ', clear of the webcam box.' : '.'), 'ok');
    } else {
      setStatus('Gameplay framed as close to the centre as it goes without taking in the webcam box. ' +
                'Use Centre to override.', 'ok');
    }
  }

  /** Frame the gameplay centred and clear of the webcam. Returns what it used. */
  function fitGameplay() {
    if (!state.sourceDims || !state.plan) { return null; }
    var gameplayLayer = null;
    for (var i = 0; i < state.plan.layers.length; i++) {
      if (state.plan.layers[i].role === 'gameplay') { gameplayLayer = state.plan.layers[i]; }
    }
    if (!gameplayLayer) { return null; }

    var aspect = gameplayLayer.target.w / gameplayLayer.target.h;
    var usesWebcam = L.LAYOUTS[state.layout].usesWebcam;
    // The webcam box as marked, not as padded out to its band's shape: only
    // the overlay itself must stay out of the gameplay.
    var webcam = usesWebcam ? state.regions.webcam : null;
    var rect = D.suggestGameplayRegion(webcam, aspect, state.sourceDims);
    state.regions.gameplay = rect;
    recompute();
    persist();
    return { rect: rect, webcam: webcam };
  }

  /** Centre the selected box across ('h') or up and down ('v'), keeping its size. */
  function centreRegion(axis) {
    if (!state.sourceDims) { return; }
    var role = ensurePicker().getActive();
    var r = effectiveRegions()[role];
    var next = { x: r.x, y: r.y, w: r.w, h: r.h };
    if (axis === 'h') { next.x = 0.5 - next.w / 2; } else { next.y = 0.5 - next.h / 2; }
    state.regions[role] = next;
    if (role === 'gameplay') { state.gameplayPlaced = true; }
    recompute();
    setStatus((role === 'gameplay' ? 'Gameplay' : 'Webcam') + ' box centred ' +
              (axis === 'h' ? 'across the frame.' : 'top to bottom.'), 'ok');
  }

  /* ------------------------------------------------------------------ *
   * Safe zones                                                         *
   * ------------------------------------------------------------------ */

  var safeFrame = null;   // offscreen canvas the layout preview is drawn into

  /** The layout preview as a bare frame at the output size, for the phone view. */
  function layoutFrame() {
    if (!state.plan || !state.frameImage) { return null; }
    safeFrame = safeFrame || document.createElement('canvas');
    safeFrame.width = 540;
    safeFrame.height = Math.round(540 * state.output.height / state.output.width);
    preview.composite(safeFrame, state.frameImage, state.plan, state.sourceDims, true);
    return safeFrame;
  }

  function renderSafe() {
    var sf = state.safe;
    var fromPremiere = sf.source === 'premiere';
    var frame = fromPremiere ? sf.still : layoutFrame();
    var output = (fromPremiere && sf.stillSize) ? sf.stillSize : state.output;
    var webcam = null;
    if (!fromPremiere && state.plan) {
      state.plan.layers.forEach(function (l) { if (l.role === 'webcam') { webcam = l.visible; } });
    }

    safeview.draw(el['safe-canvas'], {
      frame: frame,
      output: output,
      platform: sf.platform,
      showUI: sf.ui,
      showSafe: sf.outline,
      shade: sf.shade,
      highlight: webcam,
      message: fromPremiere ? 'Grab the playhead frame' : 'Read a clip to preview it'
    });
    writeSafeNote(fromPremiere, output, webcam);
  }

  function writeSafeNote(fromPremiere, output, webcam) {
    var note = el['safe-note'];
    var sf = state.safe;
    var who = sf.platform === 'all' ? 'any of the three apps\u2019' : SZ.platform(sf.platform).label + '\u2019s';

    if (fromPremiere) {
      if (!sf.still) {
        note.className = 'hint';
        note.textContent = 'Open the vertical sequence in Premiere, park the playhead, and grab the frame.';
      } else if (sf.stillSize && sf.stillSize.width > sf.stillSize.height) {
        note.className = 'hint warn';
        note.textContent = 'The open sequence is ' + sf.stillSize.width + ' x ' + sf.stillSize.height +
          ' - horizontal. Open the vertical sequence Framer built to check it.';
      } else {
        note.className = 'hint';
        note.textContent = 'The frame under the playhead' + (sf.follow ? ', kept up to date' : '') + '.';
      }
      return;
    }
    if (!webcam) {
      note.className = 'hint';
      note.textContent = state.plan ? 'No webcam layer in this template.' : '';
      return;
    }

    var cov = SZ.coverage(webcam, sf.platform, output);
    var hits = cov.zones.filter(function (z) { return z.share >= 0.03; });
    if (!hits.length) {
      note.className = 'hint ok';
      note.textContent = 'The webcam is clear of ' + who + ' buttons and captions.';
      return;
    }
    note.className = 'hint warn';
    note.textContent = 'The webcam is partly hidden on ' + (sf.platform === 'all' ? 'at least one app' :
      SZ.platform(sf.platform).label) + ': ' + hits.map(function (z) {
        return Math.round(z.share * 100) + '% under ' + z.label;
      }).join(', ') + '.' + (cov.outside > 0.25 ? ' Move or resize it towards the clear area.' : '');
  }

  function setSafePlatform(id) {
    state.safe.platform = id;
    PLATFORM_IDS.forEach(function (p) { el['safe-' + p].classList.toggle('is-on', p === id); });
    renderSafe();
    persist();
  }

  function setSafeSource(source) {
    state.safe.source = source;
    el['safe-src-preview'].classList.toggle('is-on', source === 'preview');
    el['safe-src-premiere'].classList.toggle('is-on', source === 'premiere');
    el['safe-premiere-row'].hidden = source !== 'premiere';
    if (source === 'premiere' && !state.safe.still) { grabPlayheadFrame(false); }
    scheduleSafePoll();
    renderSafe();
    persist();
  }

  /** Ask Premiere for the frame under the playhead of whatever sequence is open. */
  function grabPlayheadFrame(quiet) {
    var sf = state.safe;
    if (sf.inFlight) { return Promise.resolve(); }
    sf.inFlight = true;
    refreshEnabled();
    return host.exportStills({ tag: 'safe', quiet: !!quiet }).then(function (res) {
      var still = res.stills[0];
      return media.loadImage(still.path).then(function (img) {
        sf.still = img;
        sf.stillSize = (res.width && res.height) ? { width: res.width, height: res.height }
          : { width: img.naturalWidth, height: img.naturalHeight };
      });
    }).catch(function (err) {
      if (!quiet) { setStatus('Could not grab the playhead frame: ' + err.message, 'error'); }
      else { log('safe zones: ' + err.message); }
    }).then(function () {
      sf.inFlight = false;
      refreshEnabled();
      if (sf.source === 'premiere') { renderSafe(); }
    });
  }

  /** While following the playhead, re-grab the frame every so often. */
  function scheduleSafePoll() {
    var sf = state.safe;
    clearInterval(sf.timer);
    sf.timer = null;
    if (sf.source !== 'premiere' || !sf.follow) { return; }
    sf.timer = setInterval(function () {
      // Never compete with the panel's own renders, and rest while hidden.
      if (state.busy || sf.inFlight || document.hidden) { return; }
      grabPlayheadFrame(true);
    }, SAFE_POLL_MS);
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

    var record = buildRecord();
    busy(true, 'Building the vertical sequence...');
    host.build(payload).then(function (res) {
      busy(false);
      saveBuildRecord(res.sequence, record);
      var failed = res.layers.filter(function (r) { return !r.placed || r.transformed === false; });
      var summary = 'Built "' + res.sequence.name + '" at ' + res.sequence.width + ' x ' + res.sequence.height +
                    ' with ' + res.placed + ' layer(s).';
      if (res.audioClips > 1) {
        summary += ' The audio is on ' + res.audioClips + ' tracks - see Advanced > log.';
      }
      if (failed.length) {
        setStatus(summary + ' ' + failed.length + ' layer(s) need a look - see Advanced > log.', 'warn');
      } else {
        setStatus(summary, res.audioClips > 1 ? 'warn' : 'ok');
      }
      log('build: ' + JSON.stringify(res.layers));
    }).catch(function (err) {
      busy(false);
      setStatus('Build failed: ' + err.message, 'error');
    });
  }

  /* ------------------------------------------------------------------ *
   * Focus moments                                                      *
   * ------------------------------------------------------------------ */

  /**
   * What the host needs to re-shape pieces of a built sequence later: which
   * track holds which layer, the layout values, and the full-frame values for
   * a moment that shows only the gameplay or only the webcam.
   */
  function buildRecord() {
    if (!state.plan || !state.sourceDims) { return null; }
    var spec = { source: state.sourceDims, output: state.output, regions: state.regions };
    var roles = {};
    var layers = state.plan.layers.map(function (layer) {
      roles[layer.role] = true;
      return {
        role: layer.role, track: layer.track, crop: layer.crop, scale: layer.scale,
        position: layer.position, blur: layer.blur, shadow: layer.shadow
      };
    });
    var focus = {};
    ['gameplay', 'webcam'].forEach(function (role) {
      if (!roles[role]) { return; }
      var t = L.focusTransform(spec, role);
      focus[role] = { crop: t.crop, scale: t.scale, position: t.position };
    });
    return { name: '', layout: state.layout, savedAt: Date.now(), layers: layers, focus: focus };
  }

  function loadBuildRecords() {
    try {
      var raw = localStorage.getItem(BUILDS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveBuildRecord(sequence, record) {
    if (!record || !sequence) { return; }
    record.name = sequence.name;
    var all = loadBuildRecords();
    all[sequence.id || ('name:' + sequence.name)] = record;
    // Keep the most recent builds only.
    var keys = Object.keys(all).sort(function (a, b) { return (all[b].savedAt || 0) - (all[a].savedAt || 0); });
    keys.slice(MAX_BUILDS).forEach(function (k) { delete all[k]; });
    try { localStorage.setItem(BUILDS_KEY, JSON.stringify(all)); } catch (e) { /* focus falls back to the current layout */ }
  }

  /** The record Focus used for a sequence the host names, if the panel has it. */
  function focusRecordFor(sequence) {
    var all = loadBuildRecords();
    if (sequence && sequence.id && all[sequence.id]) { return all[sequence.id]; }
    for (var k in all) {
      if (all.hasOwnProperty(k) && sequence && all[k].name === sequence.name) { return all[k]; }
    }
    return buildRecord();
  }

  function focusMoment(mode) {
    var wording = {
      gameplay: 'Switching the selected moment to gameplay only...',
      webcam: 'Switching the selected moment to webcam only...',
      layout: 'Putting the selected moment back to the layout...'
    };
    el['focus-note'].textContent = '';
    busy(true, wording[mode]);
    host.focus({
      mode: mode,
      records: loadBuildRecords(),
      fallback: buildRecord(),
      cropUnits: state.cropUnits
    }).then(function (res) {
      busy(false);
      var what = { gameplay: 'Gameplay only', webcam: 'Webcam only', layout: 'Back to the layout' }[mode];
      var msg = what + ' for ' + res.moments + ' moment' + (res.moments === 1 ? '' : 's') +
                ' (' + res.clips + ' clip' + (res.clips === 1 ? '' : 's') + ').';
      var used = focusRecordFor(res.sequence);
      var full = used && used.focus && used.focus[mode];
      if (full && full.scale > 260) {
        msg += ' The ' + mode + ' is scaled to ' + Math.round(full.scale) + '% there, so it will look soft.';
      }
      if (res.warnings) {
        setStatus(msg + ' Some clips need a look - see Advanced > log.', 'warn');
      } else {
        setStatus(msg, 'ok');
      }
      el['focus-note'].className = 'hint ' + (res.warnings ? 'warn' : 'ok');
      el['focus-note'].textContent = msg;
    }).catch(function (err) {
      busy(false);
      setStatus(err.message, 'error');
      el['focus-note'].className = 'hint warn';
      el['focus-note'].textContent = err.message;
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
      refreshFrame();
    }, 350));

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
    el['btn-centre-h'].addEventListener('click', function () { centreRegion('h'); });
    el['btn-centre-v'].addEventListener('click', function () { centreRegion('v'); });
    PLATFORM_IDS.forEach(function (id) {
      el['safe-' + id].addEventListener('click', function () { setSafePlatform(id); });
    });
    el['safe-src-preview'].addEventListener('click', function () { setSafeSource('preview'); });
    el['safe-src-premiere'].addEventListener('click', function () { setSafeSource('premiere'); });
    [['safe-ui', 'ui'], ['safe-outline', 'outline'], ['safe-shade', 'shade']].forEach(function (pair) {
      el[pair[0]].addEventListener('change', function () {
        state.safe[pair[1]] = el[pair[0]].checked;
        renderSafe();
        persist();
      });
    });
    el['btn-safe-refresh'].addEventListener('click', function () { grabPlayheadFrame(false); });
    el['safe-follow'].addEventListener('change', function () {
      state.safe.follow = el['safe-follow'].checked;
      scheduleSafePoll();
      renderSafe();
    });
    el['btn-focus-gameplay'].addEventListener('click', function () { focusMoment('gameplay'); });
    el['btn-focus-webcam'].addEventListener('click', function () { focusMoment('webcam'); });
    el['btn-focus-layout'].addEventListener('click', function () { focusMoment('layout'); });
    el['opt-fullframe'].addEventListener('change', function () {
      state.cropMode = el['opt-fullframe'].checked ? 'minimal' : 'tight';
      recompute();
      persist();
    });
    el['btn-reset-regions'].addEventListener('click', function () {
      state.regions = L.defaultRegions(state.sourceDims || { width: 1920, height: 1080 });
      state.gameplayPlaced = false;
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
      if (copyText(logLines.join('\n'))) {
        setStatus('Log copied to the clipboard.', 'ok');
      } else {
        selectLog();
      }
    });

    /**
     * CEP's browser has no async Clipboard API, so copy the old way: through a
     * selected, off-screen textarea and execCommand.
     */
    function copyText(text) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;-webkit-user-select:text;user-select:text;';
      document.body.appendChild(area);
      area.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
      document.body.removeChild(area);
      return copied;
    }

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
    el['opt-fullframe'].checked = state.cropMode === 'minimal';
    el['safe-ui'].checked = state.safe.ui;
    el['safe-outline'].checked = state.safe.outline;
    el['safe-shade'].checked = state.safe.shade;
    PLATFORM_IDS.forEach(function (p) { el['safe-' + p].classList.toggle('is-on', p === state.safe.platform); });
    el['safe-src-preview'].classList.toggle('is-on', state.safe.source === 'preview');
    el['safe-src-premiere'].classList.toggle('is-on', state.safe.source === 'premiere');
    el['safe-premiere-row'].hidden = state.safe.source !== 'premiere';
    el.scrub.value = state.scrub;

    renderLayoutOptions();
    wire();
    ensurePicker();
    setActiveTab('webcam');
    recompute();
    refreshEnabled();

    host.ping().then(function (res) {
      log('host script ready, Premiere ' + res.appVersion);
      if (state.safe.source === 'premiere') { grabPlayheadFrame(true); }
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
