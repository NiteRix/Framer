/**
 * Framer - webcam region detection
 * --------------------------------
 * Finds the rectangle a webcam feed occupies in a horizontal capture, from a
 * handful of sampled frames. Pure JS over RGBA buffers so it runs in the panel
 * and under Node (tests).
 *
 * The signal it leans on: an overlay webcam is a rectangle composited onto the
 * capture, so its edges are long straight gradient lines that persist across
 * frames, and the pixels inside it move differently from the gameplay around
 * it. So: find strong candidate lines, then score every rectangle they form.
 *
 * It is a suggestion, not a certainty. The panel always lets the user nudge
 * the result, and low-confidence hits are reported as such.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Framer = root.Framer || {};
    root.Framer.detect = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GRID_WIDTH = 160;        // analysis resolution; plenty for a box hunt
  var MAX_LINES = 14;          // candidate lines kept per axis
  var MIN_SPAN = 0.07;         // smallest accepted side, fraction of the frame
  var MAX_SPAN = 0.72;
  var CLEARANCE = 0.02;        // gap kept between a suggested gameplay crop and the webcam

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /**
   * Box-filter an RGBA frame down to a small grayscale Float32Array.
   * frame: {width, height, data} where data is RGBA, 4 bytes per pixel.
   */
  function grayDownsample(frame, gw, gh) {
    var out = new Float32Array(gw * gh);
    var sw = frame.width, sh = frame.height, data = frame.data;
    var xScale = sw / gw, yScale = sh / gh;

    for (var gy = 0; gy < gh; gy++) {
      var y0 = Math.floor(gy * yScale), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * yScale));
      if (y1 > sh) { y1 = sh; }
      for (var gx = 0; gx < gw; gx++) {
        var x0 = Math.floor(gx * xScale), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * xScale));
        if (x1 > sw) { x1 = sw; }
        var sum = 0, n = 0;
        for (var y = y0; y < y1; y++) {
          var row = y * sw * 4;
          for (var x = x0; x < x1; x++) {
            var i = row + x * 4;
            // Rec.601 luma: cheap and stable enough for edge work.
            sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            n++;
          }
        }
        out[gy * gw + gx] = n ? sum / n : 0;
      }
    }
    return out;
  }

  /** Per-pixel mean and variance across the sampled frames. */
  function temporalStats(grids, len) {
    var mean = new Float32Array(len);
    var variance = new Float32Array(len);
    var count = grids.length;
    var i, g;
    for (g = 0; g < count; g++) {
      var grid = grids[g];
      for (i = 0; i < len; i++) { mean[i] += grid[i]; }
    }
    for (i = 0; i < len; i++) { mean[i] /= count; }
    for (g = 0; g < count; g++) {
      var grid2 = grids[g];
      for (i = 0; i < len; i++) {
        var d = grid2[i] - mean[i];
        variance[i] += d * d;
      }
    }
    for (i = 0; i < len; i++) { variance[i] = Math.sqrt(variance[i] / count); }
    return { mean: mean, variance: variance };
  }

  /** Absolute horizontal / vertical gradients of a grid. */
  function gradients(grid, gw, gh) {
    var gx = new Float32Array(gw * gh);
    var gy = new Float32Array(gw * gh);
    for (var y = 0; y < gh; y++) {
      for (var x = 0; x < gw; x++) {
        var i = y * gw + x;
        var xl = x > 0 ? grid[i - 1] : grid[i];
        var xr = x < gw - 1 ? grid[i + 1] : grid[i];
        var yu = y > 0 ? grid[i - gw] : grid[i];
        var yd = y < gh - 1 ? grid[i + gw] : grid[i];
        gx[i] = Math.abs(xr - xl);
        gy[i] = Math.abs(yd - yu);
      }
    }
    return { gx: gx, gy: gy };
  }

  /**
   * Columns (or rows) that look like a straight edge: strong summed gradient,
   * locally maximal. Frame borders are always included, because a webcam is
   * often flush against one.
   */
  function candidateLines(profile, count, limit) {
    var mean = 0, i;
    for (i = 0; i < count; i++) { mean += profile[i]; }
    mean /= count;
    var sd = 0;
    for (i = 0; i < count; i++) { var d = profile[i] - mean; sd += d * d; }
    sd = Math.sqrt(sd / count);

    var threshold = mean + 0.6 * sd;
    var peaks = [];
    var window = Math.max(2, Math.round(count * 0.02));

    for (i = 1; i < count - 1; i++) {
      if (profile[i] < threshold) { continue; }
      var isPeak = true;
      for (var j = Math.max(0, i - window); j <= Math.min(count - 1, i + window); j++) {
        if (profile[j] > profile[i]) { isPeak = false; break; }
      }
      if (isPeak) { peaks.push({ at: i, strength: profile[i] }); }
    }

    peaks.sort(function (a, b) { return b.strength - a.strength; });
    peaks = peaks.slice(0, limit);

    var lines = [{ at: 0, strength: 0, border: true },
                 { at: count - 1, strength: 0, border: true }];
    for (i = 0; i < peaks.length; i++) {
      lines.push({ at: peaks[i].at, strength: peaks[i].strength, border: false });
    }
    lines.sort(function (a, b) { return a.at - b.at; });
    return { lines: lines, mean: mean, sd: sd };
  }

  /** Mean of a gradient buffer along one edge of a rect. */
  function edgeMean(buf, gw, fixed, from, to, vertical) {
    var sum = 0, n = 0;
    for (var t = from; t <= to; t++) {
      var i = vertical ? (t * gw + fixed) : (fixed * gw + t);
      sum += buf[i];
      n++;
    }
    return n ? sum / n : 0;
  }

  function areaMean(buf, gw, x1, y1, x2, y2) {
    var sum = 0, n = 0;
    for (var y = y1; y <= y2; y++) {
      for (var x = x1; x <= x2; x++) { sum += buf[y * gw + x]; n++; }
    }
    return n ? sum / n : 0;
  }

  /**
   * findWebcamRegion(frames, opts)
   *
   * frames: array of {width, height, data} RGBA buffers (2+ recommended; with
   *         a single frame only the edge evidence is used).
   * returns {rect, score, confidence, candidates}
   *         rect is normalised {x,y,w,h}; null when nothing plausible is found.
   */
  function findWebcamRegion(frames, opts) {
    opts = opts || {};
    if (!frames || !frames.length) {
      return { rect: null, score: 0, confidence: 'none', candidates: [], reason: 'no frames supplied' };
    }

    var gw = opts.gridWidth || GRID_WIDTH;
    var gh = Math.max(8, Math.round(gw * frames[0].height / frames[0].width));
    var len = gw * gh;

    var grids = [];
    for (var f = 0; f < frames.length; f++) {
      grids.push(grayDownsample(frames[f], gw, gh));
    }

    var stats = temporalStats(grids, len);
    var grad = gradients(stats.mean, gw, gh);

    // Edge profiles: vertical edges show up in gx summed down each column.
    var colProfile = new Float32Array(gw);
    var rowProfile = new Float32Array(gh);
    var x, y;
    for (y = 0; y < gh; y++) {
      for (x = 0; x < gw; x++) {
        colProfile[x] += grad.gx[y * gw + x];
        rowProfile[y] += grad.gy[y * gw + x];
      }
    }
    for (x = 0; x < gw; x++) { colProfile[x] /= gh; }
    for (y = 0; y < gh; y++) { rowProfile[y] /= gw; }

    var cols = candidateLines(colProfile, gw, opts.maxLines || MAX_LINES);
    var rows = candidateLines(rowProfile, gh, opts.maxLines || MAX_LINES);

    var globalGx = 0, globalGy = 0, globalVar = 0;
    for (var i = 0; i < len; i++) { globalGx += grad.gx[i]; globalGy += grad.gy[i]; globalVar += stats.variance[i]; }
    globalGx = globalGx / len || 1e-6;
    globalGy = globalGy / len || 1e-6;
    globalVar = globalVar / len || 1e-6;

    var minW = Math.max(3, Math.round(gw * (opts.minSpan || MIN_SPAN)));
    var minH = Math.max(3, Math.round(gh * (opts.minSpan || MIN_SPAN)));
    var maxW = Math.round(gw * (opts.maxSpan || MAX_SPAN));
    var maxH = Math.round(gh * (opts.maxSpan || MAX_SPAN));

    var candidates = [];

    for (var a = 0; a < cols.lines.length - 1; a++) {
      for (var b = a + 1; b < cols.lines.length; b++) {
        var x1 = cols.lines[a].at, x2 = cols.lines[b].at;
        var w = x2 - x1;
        if (w < minW || w > maxW) { continue; }

        for (var c = 0; c < rows.lines.length - 1; c++) {
          for (var d = c + 1; d < rows.lines.length; d++) {
            var y1 = rows.lines[c].at, y2 = rows.lines[d].at;
            var h = y2 - y1;
            if (h < minH || h > maxH) { continue; }

            var aspect = (w / gw * frames[0].width) / (h / gh * frames[0].height);
            if (aspect < 0.45 || aspect > 2.8) { continue; }

            // --- border evidence ---------------------------------------
            // An edge lying on the frame border carries no gradient of its
            // own, so it inherits the average of the edges that do.
            var edges = [];
            var borders = 0;
            if (cols.lines[a].border) { borders++; } else { edges.push(edgeMean(grad.gx, gw, x1, y1, y2, true) / globalGx); }
            if (cols.lines[b].border) { borders++; } else { edges.push(edgeMean(grad.gx, gw, x2, y1, y2, true) / globalGx); }
            if (rows.lines[c].border) { borders++; } else { edges.push(edgeMean(grad.gy, gw, y1, x1, x2, false) / globalGy); }
            if (rows.lines[d].border) { borders++; } else { edges.push(edgeMean(grad.gy, gw, y2, x1, x2, false) / globalGy); }
            if (borders > 2 || !edges.length) { continue; }

            var edgeSum = 0;
            for (var e = 0; e < edges.length; e++) { edgeSum += edges[e]; }
            var borderScore = edgeSum / edges.length;
            var weakest = Math.min.apply(null, edges);

            // --- motion evidence --------------------------------------
            // The inside of a webcam box moves differently from gameplay.
            var inside = areaMean(stats.variance, gw, x1 + 1, y1 + 1, Math.max(x1 + 1, x2 - 1), Math.max(y1 + 1, y2 - 1));
            var motionContrast = frames.length > 1
              ? Math.abs(inside - globalVar) / (globalVar + 1e-6)
              : 0;

            // --- priors ------------------------------------------------
            var cxN = (x1 + x2) / 2 / gw, cyN = (y1 + y2) / 2 / gh;
            var cornerDist = Math.min(
              Math.sqrt(cxN * cxN + cyN * cyN),
              Math.sqrt((1 - cxN) * (1 - cxN) + cyN * cyN),
              Math.sqrt(cxN * cxN + (1 - cyN) * (1 - cyN)),
              Math.sqrt((1 - cxN) * (1 - cxN) + (1 - cyN) * (1 - cyN))
            );
            var cornerPrior = clamp(1 - cornerDist / 0.75, 0, 1);

            var areaFrac = (w / gw) * (h / gh);
            var sizePrior = (areaFrac >= 0.02 && areaFrac <= 0.36)
              ? 1
              : clamp(1 - Math.abs(areaFrac - 0.18) * 2.2, 0, 1);

            var score = 1.0 * borderScore
                      + 0.45 * Math.min(weakest, 3)
                      + 0.7 * Math.min(motionContrast, 2)
                      + 0.8 * cornerPrior
                      + 0.6 * sizePrior;

            candidates.push({
              rect: { x: x1 / gw, y: y1 / gh, w: w / gw, h: h / gh },
              score: score,
              parts: {
                border: borderScore, weakestEdge: weakest, motion: motionContrast,
                corner: cornerPrior, size: sizePrior, aspect: aspect
              }
            });
          }
        }
      }
    }

    if (!candidates.length) {
      return { rect: null, score: 0, confidence: 'none', candidates: [],
               reason: 'no rectangular overlay edges found' };
    }

    candidates.sort(function (p, q) { return q.score - p.score; });
    var best = candidates[0];
    var runnerUp = candidates[1] ? candidates[1].score : 0;

    // Confident when the winner both scores well and is clearly ahead of a
    // meaningfully different runner-up.
    var margin = runnerUp > 0 ? (best.score - runnerUp) / best.score : 1;
    var confidence = 'low';
    if (best.score > 3.2 && (margin > 0.08 || overlaps(best.rect, candidates[1] && candidates[1].rect))) {
      confidence = 'high';
    } else if (best.score > 2.2) {
      confidence = 'medium';
    }

    return {
      rect: best.rect,
      score: best.score,
      confidence: confidence,
      candidates: dedupe(candidates).slice(0, opts.maxCandidates || 6)
    };
  }

  function overlaps(a, b) {
    if (!a || !b) { return false; }
    var ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    var inter = ix * iy;
    var union = a.w * a.h + b.w * b.h - inter;
    return union > 0 && inter / union > 0.6;
  }

  /** Drop candidates that are near-duplicates of a better-scoring one. */
  function dedupe(sorted) {
    var kept = [];
    for (var i = 0; i < sorted.length; i++) {
      var dup = false;
      for (var j = 0; j < kept.length; j++) {
        if (overlaps(sorted[i].rect, kept[j].rect)) { dup = true; break; }
      }
      if (!dup) { kept.push(sorted[i]); }
    }
    return kept;
  }

  /**
   * The gameplay region, given a known webcam box: a crop of the requested
   * aspect, as large as possible and as close to the middle of the frame as
   * possible, that does not take in the webcam box. The middle matters more
   * than a few extra pixels: it is where the crosshair and the action are.
   *
   * Candidates are the largest centred crop, the same crop shrunk until it
   * clears the webcam, and the largest crop in each strip of frame beside,
   * above and below the webcam, pulled as close to the centre as that strip
   * allows. The best trade of size against distance from the centre wins.
   * With no usable candidate, it returns the centred crop over the webcam.
   * The webcam box is padded by CLEARANCE first, so the crop does not end
   * right on an overlay border.
   */
  function suggestGameplayRegion(webcamRect, targetAspect, source) {
    // The aspect as a ratio of normalised width to normalised height.
    var na = targetAspect * source.height / source.width;
    var fullW = Math.min(1, na), fullH = fullW / na;
    var centred = placeNear({ w: fullW, h: fullH }, { x: 0, y: 0, w: 1, h: 1 });
    if (!webcamRect || !intersects(centred, webcamRect)) { return centred; }

    // A little clearance: overlay borders and shadows sit just outside a
    // detected box, and detection can come up a few pixels short.
    var mx = CLEARANCE, my = CLEARANCE * source.width / source.height;
    var cam = {
      x: Math.max(0, webcamRect.x - mx), y: Math.max(0, webcamRect.y - my),
      w: 0, h: 0
    };
    cam.w = Math.min(1, webcamRect.x + webcamRect.w + mx) - cam.x;
    cam.h = Math.min(1, webcamRect.y + webcamRect.h + my) - cam.y;
    var candidates = [];

    // Centred, shrunk until it clears the webcam on one axis.
    var halfW = 0;
    if (cam.x >= 0.5) { halfW = Math.max(halfW, cam.x - 0.5); }
    if (cam.x + cam.w <= 0.5) { halfW = Math.max(halfW, 0.5 - (cam.x + cam.w)); }
    if (cam.y >= 0.5) { halfW = Math.max(halfW, (cam.y - 0.5) * na); }
    if (cam.y + cam.h <= 0.5) { halfW = Math.max(halfW, (0.5 - (cam.y + cam.h)) * na); }
    halfW = Math.min(halfW, fullW / 2);
    if (halfW > 0) { candidates.push(placeNear({ w: halfW * 2, h: halfW * 2 / na }, { x: 0, y: 0, w: 1, h: 1 })); }

    // The strips of frame the webcam leaves free on each side.
    var strips = [
      { x: 0, y: 0, w: cam.x, h: 1 },
      { x: cam.x + cam.w, y: 0, w: 1 - (cam.x + cam.w), h: 1 },
      { x: 0, y: 0, w: 1, h: cam.y },
      { x: 0, y: cam.y + cam.h, w: 1, h: 1 - (cam.y + cam.h) }
    ];
    for (var i = 0; i < strips.length; i++) {
      var strip = strips[i];
      if (strip.w <= 0 || strip.h <= 0) { continue; }
      var w = Math.min(fullW, strip.w, strip.h * na);
      candidates.push(placeNear({ w: w, h: w / na }, strip));
    }

    var best = null;
    for (var c = 0; c < candidates.length; c++) {
      var r = candidates[c];
      // Too small to be worth using: under a quarter of the centred crop.
      if (r.w * r.h < fullW * fullH * 0.25 || intersects(r, cam)) { continue; }
      var dx = r.x + r.w / 2 - 0.5, dy = r.y + r.h / 2 - 0.5;
      var score = (r.w * r.h) / (fullW * fullH) - 2 * Math.sqrt(dx * dx + dy * dy);
      if (!best || score > best.score) { best = { rect: r, score: score }; }
    }
    return best ? best.rect : centred;
  }

  /** True when two normalised rectangles share any area at all. */
  function intersects(a, b) {
    var e = 1e-6;
    return a.x < b.x + b.w - e && b.x < a.x + a.w - e && a.y < b.y + b.h - e && b.y < a.y + a.h - e;
  }

  /** A w x h box inside `area`, as close to the frame centre as `area` allows. */
  function placeNear(size, area) {
    var x = clamp(0.5 - size.w / 2, area.x, area.x + area.w - size.w);
    var y = clamp(0.5 - size.h / 2, area.y, area.y + area.h - size.h);
    return { x: x, y: y, w: size.w, h: size.h };
  }

  return {
    findWebcamRegion: findWebcamRegion,
    suggestGameplayRegion: suggestGameplayRegion,
    grayDownsample: grayDownsample,
    temporalStats: temporalStats,
    _internals: { candidateLines: candidateLines, gradients: gradients, overlaps: overlaps, intersects: intersects }
  };
}));
