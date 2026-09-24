/**
 * Framer - platform safe zones
 * ----------------------------
 * Where TikTok, YouTube Shorts and Instagram Reels draw their own interface
 * over a vertical video, and what is left clear of it. Pure geometry, like
 * layout.js: the panel draws from it and the tests check it under Node.
 *
 * Everything is measured on a 1080 x 1920 phone screen. A 9:16 video fills
 * that screen; a 4:5 or 1:1 video is shown full width and centred, which is
 * how the three apps show them, so the interface sits partly over black.
 *
 * The numbers follow the platforms' published creative guidance and how
 * their apps lay out on a typical phone. They are approximate by nature:
 * each app moves its buttons between versions and the exact spot depends on
 * the phone. Treat the clear area as "keep faces, text and the action here".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Framer = root.Framer || {};
    root.Framer.safezones = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCREEN = { width: 1080, height: 1920 };

  /**
   * Per platform: the clear area, and the regions its interface covers.
   * Zone kinds tell the drawing code what to put there:
   *   top      tabs / search along the top edge
   *   rail     the column of buttons down the right edge
   *   caption  account name, caption and sound, bottom left
   *   nav      the app's navigation bar along the bottom edge
   */
  var PLATFORMS = {
    tiktok: {
      id: 'tiktok',
      label: 'TikTok',
      color: '#ff4f7b',
      safe: { x: 60, y: 200, w: 840, h: 1300 },
      zones: [
        { kind: 'top', label: 'the top tabs', rect: { x: 0, y: 0, w: 1080, h: 200 } },
        { kind: 'rail', label: 'the buttons on the right', rect: { x: 900, y: 820, w: 180, h: 970 } },
        { kind: 'caption', label: 'the caption', rect: { x: 0, y: 1500, w: 900, h: 290 } },
        { kind: 'nav', label: 'the navigation bar', rect: { x: 0, y: 1790, w: 1080, h: 130 } }
      ]
    },
    shorts: {
      id: 'shorts',
      label: 'YouTube Shorts',
      color: '#ff5a4f',
      safe: { x: 48, y: 190, w: 832, h: 1250 },
      zones: [
        { kind: 'top', label: 'the top bar', rect: { x: 0, y: 0, w: 1080, h: 190 } },
        { kind: 'rail', label: 'the buttons on the right', rect: { x: 880, y: 760, w: 200, h: 1010 } },
        { kind: 'caption', label: 'the title and channel', rect: { x: 0, y: 1440, w: 880, h: 330 } },
        { kind: 'nav', label: 'the navigation bar', rect: { x: 0, y: 1770, w: 1080, h: 150 } }
      ]
    },
    reels: {
      id: 'reels',
      label: 'Instagram Reels',
      color: '#c779ff',
      safe: { x: 40, y: 220, w: 880, h: 1260 },
      zones: [
        { kind: 'top', label: 'the top bar', rect: { x: 0, y: 0, w: 1080, h: 220 } },
        { kind: 'rail', label: 'the buttons on the right', rect: { x: 920, y: 880, w: 160, h: 900 } },
        { kind: 'caption', label: 'the caption', rect: { x: 0, y: 1480, w: 920, h: 300 } },
        { kind: 'nav', label: 'the navigation bar', rect: { x: 0, y: 1780, w: 1080, h: 140 } }
      ]
    }
  };

  var ORDER = ['tiktok', 'shorts', 'reels'];

  /** What each kind of zone is called when all three apps are shown together. */
  var GENERIC = {
    top: 'the top bar',
    rail: 'the buttons on the right',
    caption: 'the caption',
    nav: 'the navigation bar'
  };

  function intersect(a, b) {
    var x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    var x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    if (x1 <= x0 || y1 <= y0) { return null; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** The area that is clear on every platform: the overlap of their clear areas. */
  function combinedSafe() {
    var r = PLATFORMS[ORDER[0]].safe;
    for (var i = 1; i < ORDER.length; i++) { r = intersect(r, PLATFORMS[ORDER[i]].safe); }
    return r;
  }

  /**
   * A platform's geometry, or for 'all' the combined clear area with every
   * platform's interface zones, each tagged with the platform it belongs to.
   */
  function platform(id) {
    if (id === 'all') {
      var zones = [];
      for (var i = 0; i < ORDER.length; i++) {
        var p = PLATFORMS[ORDER[i]];
        for (var z = 0; z < p.zones.length; z++) {
          var kind = p.zones[z].kind;
          zones.push({ kind: kind, label: GENERIC[kind], rect: p.zones[z].rect, platform: p.id });
        }
      }
      return { id: 'all', label: 'All three', color: '#ffffff', safe: combinedSafe(), zones: zones };
    }
    var one = PLATFORMS[id];
    if (!one) { throw new Error('Unknown platform: ' + id); }
    return one;
  }

  /**
   * Where a video of the given output size sits on the phone screen: scaled
   * to the screen width, centred top to bottom. Returns screen pixels, plus
   * the scale from output pixels to screen pixels.
   */
  function videoOnScreen(output) {
    var scale = Math.min(SCREEN.width / output.width, SCREEN.height / output.height);
    var w = output.width * scale, h = output.height * scale;
    return { x: (SCREEN.width - w) / 2, y: (SCREEN.height - h) / 2, w: w, h: h, scale: scale };
  }

  /** A rectangle in output pixels, moved onto the phone screen. */
  function toScreen(rect, output) {
    var v = videoOnScreen(output);
    return { x: v.x + rect.x * v.scale, y: v.y + rect.y * v.scale, w: rect.w * v.scale, h: rect.h * v.scale };
  }

  /**
   * How much of a rectangle (output pixels) each part of a platform's
   * interface covers, largest first. Zones sharing a label (the same kind of
   * control on several platforms, with 'all') are reported once, at their
   * largest - so with 'all' each kind of control is named once. `outside` is the share of the rectangle outside the clear area.
   */
  function coverage(rect, platformId, output) {
    var p = platform(platformId);
    var r = toScreen(rect, output);
    var area = r.w * r.h;
    if (area <= 0) { return { outside: 0, zones: [] }; }

    var byLabel = {};
    for (var i = 0; i < p.zones.length; i++) {
      var hit = intersect(r, p.zones[i].rect);
      if (!hit) { continue; }
      var share = hit.w * hit.h / area;
      var key = p.zones[i].label;
      if (!byLabel[key] || byLabel[key].share < share) {
        byLabel[key] = { kind: p.zones[i].kind, label: key, share: share };
      }
    }
    var zones = [];
    for (var k in byLabel) { if (byLabel.hasOwnProperty(k)) { zones.push(byLabel[k]); } }
    zones.sort(function (a, b) { return b.share - a.share; });

    var inside = intersect(r, p.safe);
    return { outside: 1 - (inside ? inside.w * inside.h / area : 0), zones: zones };
  }

  return {
    SCREEN: SCREEN,
    PLATFORMS: PLATFORMS,
    ORDER: ORDER,
    platform: platform,
    combinedSafe: combinedSafe,
    videoOnScreen: videoOnScreen,
    toScreen: toScreen,
    coverage: coverage
  };
}));
