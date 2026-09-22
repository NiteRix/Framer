/**
 * Records the fixture the panel smoke test runs against: a synthetic gameplay
 * capture with a webcam overlay in a known position, encoded by Chromium's own
 * MediaRecorder so the panel gets a genuinely decodable file.
 *
 *   node test/panel/make-fixture.js
 *
 * The overlay box below is the ground truth the smoke test checks detection
 * against, so move it there too if you change it.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'capture.webm');

(async () => {
  const browser = await chromium.launch(
    Object.assign({ args: ['--no-sandbox'] },
                  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const page = await browser.newPage();

  const b64 = await page.evaluate(async () => {
    const W = 1920, H = 1080;
    const BOX = { x: 0.04, y: 0.08, w: 0.26, h: 0.42 };
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const bx = BOX.x * W, by = BOX.y * H, bw = BOX.w * W, bh = BOX.h * H;

    function draw(t) {
      // "Gameplay": a sliding colour field with some hard edges.
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, `hsl(${(t * 40) % 360} 55% 28%)`);
      g.addColorStop(1, `hsl(${(t * 40 + 120) % 360} 50% 42%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = `hsla(${(i * 40 + t * 90) % 360} 70% 55% / 0.45)`;
        const x = ((i * 231 + t * 420) % (W + 300)) - 150;
        ctx.fillRect(x, 120 + i * 95, 190, 70);
      }

      // Webcam overlay: bright border, moving face-ish blob inside.
      ctx.fillStyle = '#20242c';
      ctx.fillRect(bx, by, bw, bh);
      const cx = bx + bw / 2 + Math.sin(t * 1.3) * bw * 0.08;
      const cy = by + bh / 2 + Math.cos(t * 1.1) * bh * 0.06;
      const rg = ctx.createRadialGradient(cx, cy, 8, cx, cy, bw * 0.45);
      rg.addColorStop(0, '#d9a07e');
      rg.addColorStop(1, '#3a3630');
      ctx.fillStyle = rg;
      ctx.fillRect(bx + 4, by + 4, bw - 8, bh - 8);
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#f2f2f2';
      ctx.strokeRect(bx + 3, by + 3, bw - 6, bh - 6);
    }

    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 4000000 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); } };

    const done = new Promise(r => { rec.onstop = r; });
    rec.start();

    const start = performance.now();
    await new Promise(resolve => {
      function tick() {
        const t = (performance.now() - start) / 1000;
        draw(t);
        if (t >= 2.5) { resolve(); } else { requestAnimationFrame(tick); }
      }
      tick();
    });
    rec.stop();
    await done;

    const blob = new Blob(chunks, { type: 'video/webm' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i++) { binary += String.fromCharCode(bytes[i]); }
    return btoa(binary);
  });

  fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
  console.log('wrote ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)');
  await browser.close();
})();
