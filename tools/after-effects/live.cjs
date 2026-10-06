// The website's own logo animations, played in Chromium and stopped at any moment.
// Used by reference.cjs (the reference videos in the kit) and by
// scripts/compare-after-effects.cjs (the After Effects keyframes against the site).
//
// Each comp in the After Effects script is framed as the site is:
//   intro16  the home page's intro in a 1440 x 810 window, at 4/3 pixel density = 1920 x 1080
//   intro9   the same on a 360 x 640 phone, at 3x = 1080 x 1920 (the phone timing)
//   lockup   the header logo's build, 1200 px wide, centred in 1920 x 1080 on ink
// Everything but the logo is hidden, and the page behind the intro's curtain is plain paper,
// the colour the After Effects comps show there.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); }

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.avif': 'image/avif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };

// The header's lockup on a page of its own, from the built home page's markup and stylesheet.
function lockupPage() {
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const defs = /<svg class="logo-defs"[\s\S]*?<\/svg>/.exec(home)[0];
  const lockup = /<a class="brand"[^>]*>(<svg viewBox="0 0 1116 274"[\s\S]*?<\/svg>)<\/a>/.exec(home)[1];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/css/main.css">
<style>html, body { margin: 0; background: #151613; } .stage { position: fixed; inset: 0; display: grid; place-items: center; }
.stage .brand svg { width: 1200px; height: auto; }</style></head>
<body>${defs}<div class="stage"><a class="brand">${lockup}</a></div></body></html>`;
}

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/__lockup.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(lockupPage()); return; }
      let f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

const VIEWS = {
  intro16: { path: '/', viewport: { width: 1440, height: 810 }, scale: 4 / 3 },
  intro9: { path: '/', viewport: { width: 360, height: 640 }, scale: 3 },
  lockup: { path: '/__lockup.html', viewport: { width: 1920, height: 1080 }, scale: 1 },
};

// Hide the page around the intro; paper behind it. With blur false, the letters' blur is off,
// to compare shapes and timing alone.
const introCss = (blur) => `body > *:not(.intro):not(.logo-defs) { visibility: hidden !important; }
html, body { background: #f4f1ea !important; }${blur ? '' : '\n.intro .lg-word { filter: none !important; }'}`;

/** A page playing one of the site's logo animations, stopped; seek(t) moves it to t seconds. */
async function open(browser, key, { blur = true } = {}) {
  const v = VIEWS[key];
  const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.scale, reducedMotion: 'no-preference', bypassCSP: true });
  const page = await ctx.newPage();
  // The page's own timers stand still (its script ends the intro 3.6 s in, whatever the frame).
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T12:00:01Z'));
  await page.goto(`http://127.0.0.1:${open.port}${v.path}`);
  await page.evaluate(() => document.fonts.ready);
  if (key !== 'lockup') {
    const isIntro = await page.evaluate(() => document.documentElement.classList.contains('is-intro'));
    if (!isIntro) throw new Error('the intro did not start (it plays once per visit, on the home page)');
    await page.addStyleTag({ content: introCss(blur) });
    // Seeking back across the curtain's start fires animationend, on which the site's script
    // removes the intro for good; keep that event from reaching it while we scrub.
    await page.evaluate(() => window.addEventListener('animationend', (e) => e.stopPropagation(), true));
  }
  // Chrome draws the logo's <svg> at whole CSS pixels; how far that moves it, in frame pixels.
  const snap = await page.evaluate((key) => {
    const r = document.querySelector(key === 'lockup' ? '.stage .brand svg' : '.intro svg').getBoundingClientRect();
    return { dx: (Math.round(r.x) - r.x) * devicePixelRatio, dy: (Math.round(r.y) - r.y) * devicePixelRatio };
  }, key);
  const seek = async (t) => {
    await page.evaluate((ms) => {
      document.getAnimations().filter((a) => a.timeline === document.timeline).forEach((a) => { a.pause(); a.currentTime = ms; });
    }, t * 1000);
    return page.screenshot({ type: 'png' });
  };
  return { page, seek, snap, close: () => ctx.close() };
}

async function start() {
  const server = await serve();
  open.port = server.address().port;
  const browser = await pw.chromium.launch();
  return { browser, stop: async () => { await browser.close(); server.close(); } };
}

module.exports = { start, open, VIEWS, pw };
