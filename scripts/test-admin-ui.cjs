// Drives the analytics dashboard (/admin/) in Chromium against a stand-in for the admin API.
//   node scripts/test-admin-ui.cjs
//   SHOTS=/some/dir node scripts/test-admin-ui.cjs   # where the screenshots go
// A local server serves admin/ and assets/ from the repo under the site's CSP (no inline script
// or style) and answers the API routes with made-up people (example.com addresses only). It checks
// the sign-in flow, that every panel renders, the Building filter, the enquiry buttons, that no
// console error or CSP violation happens, and that nothing scrolls sideways at 360px wide.
// API paths must end in a slash (the site runs with trailingSlash); one without fails the run.
// No dependencies beyond Playwright (Chromium is preinstalled; never run "playwright install").
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'e24-admin-ui');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'";
const PASSWORD = 'correct horse';
const COOKIE = 'e24_admin';

let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')); }

/* ---- Made-up data ------------------------------------------------------------------------ */
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'api', 'leads-config.json'), 'utf8'));
const BUILDINGS = [
  ['water-street', 'Water Street', 'Rochester'], ['biltmore', 'The Biltmore', 'Rochester'],
  ['145-south-fitzhugh-street', '145 South Fitzhugh', 'Rochester'], ['301-central-avenue', '301 Central Avenue', 'Rochester'],
  ['181-st-paul-street', '181 St. Paul', 'Rochester'], ['charlotte-square', 'Charlotte Square', 'Rochester'],
  ['2215-james-street', '2215 James Street', 'Syracuse'], ['121-park-drive', '121 Park Drive', 'Manlius'],
  ['379-south-main-street', '379 South Main', 'Geneva'], ['561-south-main-street', '561 South Main', 'Geneva'],
  ['31-genesee-street', '31 Genesee Street', 'Geneva'],
];
const NAME = Object.fromEntries(BUILDINGS.map(([s, n]) => [s, n]));
const isoDay = (d) => d.toISOString().slice(0, 10);
const now = () => Math.floor(Date.now() / 1000);

function stats(days, ai) {
  const today = new Date();
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const pageviews = Math.round((weekend ? 95 : 160) * (1 + 0.3 * Math.sin(i / 6)) + ((i * 37) % 23));
    const leads = i % 11 === 0 ? 3 : i % 4 === 0 ? 1 : i % 7 === 2 ? 2 : 0;
    daily.push({ day: isoDay(d), pageviews, visits: Math.round(pageviews * 0.46), leads });
  }
  const sum = (k) => daily.reduce((a, r) => a + r[k], 0);
  const k = days / 30;
  const properties = BUILDINGS.map(([slug, name, city], i) => {
    const quiet = slug === '31-genesee-street';   // one building nobody looked at
    const views = quiet ? 0 : Math.round((640 - i * 52) * k * (slug === 'charlotte-square' ? 0.2 : 1));
    const visits = Math.round(views * 0.55);
    const leads = quiet ? 0 : Math.max(0, Math.round((9 - i) * k * (i % 3 === 1 ? 0.4 : 1)));
    return { slug, name, city, views, visits, phone_clicks: Math.round(visits * 0.04), apply_clicks: Math.round(visits * 0.03), leads,
      rate: visits ? Math.round((leads / visits) * 1000) / 10 : 0 };
  }).sort((a, b) => b.leads - a.leads || b.views - a.views);
  const pv = sum('pageviews');
  const leads = sum('leads');
  return {
    range: { from: daily[0].day, to: daily[daily.length - 1].day, days },
    totals: { pageviews: pv, visits: sum('visits'), leads, phone_clicks: Math.round(42 * k), portal_clicks: Math.round(118 * k),
      apply_clicks: Math.round(57 * k), email_clicks: Math.round(9 * k), lead_rate: Math.round((leads / pv) * 1000) / 10 },
    funnel: { visitors: sum('visits'), starts: Math.round(leads * 2.6), leads },
    daily,
    properties,
    units: [
      { property: 'water-street', unit: '204', clicks: 14 }, { property: 'water-street', unit: '311', clicks: 9 },
      { property: 'biltmore', unit: '5C', clicks: 7 }, { property: '121-park-drive', unit: 'Apt 2 (upper)', clicks: 4 },
      { property: '145-south-fitzhugh-street', unit: '602', clicks: 3 },
    ],
    plans: [{ plan: '1 bedroom', count: 88 }, { plan: 'Studio', count: 41 }, { plan: '2 bedroom', count: 37 }, { plan: '3 bedroom', count: 6 }],
    events: [
      { kind: 'filter', count: 212 }, { kind: 'gallery_open', count: 180 }, { kind: 'portal_click', count: 118 },
      { kind: 'apply_click', count: 57 }, { kind: 'phone_click', count: 42 }, { kind: 'form_start', count: 39 },
      { kind: 'map_click', count: 22 }, { kind: 'outbound', count: 15 }, { kind: 'email_click', count: 9 },
    ],
    availability: { as_of: isoDay(today), open: 19 },
    pages: [
      { path: '/', views: 1410, visits: 820 }, { path: '/properties/', views: 690, visits: 400 },
      { path: '/properties/water-street/', views: 640, visits: 352 }, { path: '/apartments/rochester-ny/', views: 300, visits: 210 },
      { path: '/contact-us/', views: 160, visits: 120 },
    ],
    referrers: [{ ref: 'direct', views: 1600 }, { ref: 'google.com', views: 1220 }, { ref: 'zillow.com', views: 310 }, { ref: 'facebook.com', views: 140 }],
    sources: [
      { channel: 'google.com', visits: 540, leads: 9, rate: 1.7 }, { channel: 'direct', visits: 610, leads: 6, rate: 1 },
      { channel: 'zillow / listing', visits: 120, leads: 4, rate: 3.3 }, { channel: 'facebook / paid_social', visits: 95, leads: 1, rate: 1.1 },
    ],
    campaigns: [{ campaign: 'fall-lease-2026', visits: 120, leads: 4, rate: 3.3 }, { campaign: 'yard-sign-geneva', visits: 18, leads: 1, rate: 5.6 }],
    asked: { interests: [{ interest: 'tour', count: 11 }, { interest: 'availability', count: 7 }, { interest: 'question', count: 3 }], topics: [] },
    countries: [{ country: 'US', views: 3100 }, { country: 'CA', views: 64 }, { country: '—', views: 12 }],
    devices: [{ device: 'mobile', views: 2050 }, { device: 'desktop', views: 1120 }, { device: 'tablet', views: 60 }],
    emails: {
      confirmations: { sent: 21, delivered: 20, bounced: 1, complained: 0, opened: 0, clicked: 0, held_unsubscribed: 1, held_recent: 0, failed: 0 },
      notifications: { enquiries: 22, reached: 21, bounced: 0 }, unsubscribes: 1, tracking: true,
    },
    ai,
  };
}

function freshLeads() {
  const t = now();
  const base = { country: 'US', notified: 1, handled: 0, form: 'property', utm_source: null, utm_medium: null, utm_campaign: null,
    referrer: null, landing: null, ai: null, ai_err: null, unsubscribed_at: null, confirm_ok: 1, confirm_note: null,
    confirm_status: 'delivered', sheet_ok: 1, sheet_note: null, rm_ok: null, rm_note: null, unit: null, message: '' };
  return [
    { ...base, id: 6, ts: t - 300, ref: 'E24-261019-AB3K', property: 'water-street', property_name: 'Water Street',
      first_name: 'Alex', last_name: 'Test', email: 'alex.test@example.com', phone: '(585) 555-0100', interest: 'tour', bedrooms: '1',
      unit: '204', move_in: '2026-11', source: 'search', page: '/properties/water-street/', utm_source: 'zillow', utm_medium: 'listing',
      utm_campaign: 'fall-lease-2026', message: 'Hi <b>there</b>, is 204 still open?\nI work nights, so mornings suit me.',
      ai: { summary: 'Wants a morning tour of unit 204 at Water Street, moving in November.', topics: ['tour', 'availability'], spam: false,
        reply: 'Hi Alex,\n\nThanks for asking about 204. It is still open...' } },
    { ...base, id: 5, ts: t - 3 * 3600, ref: 'E24-261019-C7QP', property: 'biltmore', property_name: 'The Biltmore',
      first_name: 'Sam', last_name: 'Example', email: 'sam@example.com', phone: '', interest: 'availability', bedrooms: 'studio',
      move_in: 'asap', source: 'listing', page: '/properties/biltmore/', notified: 0, sheet_ok: 0, sheet_note: 'The sheet did not answer.',
      message: 'Do you take cats?' },
    { ...base, id: 4, ts: t - 26 * 3600, ref: 'E24-261018-M2ZD', property: '', property_name: 'General', form: 'contact',
      first_name: 'Jordan', last_name: 'Sample', email: 'jordan.sample@example.com', phone: '315-555-0123', interest: 'question',
      bedrooms: null, move_in: null, source: 'referral', page: '/contact-us/', referrer: 'google.com', confirm_ok: null, confirm_status: null,
      message: 'A long question with a pasted link that must not widen the card: https://example.com/a/really/long/path/that/keeps/going/and/going/forever?with=lots&of=params' },
    { ...base, id: 3, ts: t - 4 * 86400, ref: 'E24-261015-R8TW', property: '121-park-drive', property_name: '121 Park Drive',
      first_name: 'Casey', last_name: 'Demo', email: 'casey.demo@example.com', phone: '(315) 555-0199', interest: 'apply', bedrooms: '2',
      unit: '2B', move_in: '1-2', source: 'drive', page: '/properties/121-park-drive/', rm_ok: 0, rm_note: 'Rent Manager said the prospect already exists.' },
    { ...base, id: 2, ts: t - 9 * 86400, ref: 'E24-261010-K4HN', property: '561-south-main-street', property_name: '561 South Main',
      first_name: 'Morgan', last_name: 'Fake', email: 'morgan.fake@example.com', phone: '', interest: 'waitlist', bedrooms: 'any',
      move_in: 'browsing', source: 'social', page: '/properties/561-south-main-street/', unsubscribed_at: t - 2 * 86400,
      confirm_ok: 0, confirm_note: 'held: unsubscribed' },
    { ...base, id: 1, ts: t - 12 * 86400, ref: 'E24-261007-P9XB', property: 'water-street', property_name: 'Water Street',
      first_name: 'Riley', last_name: 'Placeholder', email: 'riley@example.com', phone: '585-555-0142', interest: 'tour', bedrooms: '3',
      move_in: 'later', source: 'search', page: '/properties/water-street/', handled: 1 },
  ];
}

/* ---- The stand-in server ----------------------------------------------------------------- */
const S = { ai: true, rm: true, sheet: true, login: 'ok', leads: freshLeads(), reports: [], requests: [], badPaths: [], sessions: true };
const resetState = (over = {}) => Object.assign(S, { ai: true, rm: true, sheet: true, login: 'ok', leads: freshLeads(), sessions: true, requests: [],
  reports: [{ token: 'tok_aaaaaaaaaaaaaaaaaaaa', period: 'week', from_day: '2026-10-05', to_day: '2026-10-11', partial: 0,
    label: 'Weekly · October 5–11, 2026', ts: now() - 86400 }] }, over);

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function serveFile(res, file) {
  const real = path.resolve(ROOT, file);
  if (!real.startsWith(ROOT + path.sep) || !fs.existsSync(real) || !fs.statSync(real).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Content-Security-Policy': CSP }); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(real)] || 'application/octet-stream', 'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  fs.createReadStream(real).pipe(res);
}

const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({ bad: b }); } });
});

async function handleApi(req, res, url) {
  const send = (status, data, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data));
  };
  const route = url.pathname;
  const body = req.method === 'POST' ? await readBody(req) : null;
  S.requests.push({ method: req.method, path: route, query: Object.fromEntries(url.searchParams), body });

  if (!route.endsWith('/')) {   // Vercel's trailingSlash would redirect this, and a POST would not survive it
    S.badPaths.push(`${req.method} ${route}${url.search}`);
    return send(404, { error: `No trailing slash: ${route}` });
  }
  if (route === '/api/login/' && req.method === 'POST') {
    if (S.login === '503') return send(503, { error: 'Admin access is not configured on this deployment.' });
    if (S.login === '429') return send(429, { error: 'Too many attempts. Try again in a few minutes.' }, { 'Retry-After': '900' });
    if (body.password !== PASSWORD) return send(401, { error: 'That password is not right.' });
    return send(200, { ok: true }, { 'Set-Cookie': `${COOKIE}=1; Path=/; HttpOnly; SameSite=Strict` });
  }
  if (route === '/api/logout/' && req.method === 'POST') {
    return send(200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
  }
  const signedIn = S.sessions && (req.headers.cookie || '').split(/;\s*/).includes(`${COOKIE}=1`);
  if (!signedIn) return send(401, { error: 'Not signed in.' });

  if (route === '/api/stats/' && req.method === 'GET') {
    const days = Number(url.searchParams.get('days'));
    if (!Number.isInteger(days) || days < 1 || days > 365) return send(400, { error: 'Bad days.' });
    return send(200, stats(days, S.ai));
  }
  if (route === '/api/inquiries/' && req.method === 'GET') {
    const all = url.searchParams.get('all') === '1';
    const prop = url.searchParams.get('property') || '';
    const limit = Math.min(200, Number(url.searchParams.get('limit')) || 50);
    const list = S.leads.filter((r) => (all || !r.handled) && (!prop || r.property === prop)).slice(0, limit);
    return send(200, {
      inquiries: list, total: S.leads.length, open: S.leads.filter((r) => !r.handled).length,
      unnotified: S.leads.filter((r) => !r.notified && !r.handled).length,
      lastError: 'RESEND_API_KEY is not set on this deployment.', ai: S.ai, sheet: S.sheet, rm: S.rm,
      labels: { interest: CONFIG.interest, bedrooms: CONFIG.bedrooms, move_in: CONFIG.move_in, source: CONFIG.source },
      properties: Object.fromEntries(BUILDINGS.map(([s, n]) => [s, n])),
    });
  }
  if (route === '/api/inquiries/' && req.method === 'POST') {
    const r = S.leads.find((x) => x.id === Number(body.id));
    if (!r) return send(404, { error: 'No such enquiry.' });
    if (body.notify) return send(502, { ok: false, id: r.id, error: 'RESEND_API_KEY is not set on this deployment.' });
    if (body.confirm) { r.confirm_ok = 1; r.confirm_status = null; return send(200, { ok: true, id: r.id }); }
    if (body.sheet) { r.sheet_ok = 1; return send(200, { ok: true, id: r.id }); }
    if (body.rentmanager) { r.rm_ok = 1; r.rm_note = 'prospect 4411'; return send(200, { ok: true, id: r.id }); }
    if ('handled' in body) { r.handled = body.handled ? 1 : 0; return send(200, { ok: true, id: r.id, handled: r.handled }); }
    return send(400, { error: 'What should change?' });
  }
  if (route === '/api/reports/') {
    if (req.method === 'GET') return send(200, { reports: S.reports.map((r) => ({ ...r, url: `http://${req.headers.host}/r/${r.token}/` })) });
    if (req.method === 'POST') {
      if (!['day', 'week', 'month'].includes(body.period) || !/^\d{4}-\d{2}-\d{2}$/.test(body.day || '')) return send(400, { error: 'Which period?' });
      const token = `tok_${String(S.reports.length).padStart(20, 'b')}`;
      const label = `Weekly · week of ${body.day}`;
      S.reports.unshift({ token, period: body.period, from_day: body.day, to_day: body.day, partial: 0, label, ts: now() });
      return send(200, { token, url: `http://${req.headers.host}/r/${token}/`, label, summaryNote: null });
    }
    if (req.method === 'DELETE') {
      S.reports = S.reports.filter((r) => r.token !== url.searchParams.get('token'));
      return send(200, { ok: true });
    }
  }
  if (route === '/api/insights/') {
    if (req.method === 'GET') {
      return send(200, { ai: S.ai, insight: S.ai ? { headline: 'Water Street drew a third of all visits, and most of the enquiries came from search.',
        points: [{ title: 'Search is working.', detail: 'Visitors from Google enquired at 1.7%.' }, { title: 'Geneva is quiet.', detail: 'Three buildings had no enquiries.' }],
        next: ['Tag the Geneva yard signs with a tracking link.'], ts: now() - 1800 } : null });
    }
    if (req.method === 'POST') return send(200, { insight: { headline: 'Fresh read.', points: [], next: [], ts: now() } });
  }
  if (route === '/api/triage/' && req.method === 'POST') {
    const r = S.leads.find((x) => x.id === Number(body.id));
    if (r) r.ai = { summary: 'Summarised.', topics: ['other'], spam: false, reply: 'Hi' };
    return send(200, { ok: true });
  }
  return send(404, { error: `No route ${req.method} ${route}` });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) { handleApi(req, res, url).catch((e) => { res.writeHead(500); res.end(String(e)); }); return; }
  if (url.pathname === '/admin/') return serveFile(res, 'admin/index.html');
  if (url.pathname === '/favicon.svg') return serveFile(res, 'favicon.svg');
  if (url.pathname.startsWith('/assets/')) return serveFile(res, decodeURIComponent(url.pathname.slice(1)));
  if (url.pathname.startsWith('/properties/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>stub</title>'); return; }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
});

/* ---- The browser ------------------------------------------------------------------------- */
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(SHOTS, { recursive: true });

  let browser;
  try { browser = await pw.chromium.launch(); } catch { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }

  // Console errors and CSP violations from every page, wherever they happen. A failed
  // request the test provokes on purpose (401 before sign-in, 502 from Send email…) is
  // logged by Chromium as "Failed to load resource"; those are expected for /api/ only.
  const problems = [];
  const EXPECTED = /Failed to load resource: the server responded with a status of (401|429|502|503)/;
  async function newPage(opts = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || 'inline'} at ${e.sourceFile}:${e.lineNumber}`);
      });
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() !== 'error' && !/Content Security Policy|CSP violation/i.test(msg.text())) return;
      const where = (msg.location() && msg.location().url) || '';
      if (EXPECTED.test(msg.text()) && where.includes('/api/')) return;
      problems.push(`${msg.text()} (${where})`);
    });
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    return page;
  }

  const results = [];
  const test = async (name, fn) => {
    try { await fn(); results.push(['ok  ', name]); } catch (e) { results.push(['FAIL', `${name}: ${String(e.message).split('\n')[0]}`]); }
  };
  const last = (pred) => [...S.requests].reverse().find(pred);
  const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
  const rowsIn = (page, sel) => page.$$eval(`${sel} tbody tr`, (els) => els.length);
  /** Nothing wider than the window, and nothing poking out past its edge except inside a
   *  panel's own sideways scroller. */
  const overflow = (page) => page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    if (document.documentElement.scrollWidth > vw) out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${vw}px window`);
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 0.5 && r.left >= -0.5) continue;
      if (el.closest('.tbl-wrap')) continue;
      out.push(`${el.tagName.toLowerCase()}.${el.className || ''} spans ${Math.round(r.left)}–${Math.round(r.right)}`);
    }
    return out.slice(0, 5);
  });

  resetState();
  const page = await newPage();

  await test('the page carries noindex and loads only its own files', async () => {
    const res = await page.goto(`${BASE}/admin/`);
    assert.strictEqual(res.headers()['content-security-policy'], CSP);
    assert.strictEqual(await page.getAttribute('meta[name="robots"]', 'content'), 'noindex, nofollow');
    const html = fs.readFileSync(path.join(ROOT, 'admin', 'index.html'), 'utf8');
    assert.ok(!/<style|\sstyle=|\son[a-z]+=|<script(?![^>]*\bsrc=)/i.test(html), 'no inline style, script or handler in the HTML');
    const js = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
    assert.ok(!/\.innerHTML\b|insertAdjacentHTML|\.outerHTML\b|setAttribute\(\s*['"]style/.test(js), 'no innerHTML or style attribute in the script');
  });

  await test('without a session /api/stats/ answers 401 and the sign-in form shows', async () => {
    await page.waitForSelector('#signin:not([hidden])');
    assert.ok(await page.isHidden('#app'), 'dashboard stays hidden');
    assert.ok(last((r) => r.path === '/api/stats/'), 'asked for the numbers first');
    assert.strictEqual(await page.title(), 'Sign in · Evolution24 Properties');
  });

  await test('a wrong password shows the server’s sentence', async () => {
    await page.fill('#password', 'nope');
    await page.click('#signin-form button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#signin-msg').textContent.length > 0);
    assert.strictEqual(await page.textContent('#signin-msg'), 'That password is not right.');
    assert.ok(await page.isHidden('#app'));
  });

  await test('503 and 429 from /api/login/ are shown as the server words them', async () => {
    S.login = '503';
    await page.fill('#password', PASSWORD);
    await page.click('#signin-form button[type="submit"]');
    await page.waitForFunction(() => /not configured/.test(document.querySelector('#signin-msg').textContent));
    S.login = '429';
    await page.click('#signin-form button[type="submit"]');
    await page.waitForFunction(() => /Too many attempts/.test(document.querySelector('#signin-msg').textContent));
    S.login = 'ok';
  });

  await page.setViewportSize({ width: 360, height: 760 });
  await page.screenshot({ path: path.join(SHOTS, 'signin-phone.png') });
  await test('the sign-in form fits a 360px phone', async () => {
    assert.deepStrictEqual(await overflow(page), []);
  });
  await page.setViewportSize({ width: 1280, height: 900 });

  await test('the right password signs in and the dashboard loads', async () => {
    await page.fill('#password', PASSWORD);
    await page.click('#signin-form button[type="submit"]');
    await page.waitForSelector('#app:not([hidden])');
    await page.waitForSelector('#tiles .tile');
    await page.waitForSelector('#leads .lead');
    assert.ok(await page.isHidden('#signin'));
    assert.strictEqual(await page.inputValue('#password'), '', 'password field cleared');
    assert.ok(last((r) => r.path === '/api/stats/' && r.query.days === '30'));
  });

  await test('seven tiles, with Apply clicks and resident portal visits', async () => {
    const keys = await texts(page, '.tile__k');
    assert.deepStrictEqual(keys, ['Pageviews', 'Visitors', 'Enquiries', 'Enquiry rate', 'Phone taps', 'Apply clicks', 'Resident portal']);
    const values = await texts(page, '.tile__v');
    assert.ok(values.every((v) => /\d/.test(v)), `every tile has a number: ${values}`);
  });

  await test('the Rent Manager availability line', async () => {
    const t = await page.textContent('#avail');
    assert.match(t, /^Availability from Rent Manager: 19 homes open, as of \d{1,2} [A-Z][a-z]+\.$/);
  });

  await test('By building lists all eleven, linked, with a bar each', async () => {
    assert.strictEqual(await rowsIn(page, '#t-buildings'), 11);
    const first = await page.$eval('#t-buildings tbody tr', (tr) => ({
      name: tr.querySelector('.name').textContent, href: tr.querySelector('a.name').getAttribute('href'),
      w: tr.querySelector('.meter').style.getPropertyValue('--w'), cells: tr.querySelectorAll('td').length,
    }));
    assert.strictEqual(first.name, 'Water Street');
    assert.strictEqual(first.href, '/properties/water-street/');
    assert.strictEqual(first.w, '100%');
    assert.strictEqual(first.cells, 7);
    assert.ok(await page.$('#t-buildings tr.is-quiet'), 'a building with no traffic is muted');
  });

  await test('both charts draw, with a readout on hover', async () => {
    assert.strictEqual(await page.$$eval('#chart-traffic .series-line', (e) => e.length), 2);
    assert.ok((await page.$$eval('#chart-leads .bar', (e) => e.length)) > 5);
    await page.$eval('#chart-traffic', (el) => el.scrollIntoView({ block: 'center' }));
    const box = await page.$eval('#chart-traffic svg', (s) => { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
    await page.waitForSelector('#chart-traffic .tip:not([hidden])');
    assert.match(await page.textContent('#chart-traffic .tip'), /pageviews.*visitors/);
    await page.mouse.move(0, 0);
    assert.ok((await rowsIn(page, '#t-daily')) === 30, 'a table of the days');
  });

  await test('every other panel renders rows', async () => {
    for (const [sel, n] of [['#t-units', 5], ['#t-plans', 4], ['#t-sources', 4], ['#t-campaigns', 2], ['#t-funnel', 3], ['#t-asked', 3],
      ['#t-pages', 5], ['#t-referrers', 4], ['#t-events', 9], ['#t-devices', 3], ['#t-countries', 3]]) {
      assert.strictEqual(await rowsIn(page, sel), n, sel);
    }
    assert.ok((await rowsIn(page, '#t-emails')) >= 5);
    const units = await texts(page, '#t-units .name');
    assert.strictEqual(units[0], 'Water Street · Unit 204');
    assert.strictEqual(units[3], '121 Park Drive · Apt 2 (upper)');
    const events = await texts(page, '#t-events .name');
    assert.ok(events.includes('Clicked Apply on a home') && events.includes('Filtered the homes') && events.includes('Tapped the email address'), events.join());
    assert.ok((await texts(page, '#t-asked .name')).includes('Booking a tour'), 'reasons in words, from the labels');
    assert.ok((await texts(page, '#t-countries .name')).includes('United States'));
    assert.ok((await texts(page, '#t-referrers .name')).includes('Typed in or bookmarked'));
  });

  await test('Claude’s read shows when ai is on', async () => {
    await page.waitForSelector('#insight-panel:not([hidden]) .insight__headline');
    assert.match(await page.textContent('#insight-ask'), /Ask again/);
  });

  await test('reports list, and Create report posts {period, day}', async () => {
    assert.strictEqual(await page.$$eval('#report-list li', (e) => e.length), 1);
    await page.click('#report-make');
    await page.waitForFunction(() => /^Ready:/.test(document.querySelector('#report-status').textContent));
    const r = last((x) => x.path === '/api/reports/' && x.method === 'POST');
    assert.strictEqual(r.body.period, 'week');
    assert.match(r.body.day, /^\d{4}-\d{2}-\d{2}$/);
    await page.waitForFunction(() => document.querySelectorAll('#report-list li').length === 2);
  });

  await test('enquiry cards: building, number, words for the codes, their text as text', async () => {
    const card = await page.$eval('#leads .lead', (c) => ({
      bldg: c.querySelector('.lead__bldg').textContent, ref: c.querySelector('.lead__ref').textContent,
      who: c.querySelector('.lead__who').textContent, tag: c.querySelector('.lead__tag').textContent,
      meta: c.querySelector('.lead__meta').textContent, msg: c.querySelector('.lead__msg').textContent,
      bold: c.querySelectorAll('.lead__msg b').length, via: [...c.querySelectorAll('.lead__via')].map((p) => p.textContent),
      mail: c.querySelector('.lead__contact a').getAttribute('href'),
    }));
    assert.strictEqual(card.bldg, 'Water Street · Unit 204');
    assert.strictEqual(card.ref, 'E24-261019-AB3K');
    assert.strictEqual(card.who, 'Alex Test');
    assert.strictEqual(card.tag, 'Booking a tour');
    assert.strictEqual(card.meta, 'Size: 1 bedroom · Move-in: November 2026 · Found us: Search');
    assert.ok(card.msg.includes('<b>there</b>') && card.bold === 0, 'the message is text, never markup');
    assert.ok(card.via.includes('In the lead sheet.') && card.via.includes('Not in Rent Manager yet.'), card.via.join(' | '));
    assert.ok(card.via.some((v) => v === 'Sent from /properties/water-street/, came via zillow / listing · fall-lease-2026'), card.via.join(' | '));
    assert.strictEqual(card.mail, 'mailto:alex.test%40example.com');
    const casey = await page.$eval('#leads .lead:nth-child(4)', (c) => c.textContent);
    assert.ok(casey.includes('Move-in: In 1–2 months') && casey.includes('Not in Rent Manager: Rent Manager said the prospect already exists.'));
    assert.ok(await page.isVisible('#lead-warn'), 'the unsent-email banner shows');
    assert.match(await page.textContent('#lead-warn'), /RESEND_API_KEY is not set.*Vercel/);
  });

  await test('the Building filter asks again for that building', async () => {
    const opts = await page.$$eval('#lead-property option', (o) => o.map((x) => x.value));
    assert.strictEqual(opts.length, 12, 'All buildings plus eleven');
    await page.selectOption('#lead-property', 'water-street');
    await page.waitForFunction(() => document.querySelectorAll('#leads .lead').length === 1);
    const r = last((x) => x.path === '/api/inquiries/' && x.method === 'GET');
    assert.strictEqual(r.query.property, 'water-street');
    assert.match(await page.textContent('#lead-count'), /for Water Street/);
    await page.click('.seg [data-leads="all"]');
    await page.waitForFunction(() => document.querySelectorAll('#leads .lead').length === 2);
    const r2 = last((x) => x.path === '/api/inquiries/' && x.method === 'GET');
    assert.strictEqual(r2.query.all, '1');
    assert.strictEqual(r2.query.property, 'water-street');
    await page.click('.seg [data-leads="open"]');
    await page.selectOption('#lead-property', '');
    await page.waitForFunction(() => document.querySelectorAll('#leads .lead').length === 5);
    assert.strictEqual(last((x) => x.path === '/api/inquiries/' && x.method === 'GET').query.property, undefined);
  });

  await test('Add to Rent Manager posts {id, rentmanager: true}', async () => {
    await page.click('#leads .lead:first-child button:text("Add to Rent Manager")');
    await page.waitForFunction(() => /In Rent Manager: prospect 4411/.test(document.querySelector('#leads .lead').textContent));
    const r = last((x) => x.path === '/api/inquiries/' && x.method === 'POST');
    assert.deepStrictEqual(r.body, { id: 6, rentmanager: true });
  });

  await test('Send email shows why it failed, and what to change in Vercel', async () => {
    const sam = page.locator('#leads .lead', { hasText: 'Sam Example' });
    await sam.locator('button', { hasText: 'Send email' }).click();
    await sam.locator('.lead__aierr').waitFor();
    assert.match(await sam.locator('.lead__aierr').textContent(), /^Not sent\. RESEND_API_KEY is not set on this deployment\. In Vercel/);
    assert.deepStrictEqual(last((x) => x.method === 'POST' && x.path === '/api/inquiries/').body, { id: 5, notify: true });
  });

  await test('Mark handled posts and the card leaves the open list', async () => {
    const sam = page.locator('#leads .lead', { hasText: 'Sam Example' });
    await sam.locator('button', { hasText: 'Mark handled' }).click();
    await page.waitForFunction(() => !/Sam Example/.test(document.querySelector('#leads').textContent));
    assert.deepStrictEqual(last((x) => x.method === 'POST' && x.path === '/api/inquiries/').body, { id: 5, handled: 1 });
  });

  await test('a tracking link for a building page', async () => {
    await page.selectOption('#builder-page', '/properties/water-street/');
    await page.fill('#builder [name="source"]', 'zillow');
    await page.selectOption('#builder [name="medium"]', 'listing');
    await page.fill('#builder [name="campaign"]', 'Fall Lease');
    assert.strictEqual(await page.inputValue('#builder-url'),
      'https://evolution24.net/properties/water-street/?utm_source=zillow&utm_medium=listing&utm_campaign=fall-lease');
    const pages = await page.$$eval('#builder-page option', (o) => o.map((x) => x.value));
    for (const p of ['/', '/properties/', '/contact-us/', '/apartments/rochester-ny/', '/apartments/syracuse-ny/', '/apartments/geneva-ny/']) assert.ok(pages.includes(p), p);
    assert.strictEqual(pages.filter((p) => /^\/properties\/[a-z0-9-]+\/$/.test(p)).length, 11);
    const sources = await page.$$eval('#builder-sources option', (o) => o.map((x) => x.value));
    for (const s of ['zillow', 'apartments.com', 'facebook-marketplace', 'yard-sign']) assert.ok(sources.includes(s), s);
  });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: path.join(SHOTS, 'desktop-light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(SHOTS, 'desktop-dark.png'), fullPage: true });
  await test('dark mode has its own surface and series colours', async () => {
    const c = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, s1: getComputedStyle(document.documentElement).getPropertyValue('--s1').trim() }));
    assert.strictEqual(c.bg, 'rgb(21, 22, 19)');
    assert.strictEqual(c.s1, '#bc8442');
  });
  await page.emulateMedia({ colorScheme: 'light' });

  await test('a year of numbers draws by week', async () => {
    await page.click('.seg [data-days="365"]');
    await page.waitForFunction(() => /by week/.test(document.querySelector('#lead-note').textContent));
    assert.ok(last((x) => x.path === '/api/stats/' && x.query.days === '365'));
    const bars = await page.$$eval('#chart-leads .bar', (e) => e.length);
    assert.ok(bars > 20 && bars <= 54, `${bars} weekly bars`);
    await page.click('.seg [data-days="7"]');
    await page.waitForFunction(() => document.querySelectorAll('#t-daily tbody tr').length === 7);
    assert.ok(last((x) => x.path === '/api/stats/' && x.query.days === '7'));
  });

  await test('nothing scrolls sideways at 360px, with every panel open', async () => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.click('.seg [data-days="30"]');
    await page.waitForFunction(() => document.querySelectorAll('#t-daily tbody tr').length === 30);
    await page.click('.seg [data-leads="all"]');
    await page.waitForFunction(() => document.querySelectorAll('#leads .lead').length === 6);
    await page.$$eval('details', (d) => d.forEach((x) => { x.open = true; }));
    await page.waitForTimeout(250);   // charts redraw after a resize
    assert.deepStrictEqual(await overflow(page), []);
    const scrollers = await page.$$eval('.tbl-wrap', (w) => w.filter((x) => x.scrollWidth > x.clientWidth + 1)
      .map((x) => x.parentElement.id || x.closest('.panel').querySelector('h2').textContent));
    assert.deepStrictEqual(scrollers, [], `tables that scroll sideways inside their panel: ${scrollers.join(', ')}`);
    const blocks = await page.$eval('#t-buildings tbody tr', (tr) => getComputedStyle(tr).display);
    assert.strictEqual(blocks, 'grid', 'building rows become blocks on a phone');
    await page.$$eval('details', (d) => d.forEach((x) => { x.open = false; }));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, 'phone.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: path.join(SHOTS, 'phone-dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await test('a session that runs out mid-use returns to the form', async () => {
    S.sessions = false;
    await page.click('.seg [data-days="90"]');
    await page.waitForSelector('#signin:not([hidden])');
    assert.match(await page.textContent('#signin-msg'), /session has ended/);
    assert.strictEqual(await page.$$eval('#leads .lead', (e) => e.length), 0, 'their details are taken off the page');
    S.sessions = true;
    await page.fill('#password', PASSWORD);
    await page.click('#signin-form button[type="submit"]');
    await page.waitForSelector('#leads .lead');
    assert.ok(last((x) => x.path === '/api/stats/' && x.query.days === '90'), 'carries on with the range chosen');
  });

  await test('Sign out posts to /api/logout/ and shows the form', async () => {
    await page.click('#signout');
    await page.waitForSelector('#signin:not([hidden])');
    assert.ok(last((x) => x.path === '/api/logout/' && x.method === 'POST'));
    assert.strictEqual(await page.textContent('#signin-msg'), 'Signed out.');
  });
  await page.context().close();

  // With Claude and Rent Manager off, none of their controls appear.
  resetState({ ai: false, rm: false, sheet: false });
  const off = await newPage({ storageState: undefined });
  await off.context().addCookies([{ name: COOKIE, value: '1', url: BASE }]);
  await test('with ai, Rent Manager and the sheet off, their controls stay hidden', async () => {
    await off.goto(`${BASE}/admin/`);
    await off.waitForSelector('#leads .lead');
    await off.waitForTimeout(200);
    assert.ok(await off.isHidden('#insight-panel'), 'no Claude panel');
    const buttons = await texts(off, '#leads button');
    assert.ok(!buttons.some((b) => /Claude|Rent Manager|sheet/.test(b)), buttons.join());
    assert.ok(!(await off.textContent('#leads')).includes('Rent Manager'));
    assert.ok(!S.requests.some((r) => r.path === '/api/insights/'), 'does not ask for a read when stats says ai is off');
  });
  await off.context().close();

  await test('every API path ended in a slash', async () => {
    assert.deepStrictEqual(S.badPaths, []);
  });
  await test('no console errors and no CSP violations', async () => {
    assert.deepStrictEqual(problems, []);
  });

  await browser.close();
  server.close();
  results.forEach(([s, n]) => console.log(s, n));
  console.log(`screenshots: ${SHOTS}`);
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
