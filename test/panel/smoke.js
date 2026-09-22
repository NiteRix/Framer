/**
 * Boots the real Framer panel in Chromium with a stubbed CEP host, drives it
 * the way a user would, and checks what it would send to Premiere. This is the
 * only way to exercise the panel without Premiere itself.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node test/panel/make-fixture.js
 *   node test/panel/smoke.js
 *
 * Set CHROMIUM_PATH to use a Chromium that is already on the machine.
 * Screenshots of each layout are written next to this file.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// FRAMER_EXT lets this run against a staged or installed payload, not just the
// repo checkout - which is how a shipped build gets verified end to end.
const EXT = process.env.FRAMER_EXT
  ? path.resolve(process.env.FRAMER_EXT)
  : path.join(__dirname, '..', '..', 'extension');
const VIDEO = path.join(__dirname, 'capture.webm');

if (!fs.existsSync(VIDEO)) {
  console.error('Fixture missing. Run:  node test/panel/make-fixture.js');
  process.exit(2);
}
const TRUTH = { x: 0.04, y: 0.08, w: 0.26, h: 0.42 };

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) { failures++; }
}

(async () => {
  const browser = await chromium.launch(Object.assign({
    args: ['--no-sandbox', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required']
  }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });

  // --- stub the CEP host, before CSInterface.js parses -------------------
  await page.addInitScript(({ video, extPath }) => {
    window.__framerCalls = [];
    window.__adobe_cep__ = {
      getHostEnvironment: () => JSON.stringify({
        appName: 'PPRO', appVersion: '25.0.0', appLocale: 'en_US',
        appUILocale: 'en_US', appId: 'PPRO', isAppOnline: true,
        appSkinInfo: {
          baseFontFamily: 'sans-serif', baseFontSize: 12,
          appBarBackgroundColor: { color: { red: 30, green: 33, blue: 38, alpha: 255 } },
          panelBackgroundColor: { color: { red: 30, green: 33, blue: 38, alpha: 255 } }
        }
      }),
      getSystemPath: () => 'file://' + extPath,
      getHostCapabilities: () => JSON.stringify({ EXTENDED_PANEL_MENU: true }),
      getCurrentApiVersion: () => JSON.stringify({ major: 11, minor: 0, micro: 0 }),
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
      getScaleFactor: () => 1,
      getMonitorScaleFactor: () => 1,

      evalScript: (script, callback) => {
        const name = script.slice(0, script.indexOf('('));
        let arg = null;
        const open = script.indexOf('(');
        if (script.length > open + 2) {
          try { arg = JSON.parse(JSON.parse(script.slice(open + 1, script.lastIndexOf(')')))); }
          catch (e) { arg = null; }
        }
        window.__framerCalls.push({ name, arg });

        const reply = (obj) => callback(JSON.stringify(Object.assign({ log: [] }, obj)));

        switch (name) {
          case 'framerPing':
            return reply({ ok: true, pong: true, appVersion: '25.0.0' });
          case 'framerDiagnostics':
            return reply({
              ok: true, app: { version: '25.0.0', build: 'x', locale: 'en_US' },
              project: { open: true, name: 'test.prproj', path: '/tmp/test.prproj', sequenceCount: 1 },
              activeSequence: { name: 'raid', width: 1920, height: 1080, videoTracks: 3, audioTracks: 2 },
              capabilities: {
                createNewSequenceFromClips: true, createNewSequence: true,
                sequenceGetSettings: true, sequenceSetSettings: true,
                exportFramePNG: true, exportFrameJPEG: true, qe: true
              }
            });
          case 'framerInspect':
            return reply({
              ok: true,
              source: {
                name: 'raid_vod.webm', nodeId: 'node-1', mediaPath: video,
                width: 1920, height: 1080, dimensionsFrom: 'xmp',
                origin: 'sequenceSelection', inPoint: 0.2, outPoint: 2.2,
                clipDuration: 2.0, mediaDuration: 2.5, hasAudio: true, hasVideo: true
              },
              sequence: { name: 'raid', width: 1920, height: 1080 }
            });
          case 'framerBuild':
            return reply({
              ok: true,
              sequence: { name: 'raid_vod - Vertical', width: 1080, height: 1920, videoTracks: 3 },
              layers: (arg.layers || []).map(l => ({
                role: l.role, track: l.track + 1, placed: true, transformed: true,
                applied: { crop: !!l.crop, scale: true, position: true }
              })),
              placed: (arg.layers || []).length, audio: true
            });
          case 'framerExportStill':
            return reply({ ok: false, error: 'not needed in this test' });
          default:
            return callback('EvalScript error.');
        }
      }
    };
  }, { video: VIDEO, extPath: EXT });

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') { consoleErrors.push(m.text()); } });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  console.log('  payload: ' + EXT);
  await page.goto('file://' + path.join(EXT, 'index.html'));
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('host script ready'),
                             null, { timeout: 15000 });
  console.log('\nPanel smoke test\n');
  check('panel boots and reaches the host', true);

  // --- 1. read the selection -------------------------------------------
  await page.click('#btn-read');
  await page.waitForFunction(
    () => document.getElementById('fact-frame').textContent.includes('media file'),
    null, { timeout: 20000 });

  check('source name shown', (await page.textContent('#fact-name')) === 'raid_vod.webm');
  check('source size shown', (await page.textContent('#fact-size')).startsWith('1920 x 1080'),
        await page.textContent('#fact-size'));
  check('clip range shown', (await page.textContent('#fact-range')).includes('0.20s - 2.20s'),
        await page.textContent('#fact-range'));
  check('reference frame came from the media file',
        (await page.textContent('#fact-frame')).includes('media file'));

  // --- 2. auto-detect the webcam ---------------------------------------
  await page.click('#btn-detect');
  await page.waitForFunction(() => {
    const t = document.getElementById('detect-note').textContent;
    return t && t.length > 0;
  }, null, { timeout: 30000 });

  const note = await page.textContent('#detect-note');
  const detected = await page.evaluate(() => {
    const fields = ['r-x', 'r-y', 'r-w', 'r-h'].map(id => Number(document.getElementById(id).value) / 100);
    return { x: fields[0], y: fields[1], w: fields[2], h: fields[3] };
  });
  const overlap = iou(detected, TRUTH);
  check('detection reported a result', /frame\(s\)/.test(note), note);
  check('detected box matches the real webcam box', overlap > 0.5,
        `iou=${overlap.toFixed(2)} got=${JSON.stringify(detected)}`);

  // --- 3. every layout renders a non-blank composite --------------------
  const layouts = await page.evaluate(() =>
    Array.from(document.getElementById('layout').options).map(o => o.value));

  for (const id of layouts) {
    await page.selectOption('#layout', id);
    await page.waitForTimeout(250);
    const stats = await page.evaluate(() => {
      const c = document.getElementById('composite');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let lit = 0, sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (v > 24) { lit++; }
        sum += v;
      }
      return { fraction: lit / (d.length / 4), mean: sum / (d.length / 4), w: c.width, h: c.height };
    });
    check(`${id}: composite fills the frame`, stats.fraction > 0.9,
          `${(stats.fraction * 100).toFixed(0)}% of pixels lit, mean ${stats.mean.toFixed(0)}`);
    check(`${id}: composite is 9:16`, Math.abs(stats.h / stats.w - 1920 / 1080) < 0.02,
          `${stats.w}x${stats.h}`);
    const summary = await page.textContent('#plan-summary');
    check(`${id}: plan summary lists layers`, summary.includes('V1'), summary.replace(/\s+/g, ' ').trim());
    await page.screenshot({ path: path.join(__dirname, `shot-${id}.png`), fullPage: true });
  }

  // --- 4. build, and inspect the payload -------------------------------
  await page.selectOption('#layout', 'overlay');
  await page.waitForTimeout(200);
  await page.click('#btn-build');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Built'),
                             null, { timeout: 15000 });

  const build = await page.evaluate(() =>
    window.__framerCalls.filter(c => c.name === 'framerBuild').pop());

  check('build payload reached the host', !!build && !!build.arg);
  const payload = build.arg;
  check('payload output is 1080x1920',
        payload.output.width === 1080 && payload.output.height === 1920,
        JSON.stringify(payload.output));
  check('payload carries the source nodeId', payload.source && payload.source.nodeId === 'node-1');
  check('payload carries the clip trim',
        payload.trim && Math.abs(payload.trim.inPoint - 0.2) < 1e-6 &&
        Math.abs(payload.trim.outPoint - 2.2) < 1e-6, JSON.stringify(payload.trim));
  check('webcam layer is the top track',
        payload.layers[payload.layers.length - 1].role === 'webcam',
        payload.layers.map(l => `V${l.track + 1}:${l.role}`).join(' '));

  const allFinite = payload.layers.every(l =>
    isFinite(l.scale) && l.scale > 0 && l.position.length === 2 &&
    isFinite(l.position[0]) && isFinite(l.position[1]) &&
    (!l.crop || ['left', 'top', 'right', 'bottom'].every(k => isFinite(l.crop[k]) && l.crop[k] >= 0 && l.crop[k] < 100)));
  check('every layer has finite, in-range values', allFinite, JSON.stringify(payload.layers));

  check('status reports success', (await page.textContent('#status')).includes('Built'),
        await page.textContent('#status'));

  // --- 5. region editing round-trips ------------------------------------
  await page.fill('#r-x', '10');
  await page.fill('#r-w', '30');
  await page.dispatchEvent('#r-w', 'change');
  await page.waitForTimeout(200);
  const afterEdit = await page.inputValue('#r-x');
  check('typed region values are kept', Math.abs(Number(afterEdit) - 10) < 0.2, `x=${afterEdit}`);

  // --- 6. drag the webcam box on the picker -----------------------------
  const before = await page.evaluate(() => Number(document.getElementById('r-y').value));
  // Clicking Build scrolled the panel, so bring the picker back into view and
  // measure it again before aiming the mouse at it.
  await page.locator('#picker').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await page.locator('#picker').boundingBox();
  console.log('       picker box:', JSON.stringify(box));
  const region = await page.evaluate(() => ({
    x: Number(document.getElementById('r-x').value) / 100,
    y: Number(document.getElementById('r-y').value) / 100,
    w: Number(document.getElementById('r-w').value) / 100,
    h: Number(document.getElementById('r-h').value) / 100
  }));
  const aimX = box.x + box.width * (region.x + region.w / 2);
  const aimY = box.y + box.height * (region.y + region.h / 2);
  await page.mouse.move(aimX, aimY);
  await page.mouse.down();
  await page.mouse.move(aimX + box.width * 0.06, aimY + box.height * 0.12, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => Number(document.getElementById('r-y').value));
  check('dragging on the frame moves the region', Math.abs(after - before) > 1,
        `y ${before} -> ${after}`);

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await page.screenshot({ path: path.join(__dirname, 'shot-final.png'), fullPage: true });
  await browser.close();

  console.log(`\n${failures === 0 ? 'all panel checks passed' : failures + ' panel check(s) failed'}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
