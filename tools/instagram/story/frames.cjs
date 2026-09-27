// Draws the Story frame by frame and hands the frames to ffmpeg. Called by story.py.
//   node frames.cjs story.html video.mp4 ffmpeg fps
// Rendered at 60 fps, then each pair of frames is blended into one at 30 fps (motion
// blur for the fast moves), with a little film grain.
const path = require('path');
const { spawn } = require('child_process');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
const [, , html, out, ff, fpsArg] = process.argv;
const fps = Number(fpsArg || 60);
(async () => {
  const b = await pw.chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  const problems = [];
  p.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  p.on('pageerror', (e) => problems.push(e.message));
  p.on('requestfailed', (r) => problems.push('could not load ' + r.url()));
  await p.goto('file://' + path.resolve(html), { waitUntil: 'load' });
  const info = await p.evaluate(() => window.ready());
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  const enc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `tmix=frames=2:weights=1 1,fps=30,noise=c0s=5:c0f=t+u:all_seed=24,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(info.end * fps);
  const started = Date.now();
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => window.render(t), i / fps);
    const jpg = await p.screenshot({ type: 'jpeg', quality: 94 });
    if (!enc.stdin.write(jpg)) await new Promise((r) => enc.stdin.once('drain', r));
    if (i % 120 === 0) process.stderr.write(`frame ${i}/${n} ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
  }
  enc.stdin.end();
  await new Promise((r, j) => enc.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exited ' + c)))));
  await b.close();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
})();
