/**
 * Framer - media access from the panel
 * ------------------------------------
 * Reads the source media straight off disk so the user gets a real reference
 * frame and the detector gets real frames to work with.
 *
 * The panel's Chromium decodes the codecs a browser decodes: H.264/HEVC in MP4
 * or MOV, VP9, AV1 - which covers OBS, ShadowPlay and phone captures. Anything
 * else (ProRes, DNxHD, MXF, camera raw) falls back to a still rendered by
 * Premiere itself, handled by the caller.
 */
(function (root) {
  'use strict';
  root.Framer = root.Framer || {};

  /**
   * Turn a native file path into a file:// URL the panel can load.
   * encodeURI rather than encodeURIComponent: a Windows path's drive colon and
   * the separators have to survive, while spaces and the query delimiters must
   * not.
   */
  function fileUrl(path) {
    var p = String(path).replace(/\\/g, '/');
    var prefix = p.charAt(0) === '/' ? 'file://' : 'file:///';
    return prefix + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  function loadImage(path) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not load image: ' + path)); };
      img.src = fileUrl(path) + '?t=' + Date.now();
    });
  }

  /** Load the media into a <video>, resolving once dimensions are known. */
  function loadVideo(path) {
    return new Promise(function (resolve, reject) {
      var video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';

      var settled = false;
      function done(err, value) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        if (err) { reject(err); } else { resolve(value); }
      }

      var timer = setTimeout(function () {
        done(new Error('Timed out decoding this media in the panel.'));
      }, 12000);

      video.onloadedmetadata = function () {
        if (!video.videoWidth || !video.videoHeight) {
          done(new Error('the panel\'s browser cannot decode this file\'s video'));
          return;
        }
        done(null, {
          video: video,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: isFinite(video.duration) ? video.duration : 0
        });
      };
      video.onerror = function () {
        done(new Error('the panel\'s browser cannot open this file'));
      };

      video.src = fileUrl(path);
    });
  }

  function seekTo(video, seconds) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('Seek timed out')); }, 8000);
      function onSeeked() {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        // One more frame of grace so the decoder has actually presented it.
        requestAnimationFrame(function () { resolve(); });
      }
      video.addEventListener('seeked', onSeeked);
      try { video.currentTime = seconds; } catch (e) { clearTimeout(timer); reject(e); }
    });
  }

  function drawToCanvas(source, width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, width, height);
    return { canvas: canvas, ctx: ctx };
  }

  /** A single frame at `seconds`, as a canvas ready for display. */
  function grabFrame(video, seconds, maxWidth) {
    return seekTo(video, seconds).then(function () {
      var w = Math.min(maxWidth || video.videoWidth, video.videoWidth);
      var h = Math.round(w * video.videoHeight / video.videoWidth);
      return drawToCanvas(video, w, h).canvas;
    });
  }

  /**
   * Sample `count` frames spread across the clip, as RGBA buffers for the
   * detector. Sampled small on purpose: detection works on a coarse grid and
   * this keeps a 4K source from stalling the panel.
   */
  function sampleFrames(video, count, opts) {
    opts = opts || {};
    var width = opts.width || 320;
    var height = Math.round(width * video.videoHeight / video.videoWidth);
    var duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    var from = opts.from !== undefined ? opts.from : 0;
    var to = opts.to !== undefined ? opts.to : duration;
    if (!(to > from)) { from = 0; to = duration; }

    var times = [];
    var n = Math.max(1, count);
    for (var i = 0; i < n; i++) {
      // Skip the very first and last instants: fades and black frames there.
      var f = (i + 0.5) / n;
      times.push(from + (to - from) * f);
    }

    var frames = [];
    var chain = Promise.resolve();
    times.forEach(function (t) {
      chain = chain.then(function () {
        return seekTo(video, t).then(function () {
          var drawn = drawToCanvas(video, width, height);
          frames.push(drawn.ctx.getImageData(0, 0, width, height));
        });
      }).catch(function () { /* a bad seek just means one fewer sample */ });
    });

    return chain.then(function () {
      if (!frames.length) { throw new Error('Could not sample any frames from this media.'); }
      return frames;
    });
  }

  /** RGBA buffer from an already-loaded image or canvas, for single-frame detection. */
  function imageToFrame(source, width) {
    var natW = source.naturalWidth || source.width;
    var natH = source.naturalHeight || source.height;
    var w = Math.min(width || 320, natW);
    var h = Math.round(w * natH / natW);
    var drawn = drawToCanvas(source, w, h);
    return drawn.ctx.getImageData(0, 0, w, h);
  }

  root.Framer.media = {
    fileUrl: fileUrl,
    loadImage: loadImage,
    loadVideo: loadVideo,
    grabFrame: grabFrame,
    sampleFrames: sampleFrames,
    imageToFrame: imageToFrame
  };
}(typeof window !== 'undefined' ? window : this));
