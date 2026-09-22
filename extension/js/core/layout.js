/**
 * Framer - layout engine
 * ----------------------
 * Pure geometry. No Premiere, no DOM, no CEP: it takes source dimensions plus
 * normalised source regions and returns the exact Motion/Crop values the host
 * script should write onto each clip. Runs in the panel and under Node (tests).
 *
 * How a layer is reproduced in Premiere
 * ------------------------------------
 * A "layer" is one more copy of the same source clip on its own video track.
 * Three parameters shape it:
 *
 *   1. Crop (Left/Top/Right/Bottom)  - throws away everything outside the
 *      region. The frame keeps its original size; the discarded pixels just
 *      become transparent. Cropping does NOT recentre the clip.
 *   2. Motion > Scale                - scales the whole frame about the anchor
 *      point, which defaults to the centre of the frame (not of the region).
 *   3. Motion > Position             - places the frame centre, normalised to
 *      the sequence frame size (0.5,0.5 being the middle of the sequence).
 *
 * So the visible region's centre ends up at:
 *
 *      position_px + scale * (regionCentre - frameCentre)
 *
 * Solving that for position is what solveLayer() does. Everything else in this
 * file exists to pick the region and target rectangles that go into it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Framer = root.Framer || {};
    root.Framer.layout = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_OUTPUT = { width: 1080, height: 1920 };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function round(v, dp) {
    var f = Math.pow(10, dp === undefined ? 4 : dp);
    return Math.round(v * f) / f;
  }

  /** Pixel aspect ratio of a normalised region inside a WxH frame. */
  function regionAspect(rect, width, height) {
    return (rect.w * width) / (rect.h * height);
  }

  /**
   * Adjust a normalised region so its pixel aspect matches targetAspect,
   * keeping the centre where the user put it and staying inside the frame.
   *
   * mode 'expand' (default) grows the short axis so nothing the user selected
   * is thrown away; 'shrink' trims the long axis instead. If the frame is too
   * small to expand, both axes are scaled down together, which preserves the
   * aspect we just solved for.
   */
  function fitRectToAspect(rect, targetAspect, width, height, mode) {
    var cx = rect.x + rect.w / 2;
    var cy = rect.y + rect.h / 2;
    var wpx = rect.w * width;
    var hpx = rect.h * height;
    var current = wpx / hpx;

    if (mode === 'shrink') {
      if (current > targetAspect) { wpx = hpx * targetAspect; }
      else { hpx = wpx / targetAspect; }
    } else {
      if (current > targetAspect) { hpx = wpx / targetAspect; }
      else { wpx = hpx * targetAspect; }
    }

    // Scaling both axes by the same factor keeps the pixel aspect intact.
    var k = Math.min(1, width / wpx, height / hpx);
    wpx *= k;
    hpx *= k;

    var w = wpx / width;
    var h = hpx / height;
    cx = clamp(cx, w / 2, 1 - w / 2);
    cy = clamp(cy, h / 2, 1 - h / 2);

    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }

  /**
   * Solve one layer.
   *
   * opts.source  {width,height}      source media pixel dimensions
   * opts.output  {width,height}      sequence pixel dimensions
   * opts.rect    {x,y,w,h}|null      normalised source region; null = whole frame
   * opts.target  {x,y,w,h}           destination rectangle in sequence pixels
   * opts.fit     'cover'|'contain'|'exact'
   *
   * 'exact' assumes rect already matches target's aspect (see fitRectToAspect)
   * and is the mode every aspect-matched layer uses: the region lands on the
   * target rectangle with no spill and no letterboxing.
   */
  function solveLayer(opts) {
    var W = opts.source.width, H = opts.source.height;
    var SW = opts.output.width, SH = opts.output.height;
    var rect = opts.rect || { x: 0, y: 0, w: 1, h: 1 };
    var target = opts.target;
    var fit = opts.fit || 'exact';

    var rwpx = rect.w * W;
    var rhpx = rect.h * H;

    var scale;
    if (fit === 'contain') {
      scale = Math.min(target.w / rwpx, target.h / rhpx);
    } else if (fit === 'cover') {
      scale = Math.max(target.w / rwpx, target.h / rhpx);
    } else {
      // Average the two so a sub-pixel aspect mismatch does not bias one axis.
      scale = (target.w / rwpx + target.h / rhpx) / 2;
    }

    // Offset of the region centre from the frame centre, in source pixels.
    var dx = (rect.x + rect.w / 2 - 0.5) * W;
    var dy = (rect.y + rect.h / 2 - 0.5) * H;

    var tcx = target.x + target.w / 2;
    var tcy = target.y + target.h / 2;

    var posX = (tcx - scale * dx) / SW;
    var posY = (tcy - scale * dy) / SH;

    var isFullFrame = rect.x <= 0 && rect.y <= 0 && rect.w >= 1 && rect.h >= 1;

    return {
      /** Where the whole, uncropped source frame lands, in sequence pixels. */
      frame: {
        x: round(posX * SW - scale * W / 2, 2),
        y: round(posY * SH - scale * H / 2, 2),
        w: round(scale * W, 2),
        h: round(scale * H, 2)
      },
      crop: isFullFrame ? null : {
        left: round(rect.x * 100),
        top: round(rect.y * 100),
        right: round((1 - (rect.x + rect.w)) * 100),
        bottom: round((1 - (rect.y + rect.h)) * 100)
      },
      scale: round(scale * 100),
      position: [round(posX, 6), round(posY, 6)],
      /** Where the region actually lands, in sequence pixels (for preview/tests). */
      visible: {
        x: round(tcx - scale * rwpx / 2, 2),
        y: round(tcy - scale * rhpx / 2, 2),
        w: round(scale * rwpx, 2),
        h: round(scale * rhpx, 2)
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Layouts                                                            *
   * ------------------------------------------------------------------ *
   * A layout turns options into destination rectangles in the vertical
   * canvas, bottom-most layer first. It never touches source regions -
   * buildPlan() pairs them up afterwards.
   */

  var LAYOUTS = {
    /**
     * Two stacked bands: webcam on one, gameplay on the other. The classic
     * StreamLadder "split" template.
     */
    split: {
      id: 'split',
      label: 'Split - stacked bands',
      hint: 'Webcam band above, gameplay below. Both fill the full width.',
      usesWebcam: true,
      defaults: { webcamShare: 0.34, gap: 0, webcamFirst: true, background: 'blur', blurriness: 40 },
      build: function (o, out) {
        var gap = Math.round(o.gap);
        var camH = Math.round((out.height - gap) * o.webcamShare);
        var playH = out.height - gap - camH;
        var camY = o.webcamFirst ? 0 : playH + gap;
        var playY = o.webcamFirst ? camH + gap : 0;
        var layers = [];
        if (o.background === 'blur' && gap > 0) {
          layers.push(bgLayer(out, o.blurriness));
        }
        layers.push({ role: 'gameplay', fit: 'exact', target: { x: 0, y: playY, w: out.width, h: playH } });
        layers.push({ role: 'webcam', fit: 'exact', target: { x: 0, y: camY, w: out.width, h: camH } });
        return layers;
      }
    },

    /**
     * Gameplay fills the whole 9:16 frame, webcam floats on top of it.
     * This is the "layered on top of each other" look.
     */
    overlay: {
      id: 'overlay',
      label: 'Overlay - webcam on top',
      hint: 'Gameplay fills the frame, webcam sits over it as a floating box.',
      usesWebcam: true,
      defaults: {
        webcamWidth: 0.42, anchor: 'top-left', marginX: 0.04, marginY: 0.04,
        keepWebcamAspect: true, shadow: true, background: 'none'
      },
      build: function (o, out, ctx) {
        var w = Math.round(out.width * o.webcamWidth);
        var aspect = (o.keepWebcamAspect && ctx && ctx.webcamAspect) ? ctx.webcamAspect : 16 / 9;
        // Height stays fractional on purpose: an integer would force the region
        // to be re-cropped by a pixel or two to match the box aspect.
        var h = w / aspect;
        var box = anchorBox(o.anchor, w, h, out, o.marginX, o.marginY);
        return [
          { role: 'gameplay', fit: 'exact', target: { x: 0, y: 0, w: out.width, h: out.height } },
          { role: 'webcam', fit: 'exact', target: box, shadow: !!o.shadow }
        ];
      }
    },

    /**
     * Blurred full-frame fill behind a letterboxed gameplay band, webcam
     * floating above the band. Good when cropping the gameplay would cut off
     * something important.
     */
    blur: {
      id: 'blur',
      label: 'Blurred background',
      hint: 'Uncropped gameplay band over a blurred copy of the frame.',
      usesWebcam: true,
      defaults: {
        gameplayWidth: 1.0, gameplayCentreY: 0.58, blurriness: 48,
        webcamWidth: 0.52, webcamGap: 0.02, keepWebcamAspect: true, shadow: true
      },
      build: function (o, out, ctx) {
        var playAspect = (ctx && ctx.gameplayAspect) ? ctx.gameplayAspect : 16 / 9;
        var pw = Math.round(out.width * o.gameplayWidth);
        // Fractional heights keep each band exactly the aspect of its region,
        // so nothing has to be shaved off to make it fit.
        var ph = pw / playAspect;
        var py = clamp(out.height * o.gameplayCentreY - ph / 2, 0, Math.max(0, out.height - ph));

        var cw = Math.round(out.width * o.webcamWidth);
        var camAspect = (o.keepWebcamAspect && ctx && ctx.webcamAspect) ? ctx.webcamAspect : 16 / 9;
        var ch = cw / camAspect;
        var cy = clamp(py - ch - out.height * o.webcamGap, 0, Math.max(0, out.height - ch));

        return [
          bgLayer(out, o.blurriness),
          { role: 'gameplay', fit: 'exact', target: { x: 0, y: py, w: pw, h: ph } },
          { role: 'webcam', fit: 'exact', target: { x: (out.width - cw) / 2, y: cy, w: cw, h: ch }, shadow: !!o.shadow }
        ];
      }
    },

    /** Single cropped region, no webcam layer. */
    full: {
      id: 'full',
      label: 'Fullscreen crop',
      hint: 'One region blown up to fill 9:16. No webcam layer.',
      usesWebcam: false,
      defaults: { background: 'none' },
      build: function (o, out) {
        return [{ role: 'gameplay', fit: 'exact', target: { x: 0, y: 0, w: out.width, h: out.height } }];
      }
    }
  };

  function bgLayer(out, blurriness) {
    return {
      role: 'background',
      fit: 'cover',
      wholeFrame: true,
      target: { x: 0, y: 0, w: out.width, h: out.height },
      blur: Math.max(0, blurriness || 0)
    };
  }

  function anchorBox(anchor, w, h, out, marginX, marginY) {
    var mx = Math.round(out.width * marginX);
    var my = Math.round(out.height * marginY);
    var parts = String(anchor).split('-');
    var vert = parts[0] || 'top';
    var horz = parts[1] || 'left';

    var x = horz === 'left' ? mx : (horz === 'right' ? out.width - w - mx : (out.width - w) / 2);
    var y;
    if (vert === 'top') { y = my; }
    else if (vert === 'bottom') { y = out.height - h - my; }
    else { y = (out.height - h) / 2; }

    return { x: x, y: y, w: w, h: h };
  }

  function layoutIds() {
    var ids = [];
    for (var k in LAYOUTS) { if (LAYOUTS.hasOwnProperty(k)) { ids.push(k); } }
    return ids;
  }

  function layoutDefaults(id) {
    var l = LAYOUTS[id];
    if (!l) { throw new Error('Unknown layout: ' + id); }
    var out = {};
    for (var k in l.defaults) { if (l.defaults.hasOwnProperty(k)) { out[k] = l.defaults[k]; } }
    return out;
  }

  /**
   * Sensible starting regions for a fresh clip: gameplay centred and as large
   * as the target band allows, webcam a modest box in the upper-left, which is
   * where OBS puts it by default.
   */
  function defaultRegions(source) {
    return {
      gameplay: { x: 0, y: 0, w: 1, h: 1 },
      webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.28 * (source.width / source.height) * (9 / 16) }
    };
  }

  /**
   * Turn a layout + source regions into a full plan: per-layer crop, scale and
   * position, ready to hand to the host script.
   *
   * spec.source   {width,height}
   * spec.output   {width,height}       defaults to 1080x1920
   * spec.layout   layout id
   * spec.options  layout options (missing keys fall back to defaults)
   * spec.regions  { gameplay:{x,y,w,h}, webcam:{x,y,w,h} } normalised
   * spec.cropMode 'minimal' (default) crops a layer only on the sides where
   *               the rest of its frame would show over something else;
   *               'tight' crops every layer to exactly its region
   */
  function buildPlan(spec) {
    var layout = LAYOUTS[spec.layout];
    if (!layout) { throw new Error('Unknown layout: ' + spec.layout); }

    var out = spec.output || DEFAULT_OUTPUT;
    var source = spec.source;
    if (!source || !source.width || !source.height) {
      throw new Error('Source dimensions are required');
    }

    var options = layoutDefaults(spec.layout);
    var given = spec.options || {};
    for (var k in given) { if (given.hasOwnProperty(k)) { options[k] = given[k]; } }

    var regions = spec.regions || defaultRegions(source);
    var ctx = {
      webcamAspect: regions.webcam ? regionAspect(regions.webcam, source.width, source.height) : 16 / 9,
      gameplayAspect: regions.gameplay ? regionAspect(regions.gameplay, source.width, source.height) : 16 / 9
    };

    var specs = layout.build(options, out, ctx);
    var layers = [];

    for (var i = 0; i < specs.length; i++) {
      var ls = specs[i];
      var rect = null;

      if (!ls.wholeFrame) {
        var given_rect = regions[ls.role] || defaultRegions(source)[ls.role];
        var targetAspect = ls.target.w / ls.target.h;
        // Match the region to its band so it fills the band exactly: no black
        // edges, and no pixels spilling into the neighbouring layer.
        rect = fitRectToAspect(given_rect, targetAspect, source.width, source.height,
                               spec.aspectMode || 'expand');
      }

      var solved = solveLayer({
        source: source, output: out, rect: rect,
        target: ls.target, fit: ls.wholeFrame ? ls.fit : 'exact'
      });

      layers.push({
        role: ls.role,
        track: i,                 // 0 = bottom-most video track
        rect: rect,               // the aspect-corrected region actually used
        target: ls.target,
        crop: solved.crop,
        scale: solved.scale,
        position: solved.position,
        visible: solved.visible,
        frame: solved.frame,
        blur: ls.blur || 0,
        shadow: !!ls.shadow
      });
    }

    var cropMode = spec.cropMode === 'tight' ? 'tight' : 'minimal';
    if (cropMode === 'minimal') {
      for (var j = 0; j < layers.length; j++) {
        if (layers[j].rect) { layers[j].crop = minimalCrop(layers, j, out); }
      }
    }

    return {
      layout: spec.layout,
      output: { width: out.width, height: out.height },
      source: { width: source.width, height: source.height },
      options: options,
      cropMode: cropMode,
      layers: layers
    };
  }

  /* ------------------------------------------------------------------ *
   * Minimal crop                                                       *
   * ------------------------------------------------------------------ *
   * A layer only has to be cropped where the rest of its frame would be
   * seen: inside the canvas, outside its own band, and not hidden under a
   * layer above it. Everything else is left on the clip, so deleting the
   * layer on top for a few seconds shows more of this one instead of black,
   * and the clip can be rescaled there without first undoing a crop.
   */

  var EPS = 0.75;   // sequence pixels; below this a sliver is rounding noise

  function intersect(a, b) {
    var x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    var x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    if (x1 - x0 <= EPS || y1 - y0 <= EPS) { return null; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** a minus b, as up to four rectangles. */
  function subtract(a, b) {
    var hit = intersect(a, b);
    if (!hit) { return [a]; }
    var out = [];
    var ax1 = a.x + a.w, ay1 = a.y + a.h, hx1 = hit.x + hit.w, hy1 = hit.y + hit.h;
    if (hit.y - a.y > EPS) { out.push({ x: a.x, y: a.y, w: a.w, h: hit.y - a.y }); }
    if (ay1 - hy1 > EPS) { out.push({ x: a.x, y: hy1, w: a.w, h: ay1 - hy1 }); }
    if (hit.x - a.x > EPS) { out.push({ x: a.x, y: hit.y, w: hit.x - a.x, h: hit.h }); }
    if (ax1 - hx1 > EPS) { out.push({ x: hx1, y: hit.y, w: ax1 - hx1, h: hit.h }); }
    return out;
  }

  /** The parts of `rect` not covered by any of `covers`. */
  function uncovered(rect, covers) {
    var pieces = [rect];
    for (var c = 0; c < covers.length && pieces.length; c++) {
      var next = [];
      for (var p = 0; p < pieces.length; p++) { next = next.concat(subtract(pieces[p], covers[c])); }
      pieces = next;
    }
    return pieces;
  }

  function minimalCrop(layers, index, out) {
    var layer = layers[index];
    var canvas = { x: 0, y: 0, w: out.width, h: out.height };
    var shown = intersect(layer.frame, canvas);
    if (!shown) { return null; }

    // The layer's own band, and whatever the layers above it always cover.
    var covers = [layer.visible];
    for (var k = index + 1; k < layers.length; k++) { covers.push(layers[k].visible); }
    var spill = uncovered(shown, covers);
    if (!spill.length) { return null; }

    var v = layer.visible;
    var sides = {
      left:   { x: shown.x, y: shown.y, w: v.x - shown.x, h: shown.h },
      right:  { x: v.x + v.w, y: shown.y, w: shown.x + shown.w - (v.x + v.w), h: shown.h },
      top:    { x: shown.x, y: shown.y, w: shown.w, h: v.y - shown.y },
      bottom: { x: shown.x, y: v.y + v.h, w: shown.w, h: shown.y + shown.h - (v.y + v.h) }
    };
    var need = {};
    for (var side in sides) {
      if (!sides.hasOwnProperty(side)) { continue; }
      need[side] = false;
      if (sides[side].w <= EPS || sides[side].h <= EPS) { continue; }
      for (var s = 0; s < spill.length; s++) {
        if (intersect(spill[s], sides[side])) { need[side] = true; break; }
      }
    }

    var tight = layer.crop || { left: 0, top: 0, right: 0, bottom: 0 };
    var crop = {
      left: need.left ? tight.left : 0,
      top: need.top ? tight.top : 0,
      right: need.right ? tight.right : 0,
      bottom: need.bottom ? tight.bottom : 0
    };
    if (!crop.left && !crop.top && !crop.right && !crop.bottom) { return null; }
    return crop;
  }

  /**
   * Motion values that make one layer fill the whole canvas on its own - what
   * a "gameplay only" or "webcam only" moment uses. The gameplay keeps as
   * much of its region as the canvas shape allows; the webcam is cut in to
   * the middle of its box, which is what a reaction shot wants. Nothing is
   * cropped: the frame fills the canvas and the rest falls outside it.
   */
  function focusTransform(spec, role) {
    var out = spec.output || DEFAULT_OUTPUT;
    var source = spec.source;
    if (!source || !source.width || !source.height) {
      throw new Error('Source dimensions are required');
    }
    var regions = spec.regions || defaultRegions(source);
    var region = regions[role] || defaultRegions(source)[role];
    var rect = fitRectToAspect(region, out.width / out.height, source.width, source.height,
                               role === 'webcam' ? 'shrink' : 'expand');
    var solved = solveLayer({
      source: source, output: out, rect: rect,
      target: { x: 0, y: 0, w: out.width, h: out.height }, fit: 'exact'
    });
    return { role: role, rect: rect, crop: null, scale: solved.scale, position: solved.position };
  }

  /** Map a normalised source rectangle through a layer's placement, in sequence pixels. */
  function placeSourceRect(layer, src) {
    var f = layer.frame;
    return { x: f.x + src.x * f.w, y: f.y + src.y * f.h, w: src.w * f.w, h: src.h * f.h };
  }

  /** The part of the source frame a crop leaves, normalised. */
  function cropToRect(crop) {
    if (!crop) { return { x: 0, y: 0, w: 1, h: 1 }; }
    return {
      x: crop.left / 100,
      y: crop.top / 100,
      w: 1 - (crop.left + crop.right) / 100,
      h: 1 - (crop.top + crop.bottom) / 100
    };
  }

  return {
    DEFAULT_OUTPUT: DEFAULT_OUTPUT,
    LAYOUTS: LAYOUTS,
    layoutIds: layoutIds,
    layoutDefaults: layoutDefaults,
    defaultRegions: defaultRegions,
    regionAspect: regionAspect,
    fitRectToAspect: fitRectToAspect,
    solveLayer: solveLayer,
    buildPlan: buildPlan,
    focusTransform: focusTransform,
    placeSourceRect: placeSourceRect,
    cropToRect: cropToRect,
    clamp: clamp
  };
}));
