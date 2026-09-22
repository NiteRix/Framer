/**
 * Framer - preview rendering and region picking
 * ---------------------------------------------
 * Two canvases:
 *   picker()    - the source frame with draggable gameplay / webcam regions
 *   composite() - the 9:16 result, drawn from the same plan the host will build
 *
 * The composite only draws what Premiere can actually reproduce, so what the
 * panel shows is what the sequence renders.
 */
(function (root) {
  'use strict';
  root.Framer = root.Framer || {};

  var HANDLE = 7;           // hit radius for corner/edge handles, in CSS px
  var COLORS = {
    gameplay: '#4aa8ff',
    webcam: '#ffb347',
    inactive: 'rgba(255,255,255,0.35)'
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ------------------------------------------------------------------ *
   * Region picker                                                      *
   * ------------------------------------------------------------------ */

  function picker(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var image = null;                       // <img> or <canvas>
    var regions = { gameplay: { x: 0, y: 0, w: 1, h: 1 }, webcam: { x: 0.02, y: 0.03, w: 0.28, h: 0.3 } };
    var active = 'webcam';
    var locks = {};                         // role -> aspect (pixel) or null
    var source = { width: 16, height: 9 };
    var drag = null;

    function layout() {
      // Fit the source frame into the canvas, letterboxing as needed.
      var cw = canvas.width, ch = canvas.height;
      var scale = Math.min(cw / source.width, ch / source.height);
      var w = source.width * scale, h = source.height * scale;
      return { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h, scale: scale };
    }

    function toCanvas(rect, box) {
      return {
        x: box.x + rect.x * box.w,
        y: box.y + rect.y * box.h,
        w: rect.w * box.w,
        h: rect.h * box.h
      };
    }

    function pointerPos(evt) {
      var bounds = canvas.getBoundingClientRect();
      // The canvas backing store may be larger than its CSS box.
      return {
        x: (evt.clientX - bounds.left) * (canvas.width / bounds.width),
        y: (evt.clientY - bounds.top) * (canvas.height / bounds.height)
      };
    }

    /** Which handle, if any, is under the pointer. */
    function hitHandle(pos, rect) {
      var r = HANDLE * (canvas.width / canvas.getBoundingClientRect().width);
      var points = {
        nw: [rect.x, rect.y], n: [rect.x + rect.w / 2, rect.y], ne: [rect.x + rect.w, rect.y],
        w: [rect.x, rect.y + rect.h / 2], e: [rect.x + rect.w, rect.y + rect.h / 2],
        sw: [rect.x, rect.y + rect.h], s: [rect.x + rect.w / 2, rect.y + rect.h],
        se: [rect.x + rect.w, rect.y + rect.h]
      };
      for (var key in points) {
        if (!points.hasOwnProperty(key)) { continue; }
        var dx = pos.x - points[key][0], dy = pos.y - points[key][1];
        if (Math.sqrt(dx * dx + dy * dy) <= r * 1.6) { return key; }
      }
      if (pos.x >= rect.x && pos.x <= rect.x + rect.w && pos.y >= rect.y && pos.y <= rect.y + rect.h) {
        return 'move';
      }
      return null;
    }

    function applyAspect(rect, role, anchorKey) {
      var aspect = locks[role];
      if (!aspect) { return rect; }
      // aspect is a pixel ratio; convert to the normalised ratio of this frame.
      var normAspect = aspect * source.height / source.width;
      var w = rect.w, h = rect.h;
      if (anchorKey === 'n' || anchorKey === 's') { w = h * normAspect; }
      else { h = w / normAspect; }

      var out = { x: rect.x, y: rect.y, w: w, h: h };
      // Grow/shrink away from the edge being dragged.
      if (anchorKey && anchorKey.indexOf('n') >= 0) { out.y = rect.y + rect.h - h; }
      if (anchorKey && anchorKey.indexOf('w') >= 0) { out.x = rect.x + rect.w - w; }
      if (anchorKey === 'move' || !anchorKey) {
        out.x = rect.x + (rect.w - w) / 2;
        out.y = rect.y + (rect.h - h) / 2;
      }
      return out;
    }

    function normalise(rect) {
      var out = {
        x: clamp(rect.x, 0, 1), y: clamp(rect.y, 0, 1),
        w: clamp(rect.w, 0.03, 1), h: clamp(rect.h, 0.03, 1)
      };
      if (out.x + out.w > 1) { out.x = Math.max(0, 1 - out.w); }
      if (out.y + out.h > 1) { out.y = Math.max(0, 1 - out.h); }
      if (out.x + out.w > 1) { out.w = 1 - out.x; }
      if (out.y + out.h > 1) { out.h = 1 - out.y; }
      return out;
    }

    function onDown(evt) {
      if (!image) { return; }
      var box = layout();
      var pos = pointerPos(evt);
      var rect = toCanvas(regions[active], box);
      var handle = hitHandle(pos, rect);
      if (!handle) { return; }
      evt.preventDefault();
      drag = { handle: handle, start: pos, origin: regions[active], box: box };
      canvas.setPointerCapture && canvas.setPointerCapture(evt.pointerId);
    }

    function onMove(evt) {
      if (!image) { return; }
      var box = layout();
      var pos = pointerPos(evt);

      if (!drag) {
        var hover = hitHandle(pos, toCanvas(regions[active], box));
        canvas.style.cursor = hover === 'move' ? 'move'
          : (hover ? (hover === 'n' || hover === 's' ? 'ns-resize'
            : (hover === 'e' || hover === 'w' ? 'ew-resize' : 'nwse-resize')) : 'default');
        return;
      }

      evt.preventDefault();
      var dx = (pos.x - drag.start.x) / box.w;
      var dy = (pos.y - drag.start.y) / box.h;
      var o = drag.origin;
      var next = { x: o.x, y: o.y, w: o.w, h: o.h };
      var k = drag.handle;

      if (k === 'move') {
        next.x = o.x + dx;
        next.y = o.y + dy;
      } else {
        if (k.indexOf('w') >= 0) { next.x = o.x + dx; next.w = o.w - dx; }
        if (k.indexOf('e') >= 0) { next.w = o.w + dx; }
        if (k.indexOf('n') >= 0) { next.y = o.y + dy; next.h = o.h - dy; }
        if (k.indexOf('s') >= 0) { next.h = o.h + dy; }
        if (next.w < 0.03) { next.w = 0.03; }
        if (next.h < 0.03) { next.h = 0.03; }
        next = applyAspect(next, active, k);
      }

      regions[active] = normalise(next);
      draw();
      if (opts.onChange) { opts.onChange(active, regions[active]); }
    }

    function onUp(evt) {
      if (!drag) { return; }
      drag = null;
      canvas.releasePointerCapture && evt.pointerId !== undefined &&
        canvas.releasePointerCapture(evt.pointerId);
      if (opts.onCommit) { opts.onCommit(regions); }
    }

    function drawRegion(role, box, isActive) {
      var rect = toCanvas(regions[role], box);
      ctx.save();
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.strokeStyle = isActive ? COLORS[role] : COLORS.inactive;
      ctx.setLineDash(isActive ? [] : [4, 3]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      // Label sits inside the box so it never runs off the canvas.
      ctx.setLineDash([]);
      ctx.font = '11px system-ui, sans-serif';
      var label = role === 'gameplay' ? 'gameplay' : 'webcam';
      var tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = isActive ? COLORS[role] : 'rgba(0,0,0,0.5)';
      ctx.fillRect(rect.x, rect.y, Math.min(tw, rect.w), 15);
      ctx.fillStyle = isActive ? '#10131a' : '#d6dae2';
      ctx.fillText(label, rect.x + 4, rect.y + 11);

      if (isActive) {
        var pts = [
          [rect.x, rect.y], [rect.x + rect.w / 2, rect.y], [rect.x + rect.w, rect.y],
          [rect.x, rect.y + rect.h / 2], [rect.x + rect.w, rect.y + rect.h / 2],
          [rect.x, rect.y + rect.h], [rect.x + rect.w / 2, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]
        ];
        ctx.fillStyle = COLORS[role];
        for (var i = 0; i < pts.length; i++) {
          ctx.fillRect(pts[i][0] - 3, pts[i][1] - 3, 6, 6);
        }
      }
      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0d1014';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!image) {
        ctx.fillStyle = '#5c6470';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Load a reference frame to pick regions', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'left';
        return;
      }

      var box = layout();
      ctx.drawImage(image, box.x, box.y, box.w, box.h);

      // Dim everything outside the active region.
      var rect = toCanvas(regions[active], box);
      ctx.save();
      ctx.fillStyle = 'rgba(8,10,14,0.45)';
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.fill('evenodd');
      ctx.restore();

      var other = active === 'webcam' ? 'gameplay' : 'webcam';
      if (opts.showBoth !== false) { drawRegion(other, box, false); }
      drawRegion(active, box, true);
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', function () { if (!drag) { canvas.style.cursor = 'default'; } });

    return {
      setImage: function (img, dims) {
        image = img;
        if (dims) { source = dims; }
        else if (img) {
          source = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
        }
        draw();
      },
      setRegions: function (next) {
        if (next.gameplay) { regions.gameplay = normalise(next.gameplay); }
        if (next.webcam) { regions.webcam = normalise(next.webcam); }
        draw();
      },
      getRegions: function () {
        return { gameplay: regions.gameplay, webcam: regions.webcam };
      },
      setActive: function (role) { active = role; draw(); },
      getActive: function () { return active; },
      setLock: function (role, aspect) { locks[role] = aspect || null; },
      setSource: function (dims) { source = dims; draw(); },
      redraw: draw
    };
  }

  /* ------------------------------------------------------------------ *
   * Composite preview                                                  *
   * ------------------------------------------------------------------ */

  /**
   * Draw the plan onto a 9:16 canvas. Layers are painted bottom-up, exactly
   * the track order the host script builds.
   *
   * Regions are normalised, so they are mapped against the reference image's
   * own pixel size rather than the source media's: the reference frame is
   * usually a downscaled grab, and sampling it at source resolution would read
   * past its edges.
   */
  function composite(canvas, image, plan, sourceDims) {
    var ctx = canvas.getContext('2d');
    var out = plan.output;
    var scale = Math.min(canvas.width / out.width, canvas.height / out.height);
    var offX = (canvas.width - out.width * scale) / 2;
    var offY = (canvas.height - out.height * scale) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d1014';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // The canvas itself: black, like an empty sequence.
    ctx.fillStyle = '#000';
    ctx.fillRect(offX, offY, out.width * scale, out.height * scale);

    if (!image) {
      ctx.fillStyle = '#5c6470';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No reference frame yet', canvas.width / 2, canvas.height / 2);
      ctx.textAlign = 'left';
      return;
    }

    var srcW = image.naturalWidth || image.width || (sourceDims && sourceDims.width);
    var srcH = image.naturalHeight || image.height || (sourceDims && sourceDims.height);
    if (!srcW || !srcH) { return; }

    ctx.save();
    ctx.beginPath();
    ctx.rect(offX, offY, out.width * scale, out.height * scale);
    ctx.clip();

    for (var i = 0; i < plan.layers.length; i++) {
      var layer = plan.layers[i];
      var rect = layer.rect || { x: 0, y: 0, w: 1, h: 1 };

      var sx = rect.x * srcW, sy = rect.y * srcH;
      var sw = rect.w * srcW, sh = rect.h * srcH;

      // `visible` is where the solver says the region lands, so drawing it
      // there means the preview reflects the real crop/scale/position maths.
      var v = layer.visible || layer.target;
      var dx = offX + v.x * scale, dy = offY + v.y * scale;
      var dw = v.w * scale, dh = v.h * scale;

      ctx.save();
      if (layer.blur > 0) {
        // Premiere's Blurriness is roughly a pixel radius at sequence scale.
        ctx.filter = 'blur(' + Math.max(1, layer.blur * scale * 0.5).toFixed(1) + 'px)';
      }
      if (layer.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 40 * scale;
        ctx.shadowOffsetY = 14 * scale;
      }
      try {
        ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
      } catch (e) { /* a degenerate rect mid-drag is not worth reporting */ }
      ctx.restore();
    }
    ctx.restore();

    // Frame the canvas edge so the 9:16 bounds are obvious.
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(offX + 0.5, offY + 0.5, out.width * scale - 1, out.height * scale - 1);
  }

  root.Framer.preview = { picker: picker, composite: composite, COLORS: COLORS };
}(window));
