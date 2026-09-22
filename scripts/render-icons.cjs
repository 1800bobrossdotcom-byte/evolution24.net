// Renders the raster icons and the social share card from the SVG logo.
//   node scripts/render-icons.cjs   (needs Playwright; run after build.py)
// Writes assets/img/{logo-192,logo-512,apple-touch-icon,og}.png and favicon-32.png.
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
const root = path.resolve(__dirname, '..');
const mark = fs.readFileSync(path.join(root, 'assets/img/mark.svg'), 'utf8');
const full = fs.readFileSync(path.join(root, 'assets/img/logo.svg'), 'utf8');
const font = 'file://' + path.join(root, 'assets/fonts/instrument-serif-italic-latin.woff2');
const sans = 'file://' + path.join(root, 'assets/fonts/manrope-latin.woff2');
const square = (size, pad) => `<html><body style="margin:0;background:#151613;width:${size}px;height:${size}px;display:grid;place-items:center">
  <div style="width:${size - pad * 2}px">${mark.replace('<svg ', '<svg style="width:100%;height:auto;display:block" ')}</div></body></html>`;
const og = `<html><head><style>
@font-face{font-family:S;src:url(${font})}@font-face{font-family:M;src:url(${sans})}
body{margin:0;width:1200px;height:630px;background:#151613;color:#e5e6d3;display:grid;grid-template-columns:1fr;place-items:center;font-family:M}
.l{width:620px;margin:0 auto}.t{font:italic 44px/1.2 S;color:#debb92;margin-top:34px;text-align:center}
.r{position:absolute;inset:24px;border:1px solid rgba(229,230,211,.16)}
</style></head><body><div class="r"></div><div><div class="l">${full.replace('<svg ', '<svg style="width:100%;height:auto;display:block" ')}</div>
<div class="t">Apartments in Rochester, Syracuse &amp; Geneva, NY</div></div></body></html>`;
(async () => {
  const b = await pw.chromium.launch();
  const shot = async (html, w, h, out) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const tmp = path.join(require('os').tmpdir(), `e24-render-${w}x${h}.html`);
    fs.writeFileSync(tmp, html); await p.goto('file://' + tmp);
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(root, out) }); await p.close();
  };
  await shot(square(512, 70), 512, 512, 'assets/img/logo-512.png');
  await shot(square(192, 26), 192, 192, 'assets/img/logo-192.png');
  await shot(square(180, 24), 180, 180, 'assets/img/apple-touch-icon.png');
  await shot(square(64, 6), 64, 64, 'assets/img/favicon-64.png');
  await shot(og, 1200, 630, 'assets/img/og.png');
  await b.close();
})();
