/**
 * Boots the real Framer panel in Chromium with a stubbed CEP host, drives it
 * the way a user would, and checks what it asks of Premiere.
 *
 * The stub is modelled on what actually happens in Premiere, not on what is
 * convenient: the clip is an H.264 MP4 the panel's browser cannot decode, so
 * reference frames have to come from Premiere-rendered stills. A first version
 * of this test fed the panel a WebM it could decode, passed, and let exactly
 * that failure ship.
 *
 * Scenarios:
 *   field      undecodable MP4, Premiere renders stills   (the normal case)
 *   no-dims    as field, but nothing reports the clip's pixel size
 *   mismatch   the clip is 4:3 on a 16:9 sequence
 *   fallback   Premiere refuses to render; the panel decodes the file itself
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node test/panel/make-fixture.js
 *   node test/panel/smoke.js
 *
 * CHROMIUM_PATH selects a Chromium already on the machine; FRAMER_EXT points
 * the test at a staged or installed payload instead of the checkout.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXT = process.env.FRAMER_EXT
  ? path.resolve(process.env.FRAMER_EXT)
  : path.join(__dirname, '..', '..', 'extension');
const VIDEO = path.join(__dirname, 'capture.webm');
const STILLS = Array.from({ length: 8 }, (_, k) => path.join(__dirname, 'still-' + k + '.png'));
const UNDECODABLE = path.join(__dirname, 'undecodable.mp4');
const TRUTH = { x: 0.04, y: 0.08, w: 0.26, h: 0.42 };
const SEQ_START = 10, SEQ_END = 12.5;

for (const f of [VIDEO].concat(STILLS)) {
  if (!fs.existsSync(f)) {
    console.error('Fixture missing (' + path.basename(f) + '). Run:  node test/panel/make-fixture.js');
    process.exit(2);
  }
}
// An .mp4 that no browser will decode - standing in for the H.264 files the
// panel's embedded browser rejects in the field.
fs.writeFileSync(UNDECODABLE, Buffer.concat([Buffer.from('\0\0\0\x18ftypmp42'), Buffer.alloc(4096, 7)]));

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

/** Open the panel with a host stub configured for one scenario. */
async function boot(browser, config) {
  const context = await browser.newContext({ viewport: { width: 420, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();

  await page.addInitScript((cfg) => {
    window.__framerCalls = [];
    window.__adobe_cep__ = {
      getHostEnvironment: () => JSON.stringify({
        appName: 'PPRO', appVersion: '26.0.1', appLocale: 'en_US', appId: 'PPRO',
        appSkinInfo: { baseFontFamily: 'sans-serif', baseFontSize: 12,
          panelBackgroundColor: { color: { red: 30, green: 33, blue: 38, alpha: 255 } } }
      }),
      getSystemPath: () => 'file://' + cfg.extPath,
      getHostCapabilities: () => JSON.stringify({}),
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {},
      getScaleFactor: () => 1, getMonitorScaleFactor: () => 1,

      evalScript: (script, callback) => {
        const name = script.slice(0, script.indexOf('('));
        const open = script.indexOf('(');
        let arg = null;
        if (script.length > open + 2) {
          try { arg = JSON.parse(JSON.parse(script.slice(open + 1, script.lastIndexOf(')')))); } catch (e) { arg = null; }
        }
        window.__framerCalls.push({ name, arg });
        const reply = (obj) => setTimeout(() => callback(JSON.stringify(Object.assign({ log: [] }, obj))), 5);

        switch (name) {
          case 'framerPing':
            return reply({ ok: true, pong: true, appVersion: '26.0.1' });
          case 'framerInspect':
            return reply({ ok: true, source: {
              name: 'TubularPrettyWaspAliens_source.mp4', nodeId: 'node-1', mediaPath: cfg.mediaPath,
              width: cfg.dims ? cfg.dims.width : null, height: cfg.dims ? cfg.dims.height : null,
              dimensionsFrom: cfg.dims ? 'fileHeader' : null,
              origin: 'sequenceSelection', inPoint: 0.2, outPoint: 2.7, clipDuration: 2.5,
              mediaDuration: 3, seqStart: cfg.seqStart, seqEnd: cfg.seqEnd, hasAudio: true, hasVideo: true
            }, sequence: { name: 'source', width: 1920, height: 1080 } });
          case 'framerExportStills': {
            if (!cfg.stillsWork) {
              return reply({ ok: false, error: 'Premiere would not render a still frame from the active sequence.' });
            }
            const times = (arg && arg.times) || [null];
            return reply({ ok: true, width: 1920, height: 1080, sequence: 'source',
              stills: times.map((t, i) => ({ path: cfg.stills[i % cfg.stills.length], seconds: t === null ? 11 : t })) });
          }
          case 'framerBuild':
            return reply({ ok: true,
              sequence: { id: 'seq-9', name: 'Vertical', width: 1080, height: 1920, videoTracks: 3 },
              layers: (arg.layers || []).map(l => ({ role: l.role, track: l.track + 1, placed: true, transformed: true })),
              placed: (arg.layers || []).length, audio: true, audioClips: 1 });
          case 'framerFocus':
            return reply({ ok: true, mode: arg.mode, moments: 1, clips: 2, warnings: 0 });
          default:
            return callback('EvalScript error.');
        }
      }
    };
  }, Object.assign({ extPath: EXT, stills: STILLS, seqStart: SEQ_START, seqEnd: SEQ_END }, config));

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto('file://' + path.join(EXT, 'index.html'));
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('host script ready'),
                             null, { timeout: 15000 });
  return { page, context, errors };
}

async function readSelection(page) {
  await page.click('#btn-read');
  await page.waitForFunction(() => {
    const frame = document.getElementById('fact-frame').textContent;
    const status = document.getElementById('status');
    return frame.includes('Premiere') || frame.includes('panel') || status.classList.contains('is-error');
  }, null, { timeout: 20000 });
}

function calls(page, name) {
  return page.evaluate((n) => window.__framerCalls.filter(c => c.name === n), name);
}

async function regionFields(page) {
  return page.evaluate(() => {
    const v = ['r-x', 'r-y', 'r-w', 'r-h'].map(id => Number(document.getElementById(id).value) / 100);
    return { x: v[0], y: v[1], w: v[2], h: v[3] };
  });
}

async function detect(page) {
  await page.click('#btn-detect');
  await page.waitForFunction(() => document.getElementById('detect-note').textContent.length > 0,
                             null, { timeout: 30000 });
  return page.textContent('#detect-note');
}

(async () => {
  const browser = await chromium.launch(Object.assign({
    args: ['--no-sandbox', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required']
  }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));

  console.log('\n  payload: ' + EXT);

  /* ------------------------------------------------------------------ */
  console.log('\nfield: undecodable MP4, Premiere renders the frames\n');
  {
    const { page, context, errors } = await boot(browser, {
      mediaPath: UNDECODABLE, dims: { width: 1920, height: 1080 }, stillsWork: true
    });

    await readSelection(page);
    const frame = await page.textContent('#fact-frame');
    check('reference frame is rendered by Premiere', frame.includes('rendered by Premiere'), frame);
    check('status is ok, not an error', await page.evaluate(() =>
      document.getElementById('status').classList.contains('is-ok')), await page.textContent('#status'));
    check('source size is what the host reported', (await page.textContent('#fact-size')).startsWith('1920 x 1080'));

    const first = (await calls(page, 'framerExportStills'))[0];
    const t0 = first && first.arg && first.arg.times && first.arg.times[0];
    check('the still is requested inside the clip, in sequence time',
          t0 > SEQ_START && t0 < SEQ_END, 'asked for ' + t0);

    check('scrub is usable with Premiere stills', !(await page.isDisabled('#scrub')));
    const before = (await calls(page, 'framerExportStills')).length;
    await page.evaluate(() => {
      const s = document.getElementById('scrub');
      s.value = '0.8';
      s.dispatchEvent(new Event('input'));
    });
    await page.waitForFunction((n) =>
      window.__framerCalls.filter(c => c.name === 'framerExportStills').length > n, before, { timeout: 5000 });
    const scrubCall = (await calls(page, 'framerExportStills')).pop();
    const expected = SEQ_START + (SEQ_END - SEQ_START) * 0.8;
    check('scrubbing renders the frame at the new position',
          Math.abs(scrubCall.arg.times[0] - expected) < 0.01, `${scrubCall.arg.times[0]} vs ${expected}`);

    const note = await detect(page);
    const detectCall = (await calls(page, 'framerExportStills')).pop();
    const times = detectCall.arg.times || [];
    check('detection asks Premiere for frames across the clip', times.length === 8,
          times.map(t => t.toFixed(2)).join(' '));
    check('every detection frame is inside the clip', times.every(t => t > SEQ_START && t < SEQ_END));
    const found = await regionFields(page);
    check('detected box matches the real webcam box', iou(found, TRUTH) > 0.5,
          `iou=${iou(found, TRUTH).toFixed(2)} (${note.trim()})`);

    for (const id of ['split', 'overlay', 'blur', 'full']) {
      await page.selectOption('#layout', id);
      await page.waitForTimeout(150);
      const lit = await page.evaluate(() => {
        const c = document.getElementById('composite');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) { if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 24) { n++; } }
        return n / (d.length / 4);
      });
      check(`${id}: composite fills the 9:16 frame`, lit > 0.9, `${(lit * 100).toFixed(0)}% lit`);
      await page.screenshot({ path: path.join(__dirname, `shot-${id}.png`), fullPage: true });
    }

    await page.selectOption('#layout', 'overlay');
    await page.click('#btn-build');
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Built'),
                               null, { timeout: 15000 });
    const build = (await calls(page, 'framerBuild')).pop();
    const layers = build.arg.layers;
    check('build sends a 1080x1920 plan', build.arg.output.width === 1080 && build.arg.output.height === 1920);
    check('webcam is the top layer', layers[layers.length - 1].role === 'webcam',
          layers.map(l => `V${l.track + 1}:${l.role}`).join(' '));
    check('every layer value is finite and in range', layers.every(l =>
      isFinite(l.scale) && l.scale > 0 && l.position.every(isFinite) &&
      (!l.crop || ['left', 'top', 'right', 'bottom'].every(k => l.crop[k] >= 0 && l.crop[k] < 100))));

    // --- split: fit, centre, aspect-locked drag, full-frame crops, focus ---
    await page.selectOption('#layout', 'split');
    await page.click('#btn-suggest');
    const fit = await regionFields(page);
    const overlapX = Math.min(fit.x + fit.w, TRUTH.x + TRUTH.w) - Math.max(fit.x, TRUTH.x);
    const overlapY = Math.min(fit.y + fit.h, TRUTH.y + TRUTH.h) - Math.max(fit.y, TRUTH.y);
    check('Fit gameplay clears the webcam box', overlapX <= 0.002 || overlapY <= 0.002,
          `gameplay x ${(fit.x * 100).toFixed(1)}..${((fit.x + fit.w) * 100).toFixed(1)}`);
    check('Fit gameplay stays near the middle', Math.abs(fit.x + fit.w / 2 - 0.5) < 0.06,
          `centre at ${((fit.x + fit.w / 2) * 100).toFixed(1)}%`);

    await page.click('#btn-centre-h');
    const centred = await regionFields(page);
    check('Centre puts the gameplay box in the middle', Math.abs(centred.x + centred.w / 2 - 0.5) < 0.002,
          `centre at ${((centred.x + centred.w / 2) * 100).toFixed(2)}%`);

    const bandAspect = 1080 / (1920 - Math.round(1920 * 0.34));
    const shownAspect = centred.w * 1920 / (centred.h * 1080);
    check('the gameplay box shown is the band shape the plan uses', Math.abs(shownAspect - bandAspect) < 0.02,
          `${shownAspect.toFixed(3)} vs ${bandAspect.toFixed(3)}`);

    await page.locator('#picker').scrollIntoViewIfNeeded();
    const pbox = await page.locator('#picker').boundingBox();
    const cx = pbox.x + pbox.width * (centred.x + centred.w), cy = pbox.y + pbox.height * (centred.y + centred.h);
    await page.mouse.move(cx - 1, cy - 1);
    await page.mouse.down();
    await page.mouse.move(cx - pbox.width * 0.12, cy - pbox.height * 0.05, { steps: 8 });
    await page.mouse.up();
    const resized = await regionFields(page);
    const resizedAspect = resized.w * 1920 / (resized.h * 1080);
    check('dragging a corner resizes the gameplay box', resized.w < centred.w - 0.02,
          `w ${(centred.w * 100).toFixed(1)} -> ${(resized.w * 100).toFixed(1)}`);
    check('and keeps the band shape while doing it', Math.abs(resizedAspect - bandAspect) < 0.02,
          `${resizedAspect.toFixed(3)} vs ${bandAspect.toFixed(3)}`);
    check('and never leaves the frame', resized.x >= 0 && resized.y >= 0 &&
          resized.x + resized.w <= 1.001 && resized.y + resized.h <= 1.001);

    const summary = await page.textContent('#plan-summary');
    check('the summary says the gameplay keeps its full frame', /gameplay[\s\S]*full frame/.test(summary), summary);

    async function buildLayers() {
      const n = (await calls(page, 'framerBuild')).length;
      await page.click('#btn-build');
      await page.waitForFunction((k) =>
        window.__framerCalls.filter(c => c.name === 'framerBuild').length > k, n, { timeout: 5000 });
      await page.waitForFunction(() => !document.getElementById('btn-build').disabled, null, { timeout: 5000 });
      return (await calls(page, 'framerBuild')).pop().arg.layers;
    }
    const kept = await buildLayers();
    const keptPlay = kept.find(l => l.role === 'gameplay'), keptCam = kept.find(l => l.role === 'webcam');
    check('full frame: the gameplay layer is sent with no crop', keptPlay.crop === null, JSON.stringify(keptPlay.crop));
    check('full frame: the webcam is cut only where the gameplay starts',
          keptCam.crop && keptCam.crop.bottom > 0 && !keptCam.crop.left && !keptCam.crop.right && !keptCam.crop.top,
          JSON.stringify(keptCam.crop));

    await page.uncheck('#opt-fullframe');
    const tight = await buildLayers();
    check('with the option off, every layer is cropped to its region',
          tight.every(l => l.crop && l.crop.left + l.crop.right + l.crop.top + l.crop.bottom > 0));
    await page.check('#opt-fullframe');

    await page.click('#btn-focus-gameplay');
    await page.waitForFunction(() => document.getElementById('focus-note').textContent.length > 0,
                               null, { timeout: 5000 });
    const focusCall = (await calls(page, 'framerFocus')).pop();
    const rec = focusCall && focusCall.arg.records && focusCall.arg.records['seq-9'];
    check('Focus sends the record of the sequence that was built', !!rec && focusCall.arg.mode === 'gameplay',
          focusCall ? Object.keys(focusCall.arg.records || {}).join(',') : 'no call');
    check('the record carries full-frame values for both layers',
          !!(rec && rec.focus.gameplay && rec.focus.webcam && rec.layers.length === 2));
    check('Focus reports back', (await page.textContent('#focus-note')).includes('Gameplay only'));
    await page.screenshot({ path: path.join(__dirname, 'shot-split-fitted.png'), fullPage: true });

    await page.selectOption('#layout', 'overlay');
    await page.click('#tab-webcam');

    // Region editing: typed values and dragging on the frame.
    await page.fill('#r-x', '10');
    await page.dispatchEvent('#r-x', 'change');
    check('typed region values are kept', Math.abs(Number(await page.inputValue('#r-x')) - 10) < 0.2);

    await page.locator('#picker').scrollIntoViewIfNeeded();
    const box = await page.locator('#picker').boundingBox();
    const r = await regionFields(page);
    const aimX = box.x + box.width * (r.x + r.w / 2), aimY = box.y + box.height * (r.y + r.h / 2);
    await page.mouse.move(aimX, aimY);
    await page.mouse.down();
    await page.mouse.move(aimX + box.width * 0.06, aimY + box.height * 0.12, { steps: 8 });
    await page.mouse.up();
    const moved = await regionFields(page);
    check('dragging on the frame moves the region', Math.abs(moved.y - r.y) > 0.01,
          `y ${(r.y * 100).toFixed(1)} -> ${(moved.y * 100).toFixed(1)}`);

    // Copy log lives in the collapsed Advanced section, as a user finds it.
    await page.click('details.card > summary');
    await page.click('#btn-copy-log');
    const status = await page.textContent('#status');
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('Copy log puts the log on the clipboard', status.includes('copied') && clip.includes('host script ready'),
          status);

    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(__dirname, 'shot-final.png'), fullPage: true });
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\nno-dims: nothing reports the clip\'s pixel size\n');
  {
    const { page, context, errors } = await boot(browser, {
      mediaPath: UNDECODABLE, dims: null, stillsWork: true
    });
    await readSelection(page);
    const size = await page.textContent('#fact-size');
    check('size is taken from the sequence frame', size.includes('1920 x 1080') && size.includes('assumed'), size);
    const status = await page.textContent('#status');
    check('the user is told it was assumed, and how to fix it',
          status.includes('assumed') && status.includes('Source size is wrong'), status);
    check('build is available', !(await page.isDisabled('#btn-build')));
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\nmismatch: 4:3 clip on a 16:9 sequence\n');
  {
    const { page, context } = await boot(browser, {
      mediaPath: UNDECODABLE, dims: { width: 1440, height: 1080 }, stillsWork: true
    });
    await readSelection(page);
    const status = await page.textContent('#status');
    check('warns that the frame will not line up', status.includes('will not line up'), status);
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\nfallback: Premiere refuses, the panel decodes the file\n');
  {
    const { page, context, errors } = await boot(browser, {
      mediaPath: VIDEO, dims: { width: 1920, height: 1080 }, stillsWork: false
    });
    await readSelection(page);
    const frame = await page.textContent('#fact-frame');
    check('reference frame is decoded by the panel', frame.includes('decoded by the panel'), frame);
    const note = await detect(page);
    const found = await regionFields(page);
    check('detection still works from the decoded video', iou(found, TRUTH) > 0.5,
          `iou=${iou(found, TRUTH).toFixed(2)} (${note.trim()})`);
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\nnothing works: undecodable file and no stills\n');
  {
    const { page, context } = await boot(browser, {
      mediaPath: UNDECODABLE, dims: { width: 1920, height: 1080 }, stillsWork: false
    });
    await readSelection(page);
    const status = await page.textContent('#status');
    check('explains both failures', status.includes('Premiere would not render') && status.includes('could not decode'),
          status);
    await context.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? 'all panel checks passed' : failures + ' panel check(s) failed'}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
