'use strict';
const { chromium } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg-static');

const W = 1280, H = 720;
const { OUT } = require('./paths');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reading time for a caption: ~3.2 words/s plus a floor, so viewers can keep up.
const readMs = (t) => Math.max(2600, 1200 + t.split(/\s+/).length * 310);

const OVERLAY_JS = `
(() => {
  if (window.__capInit) return; window.__capInit = true;
  const st = document.createElement('style');
  st.textContent = \`
    #__cap { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); max-width:1040px; min-width:420px; z-index:2147483646;
      background:rgba(9,13,20,.92); color:#fff; font:500 21px/1.38 -apple-system,"Segoe UI",Roboto,sans-serif; padding:13px 22px 14px;
      border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,.45); border-left:4px solid #22d3ee; opacity:0; transition:opacity .35s; pointer-events:none; }
    #__cap .stp { display:block; font:600 12.5px/1 -apple-system,"Segoe UI",sans-serif; letter-spacing:.09em; text-transform:uppercase; color:#67e8f9; margin-bottom:7px; }
    #__cap code { font:19px "Cascadia Mono",Consolas,monospace; background:rgba(255,255,255,.12); padding:1px 6px; border-radius:4px; }
    #__card { position:fixed; inset:0; z-index:2147483647; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;
      background:radial-gradient(1000px 600px at 50% 30%, #17324a, #070a10 75%); color:#fff; font-family:-apple-system,"Segoe UI",Roboto,sans-serif;
      opacity:0; transition:opacity .5s; pointer-events:none; text-align:center; }
    #__card .k { font-size:15px; letter-spacing:.32em; text-transform:uppercase; color:#67e8f9; font-weight:600; }
    #__card .t { font-size:52px; font-weight:700; letter-spacing:-.01em; }
    #__card .s { font-size:22px; color:#b6c3d1; max-width:880px; line-height:1.45; }
    #__card .f { position:absolute; bottom:34px; font-size:14px; color:#7d8a96; letter-spacing:.04em; }
    #__ptr { position:fixed; width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%; background:rgba(34,211,238,.35);
      border:2px solid rgba(34,211,238,.9); z-index:2147483645; pointer-events:none; transition:left .45s ease, top .45s ease, transform .15s; left:-50px; top:-50px; }
  \`;
  const mount = () => {
    document.documentElement.appendChild(st);
    for (const id of ['__cap', '__card', '__ptr']) { const d = document.createElement('div'); d.id = id; document.documentElement.appendChild(d); }
  };
  if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount);
  window.__caption = (html, step) => {
    const c = document.getElementById('__cap');
    if (!html) { c.style.opacity = 0; return; }
    c.innerHTML = (step ? '<span class="stp">' + step + '</span>' : '') + html; c.style.opacity = 1;
  };
  window.__titleCard = (show, k, t, s, f) => {
    const c = document.getElementById('__card');
    if (show) c.innerHTML = '<div class="k">' + k + '</div><div class="t">' + t + '</div><div class="s">' + (s || '') + '</div><div class="f">' + (f || '') + '</div>';
    c.style.opacity = show ? 1 : 0;
  };
  window.__ptr = (x, y, press) => { const p = document.getElementById('__ptr'); p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.transform = press ? 'scale(.7)' : 'scale(1)'; };
})();`;

async function start(name) {
  fs.mkdirSync(OUT, { recursive: true });
  const raw = path.join(OUT, 'raw-' + name); fs.rmSync(raw, { recursive: true, force: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true,
    recordVideo: { dir: raw, size: { width: W, height: H } },
  });
  await context.addInitScript(OVERLAY_JS);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const ensure = () => page.evaluate(OVERLAY_JS).catch(() => {});

  const r = {
    page, context, browser,
    // Show a caption and hold it long enough to read. `wait:false` returns immediately (caption stays up).
    async cap(html, { step, hold, wait = true } = {}) {
      await ensure(); await page.evaluate(([h, s]) => window.__caption(h, s), [html, step || null]);
      if (wait) await sleep(hold ?? readMs(html.replace(/<[^>]+>/g, '')));
    },
    async hideCap() { await ensure(); await page.evaluate(() => window.__caption(null)); await sleep(350); },
    async card(k, t, s, f, hold = 4200) {
      await ensure(); await page.evaluate((a) => window.__titleCard(true, ...a), [k, t, s, f]);
      await sleep(hold);
    },
    async uncard() { await page.evaluate(() => window.__titleCard(false)); await sleep(600); },
    // Move the visible pointer to an element, then click it.
    async click(loc, { pause = 500 } = {}) {
      await loc.scrollIntoViewIfNeeded();
      const b = await loc.boundingBox();
      if (b) { await ensure(); await page.evaluate(([x, y]) => window.__ptr(x, y), [b.x + b.width / 2, b.y + b.height / 2]); await sleep(550); }
      if (b) await page.evaluate(([x, y]) => window.__ptr(x, y, true), [b.x + b.width / 2, b.y + b.height / 2]);
      await loc.click(); await sleep(140);
      if (b) await page.evaluate(([x, y]) => window.__ptr(x, y, false), [b.x + b.width / 2, b.y + b.height / 2]);
      await sleep(pause);
    },
    async type(loc, text, delay = 55) { await r.click(loc, { pause: 150 }); await loc.pressSequentially(text, { delay }); await sleep(300); },
    async finish(outName) {
      const video = page.video();
      await context.close(); await browser.close();
      const webm = await video.path();
      const mp4 = path.join(OUT, outName + '.mp4');
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', '-an', mp4]);
      return mp4;
    },
  };
  return r;
}

// Start the live terminal server for one product; returns { url, stop }.
async function terminal({ port, home, extraEnv = {}, title, prompt }) {
  const p = spawn(process.execPath, [path.join(__dirname, 'termserver.js')], {
    env: { ...process.env, TERM_PORT: String(port), DEMO_HOME: home, EXTRA_ENV: JSON.stringify(extraEnv) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res) => p.stdout.once('data', res));
  const q = new URLSearchParams({ title, prompt });
  return { url: `http://127.0.0.1:${port}/?${q}`, stop: () => p.kill() };
}

module.exports = { start, terminal, sleep, readMs, OUT };
