// The website's own logo animations, recorded at 60 fps, for the After Effects kit.
//   node tools/after-effects/reference.cjs
// Plays each animation in Chromium (live.cjs), frame by frame at 60 fps, framed exactly as its
// After Effects comp, and encodes an H.264 video into tools/after-effects/out/reference/. Then
// run make.py, which puts them in the kit. Needs Playwright and ffmpeg (on the PATH, or the one
// that ships with Python's imageio-ffmpeg).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const live = require('./live.cjs');

const OUT = path.join(__dirname, 'out', 'reference');
const FPS = 60;
const VIDEOS = [
  { key: 'intro16', file: 'Evolution24 Intro 16x9 - website.mp4', seconds: 3.5 },
  { key: 'intro9', file: 'Evolution24 Intro 9x16 - website.mp4', seconds: 2.5 },
  { key: 'lockup', file: 'Evolution24 Lockup Build 16x9 - website.mp4', seconds: 3.0 },
];

function ffmpegPath() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch { /* try Python's */ }
  return execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ffmpeg = ffmpegPath();
  const { browser, stop } = await live.start();
  for (const v of VIDEOS) {
    const site = await live.open(browser, v.key);
    const dest = path.join(OUT, v.file);
    const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest], { stdio: ['pipe', 'inherit', 'inherit'] });
    const frames = Math.round(v.seconds * FPS);
    for (let i = 0; i < frames; i++) {
      const png = await site.seek(i / FPS);
      if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once('drain', r));
    }
    enc.stdin.end();
    await new Promise((resolve, reject) => enc.on('close', (code) => (code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve())));
    await site.close();
    console.log(`${v.file}: ${frames} frames, ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
  }
  await stop();
})();
