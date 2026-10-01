#!/usr/bin/env node
'use strict';
// Cut short social clips (square 1080x1080 + vertical 1080x1920) from the full demo
// videos: a headline band above the video, a call-to-action band below, and the last
// frame held for a beat so the CTA lands. Also writes 1280x720 poster images.
//
//   CLIPS_SRC=<folder with the full MP4s>  CLIPS_OUT=<dest>  node make-clips.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const ffmpeg = require('ffmpeg-static');
const { OUT } = require('./paths');

const SRC = process.env.CLIPS_SRC || OUT;
const DEST = process.env.CLIPS_OUT || path.join(OUT, 'clips');
const SITE = 'phaethonsecurity.com';

// Windows into the full videos. Times are seconds; `speed` > 1 plays faster.
const CLIPS = [
  { id: 'attestor-signed-evidence', src: 'Attestor-2-Overview.mp4', from: 103, to: 117, speed: 1,
    kicker: 'Attestor', head: 'Assessor-ready evidence,<br>signed and verifiable', cta: 'Try Attestor', url: '/attestor/trial' },
  { id: 'attestor-control-mapping', src: 'Attestor-2-Overview.mp4', from: 55, to: 69, speed: 1,
    kicker: 'Attestor', head: 'Every log event mapped to<br>NIST 800-171 &amp; CMMC controls', cta: 'Try Attestor', url: '/attestor/trial' },
  { id: 'ordinance-allow-deny-escalate', src: 'Ordinance-2-Overview.mp4', from: 6, to: 45, speed: 1.5,
    kicker: 'Ordinance', head: 'Allow. Deny. Escalate.<br>Before the action happens.', cta: 'Try Ordinance free', url: '/ordinance/trial' },
  { id: 'ordinance-human-approval', src: 'Ordinance-2-Overview.mp4', from: 66, to: 96, speed: 1.25,
    kicker: 'Ordinance', head: 'A human in the loop<br>for risky actions', cta: 'Try Ordinance free', url: '/ordinance/trial' },
  { id: 'attestor-install-timelapse', src: 'Attestor-1-Installation.mp4', from: 5, to: 145, speed: 6,
    kicker: 'Attestor', head: 'Self-hosted, installed in<br>about two minutes', cta: 'Try Attestor', url: '/attestor/trial', badge: '6× speed' },
];
const FORMATS = { square: { w: 1080, h: 1080, videoY: 262 }, vertical: { w: 1080, h: 1920, videoY: 640 } };
const VIDEO_H = 608; // 1280x720 scaled to 1080 wide
const HOLD = 2.5;    // seconds the last frame is held at the end

const frameHtml = (c, f) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${f.w}px;height:${f.h}px;overflow:hidden;font-family:"Segoe UI",-apple-system,Roboto,sans-serif;
    background:radial-gradient(900px 700px at 50% 20%,#17324a,#070a10 72%);color:#fff}
  .top{position:absolute;left:70px;right:70px;bottom:${f.h - f.videoY + 46}px}
  .k{font-size:26px;letter-spacing:.3em;text-transform:uppercase;color:#67e8f9;font-weight:700;margin-bottom:18px}
  .h{font-size:${f.h > 1500 ? 66 : 58}px;line-height:1.12;font-weight:700;letter-spacing:-.01em}
  .hole{position:absolute;left:0;top:${f.videoY}px;width:${f.w}px;height:${VIDEO_H}px;background:#000;box-shadow:0 0 0 1px rgba(103,232,249,.25)}
  .badge{position:absolute;right:24px;top:${f.videoY - 50}px;font-size:22px;color:#b6c3d1}
  .bot{position:absolute;left:70px;right:70px;top:${f.videoY + VIDEO_H + (f.h > 1500 ? 56 : 44)}px;${f.h > 1500 ? '' : 'display:flex;align-items:center;gap:30px'}}
  .cta{display:inline-block;background:#22d3ee;color:#04121a;font-weight:700;font-size:36px;padding:18px 34px;border-radius:12px}
  .u{margin-top:${f.h > 1500 ? 22 : 0}px;font-size:28px;color:#b6c3d1}
  .brand{position:absolute;left:70px;bottom:${f.h > 1500 ? 140 : 44}px;font-size:22px;color:#7d8a96;letter-spacing:.06em}
</style></head><body>
  <div class="top"><div class="k">${c.kicker}</div><div class="h">${c.head}</div></div>
  <div class="hole"></div>${c.badge ? `<div class="badge">${c.badge}</div>` : ''}
  <div class="bot"><div class="cta">${c.cta} →</div><div class="u">${SITE}${c.url}</div></div>
  ${f.h > 1500 ? '<div class="brand">PHAETHON SECURITY · self-hosted · no audio</div>' : ''}
</body></html>`;

(async () => {
  fs.mkdirSync(DEST, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  for (const c of CLIPS) {
    for (const [fmt, f] of Object.entries(FORMATS)) {
      await page.setViewportSize({ width: f.w, height: f.h });
      await page.setContent(frameHtml(c, f));
      const bg = path.join(DEST, `.${c.id}-${fmt}.png`);
      await page.screenshot({ path: bg });
      const out = path.join(DEST, `${c.id}-${fmt}.mp4`);
      const dur = (c.to - c.from) / c.speed + HOLD;
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error',
        '-loop', '1', '-i', bg,
        '-ss', String(c.from), '-to', String(c.to), '-i', path.join(SRC, c.src),
        '-filter_complex',
        `[1:v]setpts=(PTS-STARTPTS)/${c.speed},scale=${f.w}:${VIDEO_H},tpad=stop_mode=clone:stop_duration=${HOLD}[v];` +
        `[0:v][v]overlay=0:${f.videoY}:eof_action=pass,format=yuv420p[o]`,
        '-map', '[o]', '-t', dur.toFixed(2), '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
        '-movflags', '+faststart', '-an', out]);
      fs.rmSync(bg);
      console.log(`${path.basename(out)}  ${dur.toFixed(1)}s`);
    }
  }

  // Posters for the full videos (the title-card frame), for site embeds.
  for (const v of ['Attestor-1-Installation', 'Attestor-2-Overview', 'Ordinance-1-Installation', 'Ordinance-2-Overview']) {
    const src = path.join(SRC, `${v}.mp4`);
    if (!fs.existsSync(src)) continue;
    const out = path.join(DEST, `poster-${v}.jpg`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', '2.5', '-i', src, '-frames:v', '1', '-q:v', '3', out]);
    console.log(path.basename(out));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
