// Draws the share cards (1200 x 630) that link previews show on Facebook, iMessage, LinkedIn, X.
//   python3 scripts/build.py && node scripts/render-og.cjs && python3 scripts/build.py
// Reads source/og/jobs.json (written by build.py), writes assets/img/og/<name>.jpg. Run it again
// when a cover photo, a name or the number available changes; build.py links a card only once it exists.
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
const root = path.resolve(__dirname, '..');
const jobs = JSON.parse(fs.readFileSync(path.join(root, 'source/og/jobs.json'), 'utf8'));
const url = (p) => 'file://' + path.join(root, p);
const lockup = fs.readFileSync(path.join(root, 'source/logo/lockup.svg'), 'utf8').replace('<svg ', '<svg class="lockup" ');
const card = (j) => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:S;src:url(${url('assets/fonts/instrument-serif-latin.woff2')})}
@font-face{font-family:S;font-style:italic;src:url(${url('assets/fonts/instrument-serif-italic-latin.woff2')})}
@font-face{font-family:M;font-weight:200 800;src:url(${url('assets/fonts/manrope-latin.woff2')})}
*{margin:0}body{width:1200px;height:630px;position:relative;overflow:hidden;background:#151613;font-family:M;color:#eeeadf}
.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.sh{position:absolute;inset:0;background:linear-gradient(90deg,rgba(21,22,19,.94) 0%,rgba(21,22,19,.72) 42%,rgba(21,22,19,.12) 78%),linear-gradient(0deg,rgba(21,22,19,.6),transparent 45%)}
.lockup{position:absolute;left:64px;top:56px;width:300px;height:auto}
.tx{position:absolute;left:64px;bottom:60px;width:720px}
.k{font:700 18px/1 M;letter-spacing:.3em;text-transform:uppercase;color:#debb92;display:flex;align-items:center;gap:16px}
.k::before{content:"";width:40px;height:1px;background:currentColor}
h1{font:400 92px/.95 S;letter-spacing:-.01em;margin-top:22px}h1 em{font-style:italic;color:#debb92}
.s{font:500 24px/1.35 M;color:#cfccbf;margin-top:20px}
.tag{position:absolute;right:56px;top:56px;background:#debb92;color:#151613;font:700 16px/1 M;letter-spacing:.18em;text-transform:uppercase;padding:14px 20px;border-radius:999px}
</style><img class="ph" src="${url(j.photo)}"><div class="sh"></div>${lockup}
<div class="tx"><p class="k">${j.kicker}</p><h1>${j.title}</h1><p class="s">${j.sub}</p></div>${j.tag ? `<p class="tag">${j.tag}</p>` : ''}`;
(async () => {
  fs.mkdirSync(path.join(root, 'assets/img/og'), { recursive: true });
  const b = await pw.chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  for (const j of jobs) {
    const tmp = path.join(require('os').tmpdir(), `e24-og-${j.name}.html`);
    fs.writeFileSync(tmp, card(j));
    await p.goto('file://' + tmp, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(root, `assets/img/og/${j.name}.jpg`), type: 'jpeg', quality: 84 });
  }
  await b.close();
  console.log(`${jobs.length} share cards in assets/img/og/`);
})();
