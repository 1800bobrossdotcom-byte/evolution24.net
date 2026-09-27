// Renders the pages make.py writes. Called by make.py; not meant to be run by hand.
//   node tools/instagram/render.cjs jobs.json
// jobs.json is a list of {html, png, width, height, scale}. Any console error or failed load
// (a missing font or photo) fails the run, so a broken post is never written.
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }

(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const b = await pw.chromium.launch();
  const problems = [];
  for (const j of jobs) {
    const p = await b.newPage({ viewport: { width: j.width, height: j.height }, deviceScaleFactor: j.scale || 1 });
    p.on('console', (m) => { if (m.type() === 'error') problems.push(`${j.html}: ${m.text()}`); });
    p.on('pageerror', (e) => problems.push(`${j.html}: ${e.message}`));
    p.on('requestfailed', (r) => problems.push(`${j.html}: could not load ${r.url()}`));
    await p.goto('file://' + path.resolve(j.html), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    const missing = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family));
    missing.forEach((f) => problems.push(`${j.html}: font ${f} did not load`));
    await p.screenshot({ path: j.png, clip: { x: 0, y: 0, width: j.width, height: j.height } });
    await p.close();
  }
  await b.close();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
})();
