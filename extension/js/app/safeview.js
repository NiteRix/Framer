/**
 * Framer - safe zone view
 * -----------------------
 * Draws a vertical video on a phone screen with a short-form app's interface
 * laid over it: the buttons, caption and bars that will hide whatever sits
 * under them. The interface is a plain mock-up - generic icons and
 * placeholder text in the right places - not a copy of any app's artwork.
 *
 * Geometry comes from core/safezones.js; this file only paints it.
 */
(function (root) {
  'use strict';
  root.Framer = root.Framer || {};
  var SZ = root.Framer.safezones;

  var INK = 'rgba(255,255,255,0.94)';
  var DIM = 'rgba(255,255,255,0.62)';

  /* ------------------------------------------------------------------ *
   * Small drawing kit, in 1080 x 1920 screen units                     *
   * ------------------------------------------------------------------ */

  function kit(ctx) {
    function stroke(width) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = width || 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    return {
      text: function (str, x, y, size, opts) {
        opts = opts || {};
        ctx.font = (opts.bold ? '700 ' : '500 ') + size + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = opts.align || 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = opts.color || INK;
        ctx.fillText(str, x, y);
        return ctx.measureText(str).width;
      },
      heart: function (cx, cy, s, filled) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + s * 0.9);
        ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.9, cy - s * 1.2, cx, cy - s * 0.45);
        ctx.bezierCurveTo(cx + s * 0.9, cy - s * 1.2, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
        ctx.closePath();
        if (filled) { ctx.fillStyle = INK; ctx.fill(); } else { stroke(); ctx.stroke(); }
      },
      bubble: function (cx, cy, s) {
        stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy - s * 0.1, s * 1.05, s * 0.85, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.55, cy + s * 0.6);
        ctx.lineTo(cx - s * 0.8, cy + s * 1.05);
        ctx.lineTo(cx - s * 0.1, cy + s * 0.72);
        ctx.stroke();
      },
      bookmark: function (cx, cy, s) {
        stroke();
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.7, cy - s);
        ctx.lineTo(cx + s * 0.7, cy - s);
        ctx.lineTo(cx + s * 0.7, cy + s);
        ctx.lineTo(cx, cy + s * 0.45);
        ctx.lineTo(cx - s * 0.7, cy + s);
        ctx.closePath();
        ctx.stroke();
      },
      arrow: function (cx, cy, s) {          // share: a curved arrow
        stroke();
        ctx.beginPath();
        ctx.moveTo(cx - s, cy + s * 0.8);
        ctx.quadraticCurveTo(cx - s * 0.8, cy - s * 0.3, cx + s * 0.4, cy - s * 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.1, cy - s * 0.8);
        ctx.lineTo(cx + s, cy - s * 0.3);
        ctx.lineTo(cx + s * 0.1, cy + s * 0.2);
        ctx.stroke();
      },
      plane: function (cx, cy, s) {          // share: a paper plane
        stroke();
        ctx.beginPath();
        ctx.moveTo(cx - s, cy - s * 0.2);
        ctx.lineTo(cx + s, cy - s * 0.9);
        ctx.lineTo(cx + s * 0.2, cy + s);
        ctx.lineTo(cx - s * 0.1, cy + s * 0.1);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.1, cy + s * 0.1);
        ctx.lineTo(cx + s, cy - s * 0.9);
        ctx.stroke();
      },
      thumb: function (cx, cy, s, down) {
        ctx.save();
        ctx.translate(cx, cy);
        if (down) { ctx.rotate(Math.PI); }
        stroke();
        ctx.beginPath();
        ctx.rect(-s, -s * 0.1, s * 0.45, s * 1.05);
        ctx.moveTo(-s * 0.4, -s * 0.05);
        ctx.lineTo(-s * 0.05, -s);
        ctx.quadraticCurveTo(s * 0.3, -s * 0.95, s * 0.15, -s * 0.2);
        ctx.lineTo(s * 0.85, -s * 0.2);
        ctx.quadraticCurveTo(s * 1.05, -s * 0.1, s * 0.9, s * 0.2);
        ctx.lineTo(s * 0.7, s * 0.85);
        ctx.lineTo(-s * 0.4, s * 0.95);
        ctx.stroke();
        ctx.restore();
      },
      remix: function (cx, cy, s) {
        stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.8, Math.PI * 0.15, Math.PI * 0.95);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.8, Math.PI * 1.15, Math.PI * 1.95);
        ctx.stroke();
      },
      dots: function (cx, cy, s, vertical) {
        ctx.fillStyle = INK;
        for (var i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.arc(cx + (vertical ? 0 : i * s * 0.7), cy + (vertical ? i * s * 0.7 : 0), s * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      search: function (cx, cy, s) {
        stroke();
        ctx.beginPath();
        ctx.arc(cx - s * 0.15, cy - s * 0.15, s * 0.65, 0, Math.PI * 2);
        ctx.moveTo(cx + s * 0.32, cy + s * 0.32);
        ctx.lineTo(cx + s * 0.9, cy + s * 0.9);
        ctx.stroke();
      },
      camera: function (cx, cy, s) {
        stroke();
        ctx.beginPath();
        roundRect(ctx, cx - s, cy - s * 0.65, s * 2, s * 1.4, s * 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy + s * 0.05, s * 0.4, 0, Math.PI * 2);
        ctx.stroke();
      },
      avatar: function (cx, cy, r, badge) {
        ctx.fillStyle = 'rgba(200,205,215,0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(120,128,140,0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.2, r * 0.36, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.75, r * 0.62, Math.PI, 0);
        ctx.fill();
        if (badge) {
          ctx.fillStyle = badge;
          ctx.beginPath();
          ctx.arc(cx, cy + r, r * 0.34, 0, Math.PI * 2);
          ctx.fill();
          stroke(5);
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.16, cy + r); ctx.lineTo(cx + r * 0.16, cy + r);
          ctx.moveTo(cx, cy + r * 0.84); ctx.lineTo(cx, cy + r * 1.16);
          ctx.stroke();
        }
      },
      disc: function (cx, cy, r) {
        ctx.fillStyle = 'rgba(30,30,34,0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(200,205,215,0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      },
      tile: function (cx, cy, s) {           // a square thumbnail, for the audio
        ctx.fillStyle = 'rgba(200,205,215,0.95)';
        ctx.beginPath();
        roundRect(ctx, cx - s, cy - s, s * 2, s * 2, s * 0.25);
        ctx.fill();
        stroke(4);
        ctx.stroke();
      },
      pill: function (x, y, w, h, label, filled) {
        ctx.beginPath();
        roundRect(ctx, x, y, w, h, h / 2);
        if (filled) { ctx.fillStyle = INK; ctx.fill(); }
        else { stroke(3); ctx.stroke(); }
        this.text(label, x + w / 2, y + h / 2 + 1, h * 0.5, { bold: true, align: 'center', color: filled ? '#111' : INK });
      },
      navBar: function (y, h, icons) {
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillRect(0, y, SZ.SCREEN.width, h);
        var step = SZ.SCREEN.width / icons.length;
        for (var i = 0; i < icons.length; i++) {
          var cx = step * (i + 0.5), cy = y + h * 0.4;
          var icon = icons[i];
          if (icon === 'plus') {
            ctx.fillStyle = INK;
            ctx.beginPath();
            roundRect(ctx, cx - 44, cy - 28, 88, 56, 14);
            ctx.fill();
            ctx.strokeStyle = '#111';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(cx - 16, cy); ctx.lineTo(cx + 16, cy);
            ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy + 16);
            ctx.stroke();
          } else if (icon === 'avatar') {
            this.avatar(cx, cy, 26);
          } else {
            // A generic outline glyph with a label: enough to read as a tab.
            stroke(5);
            ctx.beginPath();
            roundRect(ctx, cx - 22, cy - 24, 44, 44, 10);
            ctx.stroke();
            this.text(icon, cx, y + h * 0.8, 22, { align: 'center', color: DIM });
          }
        }
      },
      count: function (str, cx, cy) {
        this.text(str, cx, cy, 26, { bold: true, align: 'center' });
      }
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ *
   * The three interfaces                                               *
   * ------------------------------------------------------------------ */

  var MOCKS = {
    tiktok: function (k) {
      k.text('Following', 450, 118, 34, { align: 'right', color: DIM });
      k.text('For You', 490, 118, 36, { bold: true });
      k.search(1010, 118, 26);
      var x = 990;
      k.avatar(x, 905, 48, '#ff4f7b');
      k.heart(x, 1070, 34, true); k.count('12.3K', x, 1135);
      k.bubble(x, 1225, 32); k.count('348', x, 1290);
      k.bookmark(x, 1370, 30); k.count('1,204', x, 1435);
      k.arrow(x, 1520, 32); k.count('Share', x, 1585);
      k.disc(x, 1700, 44);
      k.text('@yourname', 40, 1575, 36, { bold: true });
      k.text('Your caption goes here, with a couple of', 40, 1630, 31);
      k.text('#hashtags and a line or two more…', 40, 1672, 31);
      k.text('♫  original sound - yourname', 40, 1738, 29);
      k.navBar(1790, 130, ['Home', 'Friends', 'plus', 'Inbox', 'Profile']);
    },
    shorts: function (k) {
      k.search(890, 112, 26);
      k.dots(1020, 112, 26, true);
      var x = 985;
      k.thumb(x, 860, 34); k.count('12K', x, 925);
      k.thumb(x, 1010, 34, true); k.count('Dislike', x, 1075);
      k.bubble(x, 1160, 32); k.count('348', x, 1225);
      k.arrow(x, 1310, 32); k.count('Share', x, 1375);
      k.remix(x, 1460, 34); k.count('Remix', x, 1525);
      k.tile(x, 1650, 38);
      k.avatar(72, 1500, 32);
      var w = k.text('@yourname', 118, 1502, 32, { bold: true });
      k.pill(132 + w, 1474, 190, 56, 'Subscribe', true);
      k.text('Your Short’s title goes here, the first', 40, 1598, 33);
      k.text('line or two of it…', 40, 1642, 33);
      k.text('♫  original sound', 40, 1712, 29);
      k.navBar(1770, 150, ['Home', 'Shorts', 'plus', 'Subs', 'You']);
    },
    reels: function (k) {
      k.text('Reels', 48, 128, 46, { bold: true });
      k.camera(1010, 128, 32);
      var x = 1000;
      k.heart(x, 960, 34, false); k.count('12.3K', x, 1025);
      k.bubble(x, 1110, 32); k.count('348', x, 1175);
      k.plane(x, 1260, 32); k.count('1,204', x, 1325);
      k.dots(x, 1400, 34, false);
      k.tile(x, 1540, 32);
      k.avatar(70, 1540, 30);
      var w = k.text('yourname', 114, 1542, 32, { bold: true });
      k.pill(132 + w, 1516, 130, 52, 'Follow', false);
      k.text('Your caption goes here… more', 40, 1622, 31);
      k.text('♫  yourname · Original audio', 40, 1690, 29);
      k.navBar(1780, 140, ['Home', 'Search', 'plus', 'Reels', 'avatar']);
    }
  };

  /* ------------------------------------------------------------------ *
   * The view                                                           *
   * ------------------------------------------------------------------ */

  /**
   * opts.frame      <img>/<canvas> holding the video frame, or null
   * opts.output     {width,height} of the video
   * opts.platform   'tiktok' | 'shorts' | 'reels' | 'all'
   * opts.showUI     draw the app's interface
   * opts.showSafe   outline the clear area
   * opts.shade      dim everything outside the clear area
   * opts.highlight  {x,y,w,h} in output pixels to outline (the webcam box)
   * opts.message    text to show when there is no frame
   */
  function draw(canvas, opts) {
    var ctx = canvas.getContext('2d');
    var S = SZ.SCREEN;
    var k = canvas.width / S.width;
    var p = SZ.platform(opts.platform);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(k, canvas.height / S.height);

    // The phone screen and the video on it.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S.width, S.height);
    var v = SZ.videoOnScreen(opts.output);
    if (opts.frame) {
      var fw = opts.frame.naturalWidth || opts.frame.width, fh = opts.frame.naturalHeight || opts.frame.height;
      var fit = Math.min(v.w / fw, v.h / fh);
      var dw = fw * fit, dh = fh * fit;
      try { ctx.drawImage(opts.frame, v.x + (v.w - dw) / 2, v.y + (v.h - dh) / 2, dw, dh); } catch (e) { /* mid-load */ }
    } else {
      ctx.fillStyle = '#5c6470';
      ctx.font = '40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.message || 'No frame yet', S.width / 2, S.height / 2);
    }

    var safe = p.safe;
    if (opts.shade) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.rect(0, 0, S.width, S.height);
      ctx.rect(safe.x, safe.y, safe.w, safe.h);
      ctx.fill('evenodd');
    }

    if (opts.showUI) {
      if (p.id === 'all') {
        // Three interfaces at once would be noise: darken where each one
        // sits, so the more apps cover a spot, the darker it gets.
        ctx.fillStyle = 'rgba(0,0,0,0.24)';
        p.zones.forEach(function (z) { ctx.fillRect(z.rect.x, z.rect.y, z.rect.w, z.rect.h); });
      } else {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 10;
        MOCKS[p.id](kit(ctx));
        ctx.restore();
      }
    }

    if (opts.showSafe) {
      if (p.id === 'all') {
        SZ.ORDER.forEach(function (id) {
          var r = SZ.PLATFORMS[id].safe;
          ctx.strokeStyle = hexAlpha(SZ.PLATFORMS[id].color, 0.85);
          ctx.lineWidth = 4;
          ctx.setLineDash([14, 10]);
          ctx.strokeRect(r.x, r.y, r.w, r.h);
        });
      }
      ctx.strokeStyle = p.id === 'all' ? '#ffffff' : p.color;
      ctx.lineWidth = 6;
      ctx.setLineDash(p.id === 'all' ? [] : [20, 12]);
      ctx.strokeRect(safe.x, safe.y, safe.w, safe.h);
      ctx.setLineDash([]);
      label(ctx, 'clear area', safe.x + 10, safe.y + 10, p.id === 'all' ? '#ffffff' : p.color);
    }

    if (opts.highlight) {
      var h = SZ.toScreen(opts.highlight, opts.output);
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 5;
      ctx.setLineDash([]);
      ctx.strokeRect(h.x, h.y, h.w, h.h);
      // Show where the interface lands on it.
      ctx.fillStyle = 'rgba(255,90,90,0.38)';
      p.zones.forEach(function (z) {
        var x0 = Math.max(h.x, z.rect.x), y0 = Math.max(h.y, z.rect.y);
        var x1 = Math.min(h.x + h.w, z.rect.x + z.rect.w), y1 = Math.min(h.y + h.h, z.rect.y + z.rect.h);
        if (x1 > x0 && y1 > y0) { ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
      });
    }
    ctx.restore();
  }

  function label(ctx, text, x, y, color) {
    ctx.font = '600 28px system-ui, sans-serif';
    var w = ctx.measureText(text).width + 20;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 40);
    ctx.fillStyle = '#10131a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 10, y + 21);
  }

  function hexAlpha(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  root.Framer.safeview = { draw: draw };
}(window));
