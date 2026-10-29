// Tests the database-backed side of the site: enquiries, the statistics, the dashboard's API,
// shared reports, confirmation emails, unsubscribing, Resend's delivery reports and the hand-off
// of leads to Rent Manager.
//   node scripts/test-analytics.cjs
// No network. The functions in api/ run behind a local server laid out like Vercel's, against
// a real Postgres (PGlite, in this process, behind a socket that speaks Postgres's own protocol,
// so the site's driver talks to it as it talks to Supabase) and stand-ins for Resend, the lead
// sheet's web app and Rent Manager. Every person is made up. Needs `npm ci --prefix scripts` once.
'use strict';
const http = require('http');
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const API = path.join(__dirname, '..', 'api');
const listen = (fn) => new Promise((resolve) => { const s = http.createServer(fn); s.listen(0, '127.0.0.1', () => resolve(s)); });
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });

let PGlite, PGLiteSocketServer;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
  ({ PGLiteSocketServer } = require('@electric-sql/pglite-socket'));
} catch {
  console.error('The test database is not installed: run  npm ci --prefix scripts  once.');
  process.exit(1);
}
const { toPostgres, forget, options } = require(path.join(API, '_lib', 'db.js'));

(async () => {
  // ---- Postgres: PGlite, reached over a socket like Supabase's pooler ---------------
  const pg = await PGlite.create({ parsers: { 20: Number, 1700: Number } });
  const pgServer = new PGLiteSocketServer({ db: pg, port: 0, host: '127.0.0.1' });
  await pgServer.start();

  // ---- Resend, the lead sheet and Rent Manager ---------------------------------------
  const mails = [];
  let resendN = 0;
  const resend = await listen(async (req, res) => {
    mails.push(JSON.parse(await readBody(req)));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: `re_${++resendN}` }));
  });
  const SHEET_TOKEN = 'b'.repeat(64);
  const leads = [];
  let pending = null;
  const sheet = await listen(async (req, res) => {
    if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      leads.push(body.lead);
      pending = body.token === SHEET_TOKEN ? { ok: true, tab: body.lead.property || 'General' } : { ok: false, error: 'Wrong token.' };
      res.writeHead(302, { Location: '/echo' }); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(pending));
  });
  const prospects = [];
  let rmMode = 'ok';
  const rm = await listen(async (req, res) => {
    const body = await readBody(req);
    const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.url === '/Authentication/AuthorizeUser') return JSON.parse(body).Password === 'rm-pass' ? send(200, 'rm-token-12345') : send(401, { UserMessage: 'Invalid login' });
    if (req.headers['x-rm12api-apitoken'] !== 'rm-token-12345') return send(401, {});
    if (req.method === 'POST' && req.url === '/Prospects') {
      if (rmMode === 'forbidden') return send(403, { UserMessage: 'Required privilege: Prospects - Add' });
      const list = JSON.parse(body);
      prospects.push(list[0]);
      return send(200, list.map((p, i) => ({ ...p, ProspectID: 900 + prospects.length + i })));
    }
    return send(404, {});
  });

  // ---- The site: each api/ file at its address, as Vercel lays them out --------------
  const PASSWORD = 'correct horse battery staple';
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(PASSWORD, salt, 1000, 32, 'sha256');
  Object.assign(process.env, {
    DATABASE_URL: `postgres://postgres:test@127.0.0.1:${pgServer.server.address().port}/postgres`,
    RESEND_API_KEY: 're_test', RESEND_API_URL: `http://127.0.0.1:${resend.address().port}/emails`,
    LEAD_TO: 'team@example.com', LEAD_FROM: 'Evolution24 Properties <leasing@example.com>',
    LEADS_SHEET_URL: `http://127.0.0.1:${sheet.address().port}/exec`, LEADS_SHEET_TOKEN: SHEET_TOKEN,
    ADMIN_PASSWORD_HASH: `pbkdf2$1000$${salt.toString('base64')}$${hash.toString('base64')}`,
    SESSION_SECRET: 'session-secret-for-tests', VISITOR_SALT: 'visitor-salt-for-tests',
    RM_PROSPECTS: 'on', RM_USERNAME: 'web-leads', RM_PASSWORD: 'rm-pass', RM_BASE_URL: `http://127.0.0.1:${rm.address().port}`,
    RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from('webhook-secret-bytes').toString('base64')}`,
  });
  // The site's list of homes follows Rent Manager, so it changes by the day: the tests bring
  // their own one-bedroom at Water Street instead of counting on a real one staying open.
  const { CONFIG } = require(path.join(API, '_lib', 'leads.js'));
  CONFIG.properties['water-street'].units['73'] = { label: 'Unit 302RV · 1 bed · $1,590/mo', bedrooms: '1' };
  // The site's list of homes follows Rent Manager, so it changes by the day: the tests bring
  // their own one-bedroom at Water Street instead of counting on a real one staying open.
  const { CONFIG } = require(path.join(API, '_lib', 'leads.js'));
  CONFIG.properties['water-street'].units['73'] = { label: 'Unit 302RV · 1 bed · $1,590/mo', bedrooms: '1' };
  const routes = {};
  for (const name of ['inquiry', 'collect', 'login', 'logout', 'stats', 'inquiries', 'reports', 'r', 'unsubscribe', 'email-events']) {
    routes[`/api/${name}/`] = require(path.join(API, `${name}.js`));
  }
  const site = await listen((req, res) => {
    let u = new URL(req.url, 'http://x');
    // vercel.json's rewrites
    let m = /^\/r\/([^/]+)\/$/.exec(u.pathname);
    if (m) u = new URL(`/api/r/?token=${m[1]}`, 'http://x');
    m = /^\/unsubscribe\/([^/]+)\/$/.exec(u.pathname);
    if (m) u = new URL(`/api/unsubscribe/?token=${m[1]}`, 'http://x');
    const fn = routes[u.pathname];
    if (!fn) { res.writeHead(404); res.end(); return; }
    req.url = u.pathname + u.search;
    fn(req, res);
  });
  const base = `http://127.0.0.1:${site.address().port}`;
  let ipN = 1;
  const call = (p, { method = 'GET', body, cookie, ip, headers = {} } = {}) => fetch(base + p, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Forwarded-For': ip || `10.1.0.${ipN++}`, 'User-Agent': 'Mozilla/5.0 (test)', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

  const results = [];
  const test = async (name, fn) => {
    mails.length = 0; leads.length = 0; prospects.length = 0; rmMode = 'ok';
    try { await fn(); results.push(['ok  ', name]); } catch (e) { results.push(['FAIL', `${name}: ${e.message.replace(/\s*\n\s*/g, ' ')}`]); }
  };
  const q = async (sql, ...a) => (await pg.query(toPostgres(sql), a)).rows;

  const enquiry = {
    form: 'property', property: 'water-street', page: '/properties/water-street/', unit: '73',
    first_name: 'Alex', last_name: 'Test', email: 'alex.test@example.com', phone: '585-555-0101',
    interest: 'tour', move_in: '2026-11', source: 'search', message: 'Is parking included?', website: '',
  };

  await test('a building’s form: saved, on its tab, both emails, and a Rent Manager prospect', async () => {
    const r = await call('/api/inquiry/', { method: 'POST', body: enquiry, ip: '10.9.9.1' });
    const out = await r.json();
    assert.strictEqual(r.status, 202); assert.match(out.id, /^E24-/);
    const [row] = await q('SELECT * FROM inquiries WHERE ref = ?', out.id);
    assert.strictEqual(row.property, 'water-street'); assert.strictEqual(row.unit, 'Unit 302RV · 1 bed · $1,590/mo');
    assert.strictEqual(row.bedrooms, '1'); assert.strictEqual(row.move_in, '2026-11'); assert.strictEqual(row.form, 'property');
    assert.strictEqual(row.notified, 1); assert.strictEqual(row.rm_ok, 1); assert.ok(row.rm_id);
    assert.strictEqual(leads[0].property, 'Water Street'); assert.strictEqual(leads[0].unit, 'Unit 302RV · 1 bed · $1,590/mo');
    assert.strictEqual(leads[0].form, 'Building page'); assert.strictEqual(leads[0].move_in, 'November 2026');
    const team = mails.find((m) => m.to.includes('team@example.com'));
    const conf = mails.find((m) => m.to.includes('alex.test@example.com'));
    assert.ok(team.subject.startsWith('New enquiry · Water Street')); assert.ok(team.html.includes('Added to Rent Manager'));
    assert.ok(conf.subject.includes('tour request · Water Street')); assert.ok(conf.html.includes('/unsubscribe/'));
    assert.ok(!conf.html.includes('parking'), 'the confirmation never repeats what they typed');
    assert.strictEqual(prospects[0].PropertyID, 8); assert.strictEqual(prospects[0].Contacts[0].Email, 'alex.test@example.com');
    assert.strictEqual(prospects[0].MoveInDate, '2026-11-01T00:00:00');
    assert.strictEqual((await q('SELECT ok FROM lead_sync WHERE inquiry_id = ?', row.id))[0].ok, 1);
    assert.deepStrictEqual((await q('SELECT kind, sent FROM emails WHERE inquiry_id = ? ORDER BY kind', row.id)).map((e) => [e.kind, e.sent]), [['confirmation', 1], ['notification', 1]]);
  });

  await test('a unit the building does not list is dropped, not stored', async () => {
    const r = await call('/api/inquiry/', { method: 'POST', body: { ...enquiry, unit: '6', email: 'other@example.com' } });
    const out = await r.json();
    const [row] = await q('SELECT unit, unit_id FROM inquiries WHERE ref = ?', out.id);
    assert.strictEqual(row.unit, null); assert.strictEqual(row.unit_id, null);
  });

  await test('the same person asking again: no second prospect, no second confirmation within 12 hours', async () => {
    await call('/api/inquiry/', { method: 'POST', body: enquiry });
    assert.strictEqual(prospects.length, 0);
    assert.ok(!mails.some((m) => m.to.includes('alex.test@example.com')));
    const [last] = await q("SELECT rm_note FROM inquiries WHERE email = 'alex.test@example.com' ORDER BY id DESC LIMIT 1");
    assert.match(last.rm_note, /Already in Rent Manager/);
  });

  await test('Rent Manager refusing still takes the lead, and the team is told why', async () => {
    rmMode = 'forbidden';
    const r = await call('/api/inquiry/', { method: 'POST', body: { ...enquiry, email: 'sam.test@example.com', property: 'biltmore', unit: '', page: '/properties/biltmore/' } });
    assert.strictEqual(r.status, 202);
    const team = mails.find((m) => m.to.includes('team@example.com'));
    assert.ok(team.html.includes('Not added to Rent Manager: The Rent Manager user may not add prospects.'));
  });

  await test('the contact page, with no building, goes to General and not to Rent Manager', async () => {
    const r = await call('/api/inquiry/', { method: 'POST', body: { form: 'contact', first_name: 'Jo', last_name: 'Test', email: 'jo.test@example.com', interest: 'question', move_in: 'asap' } });
    assert.strictEqual(r.status, 202);
    assert.strictEqual(leads[0].property, ''); assert.strictEqual(prospects.length, 0);
    assert.strictEqual(leads[0].move_in, 'As soon as possible');
  });

  await test('a pageview is counted under its building; a bot is not counted', async () => {
    const before = (await q('SELECT COUNT(*) AS n FROM events'))[0].n;
    let r = await call('/api/collect/', { method: 'POST', body: { kind: 'pageview', path: '/properties/water-street/?utm_source=x', ref: 'https://www.google.com/search?q=lofts', device: 'mobile', utm: { source: 'Google', medium: 'CPC', campaign: 'Fall 2026' } }, ip: '10.2.0.1' });
    assert.strictEqual(r.status, 202);
    r = await call('/api/collect/', { method: 'POST', body: { kind: 'apply_click', path: '/properties/', property: 'water-street', meta: { unit: '302RV' } }, ip: '10.2.0.1' });
    r = await call('/api/collect/', { method: 'POST', body: { kind: 'pageview', path: '/' }, headers: { 'User-Agent': 'Googlebot/2.1' } });
    const rows = (await q('SELECT kind, path, property, ref, utm_source, utm_medium, utm_campaign FROM events ORDER BY id DESC LIMIT 2'));
    assert.strictEqual((await q('SELECT COUNT(*) AS n FROM events'))[0].n, before + 2);
    assert.deepStrictEqual(rows[1], { kind: 'pageview', path: '/properties/water-street/', property: 'water-street', ref: 'google.com', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'fall-2026' });
    assert.strictEqual(rows[0].property, 'water-street');
  });

  await test('an enquiry with no tag on the form takes the visitor’s first pageview as its source', async () => {
    await call('/api/collect/', { method: 'POST', body: { kind: 'pageview', path: '/properties/biltmore/', ref: 'https://l.facebook.com/', utm: { source: 'facebook', medium: 'paid_social', campaign: 'biltmore-oct' } }, ip: '10.3.0.7' });
    const r = await call('/api/inquiry/', { method: 'POST', body: { ...enquiry, property: 'biltmore', unit: '', email: 'pat.test@example.com', page: '/properties/biltmore/' }, ip: '10.3.0.7' });
    const out = await r.json();
    const [row] = await q('SELECT utm_source, utm_campaign, landing FROM inquiries WHERE ref = ?', out.id);
    assert.deepStrictEqual(row, { utm_source: 'facebook', utm_campaign: 'biltmore-oct', landing: '/properties/biltmore/' });
  });

  let cookie = '';
  await test('the dashboard needs the password; six wrong tries lock the address out', async () => {
    let r = await call('/api/stats/?days=30');
    assert.strictEqual(r.status, 401);
    for (let i = 0; i < 6; i++) r = await call('/api/login/', { method: 'POST', body: { password: 'nope' }, ip: '10.4.0.1' });
    assert.strictEqual(r.status, 401);
    r = await call('/api/login/', { method: 'POST', body: { password: PASSWORD }, ip: '10.4.0.1' });
    assert.strictEqual(r.status, 429);
    r = await call('/api/login/', { method: 'POST', body: { password: PASSWORD }, ip: '10.4.0.2' });
    assert.strictEqual(r.status, 200);
    const set = r.headers.get('set-cookie');
    assert.match(set, /e24_admin=\d+\.[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Strict/);
    cookie = set.split(';')[0];
  });

  await test('the numbers: totals, each building, units applied for, sources, size interest', async () => {
    await call('/api/collect/', { method: 'POST', body: { kind: 'filter', path: '/properties/', meta: { value: 'b1' } } });
    const r = await call('/api/stats/?days=30', { cookie });
    assert.strictEqual(r.status, 200);
    const s = await r.json();
    assert.ok(s.totals.leads >= 6); assert.ok(s.totals.apply_clicks >= 1); assert.ok(s.totals.pageviews >= 2);
    assert.strictEqual(s.properties.length, 11);
    const ws = s.properties.find((p) => p.slug === 'water-street');
    assert.ok(ws.leads >= 3 && ws.apply_clicks === 1 && ws.views === 1);
    assert.deepStrictEqual(s.units[0], { property: 'Water Street', slug: 'water-street', unit: '302RV', clicks: 1 });
    assert.ok(s.sources.some((x) => x.channel === 'google / cpc'));
    assert.ok(s.plans.some((x) => x.plan === '1 bedroom' && x.count >= 2));
    assert.strictEqual(s.availability.open, 19); assert.ok(s.emails.confirmations.sent >= 1);
    assert.strictEqual(s.daily.length, 30);
  });

  await test('the enquiries list: by building, marked handled, sent to Rent Manager again', async () => {
    let r = await call('/api/inquiries/?all=1&property=water-street', { cookie });
    let out = await r.json();
    assert.ok(out.inquiries.length >= 3 && out.inquiries.every((i) => i.property === 'water-street'));
    assert.strictEqual(out.properties.biltmore, 'The Biltmore'); assert.strictEqual(out.rm, true);
    assert.strictEqual(out.labels.interest.tour, 'Booking a tour');
    const first = out.inquiries[out.inquiries.length - 1];
    assert.strictEqual(first.confirm_ok, 1); assert.strictEqual(first.sheet_ok, 1);
    r = await call('/api/inquiries/', { method: 'POST', cookie, body: { id: first.id, handled: true } });
    assert.strictEqual(r.status, 200);
    r = await call('/api/inquiries/?property=water-street', { cookie });
    out = await r.json();
    assert.ok(!out.inquiries.some((i) => i.id === first.id));
    const sam = (await q("SELECT id FROM inquiries WHERE email = 'sam.test@example.com'"))[0];
    r = await call('/api/inquiries/', { method: 'POST', cookie, body: { id: sam.id, rentmanager: true } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await q('SELECT rm_ok FROM inquiries WHERE id = ?', sam.id))[0].rm_ok, 1);
  });

  await test('a shared report: totals only, by building, readable without signing in, and switched off', async () => {
    let r = await call('/api/reports/', { method: 'POST', cookie, body: { period: 'month', day: new Date().toISOString().slice(0, 10) } });
    const made = await r.json();
    assert.strictEqual(r.status, 200); assert.match(made.url, /\/r\/[\w-]{16,}\/$/);
    const token = made.token;
    r = await call(`/r/${token}/`);
    const page = await r.text();
    assert.strictEqual(r.status, 200);
    assert.ok(page.includes('By building') && page.includes('Water Street') && page.includes('Units people applied for'));
    for (const secret of ['alex.test@example.com', 'Alex', 'parking', '585-555-0101']) assert.ok(!page.includes(secret), `no ${secret} in a report`);
    r = await call(`/api/reports/?token=${token}`, { method: 'DELETE', cookie });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await call(`/r/${token}/`)).status, 404);
  });

  await test('unsubscribing: a page first, then the button; no more confirmations', async () => {
    const [pref] = await q("SELECT token FROM email_prefs WHERE email = 'alex.test@example.com'");
    let r = await call(`/unsubscribe/${pref.token}/`);
    let page = await r.text();
    assert.ok(page.includes('Stop emails from Evolution24?') && page.includes('a•••@example.com') && !page.includes('alex.test@'));
    assert.strictEqual((await q("SELECT unsubscribed_at FROM email_prefs WHERE email = 'alex.test@example.com'"))[0].unsubscribed_at, null);
    r = await call(`/unsubscribe/${pref.token}/`, { method: 'POST', body: '' });
    page = await r.text();
    assert.ok(page.includes('You’re unsubscribed.'));
    const ids = (await q("SELECT id FROM inquiries WHERE email = 'alex.test@example.com'")).map((x) => x.id);
    r = await call('/api/inquiries/', { method: 'POST', cookie, body: { id: ids[0], confirm: true } });
    assert.strictEqual(r.status, 502); assert.match((await r.json()).error, /unsubscribed/);
    assert.strictEqual((await call('/unsubscribe/not-a-real-token-at-all/')).status, 404);
  });

  await test('Resend’s delivery reports: signed ones stamp the email; unsigned ones are refused', async () => {
    const [mail] = await q("SELECT resend_id FROM emails WHERE kind = 'confirmation' AND sent = 1 LIMIT 1");
    const body = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: mail.resend_id } });
    const id = 'msg_1'; const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', Buffer.from('webhook-secret-bytes')).update(`${id}.${ts}.${body}`).digest('base64');
    let r = await call('/api/email-events/', { method: 'POST', body, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` } });
    assert.strictEqual(r.status, 200);
    assert.ok((await q('SELECT delivered_at FROM emails WHERE resend_id = ?', mail.resend_id))[0].delivered_at);
    r = await call('/api/email-events/', { method: 'POST', body, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': 'v1,forged' } });
    assert.strictEqual(r.status, 401);
  });

  await test('signing out clears the cookie', async () => {
    const r = await call('/api/logout/', { method: 'POST', cookie });
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  });

  await test('the database layer: ? numbered outside quotes, Supabase addresses read, tables made again', async () => {
    assert.strictEqual(toPostgres("SELECT ? AS a, '?' AS b, \"q?\" FROM t WHERE x = ? AND y = 'it''s ?'"),
      "SELECT $1 AS a, '?' AS b, \"q?\" FROM t WHERE x = $2 AND y = 'it''s ?'");
    const o = options('postgres://postgres.abcdefghij:p%40ss%2Fw0rd@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x');
    assert.deepStrictEqual([o.host, o.port, o.database, o.username, o.password, o.ssl, o.prepare, o.max],
      ['aws-0-us-east-1.pooler.supabase.com', 6543, 'postgres', 'postgres.abcdefghij', 'p@ss/w0rd', 'require', false, 1]);
    assert.strictEqual(options('postgresql://u:p@localhost:5432/db').ssl, false);
    process.env.DB_CA_CERT = '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----';
    try {
      const v = options('postgres://u:p@db.example.supabase.com:6543/postgres').ssl;
      assert.deepStrictEqual([v.rejectUnauthorized, v.ca.split('\n').length, v.servername], [true, 3, 'db.example.supabase.com']);
    } finally { delete process.env.DB_CA_CERT; }
    // A second instance on a database that already has the tables: the schema runs again, harmlessly.
    await forget();
    const r = await call('/api/collect/', { method: 'POST', body: { kind: 'pageview', path: '/faqs/' } });
    assert.ok(r.status < 300, `collect answered ${r.status}`);
    assert.strictEqual((await q("SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname = 'public' AND rowsecurity")).at(0).n, 9);
  });

  await test('without a database the form still reaches the sheet and the inbox', async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const r = await call('/api/inquiry/', { method: 'POST', body: { ...enquiry, email: 'nodb@example.com' } });
      assert.strictEqual(r.status, 202);
      assert.strictEqual(leads.length, 1); assert.ok(mails.some((m) => m.to.includes('team@example.com')));
      assert.ok(!mails.some((m) => m.to.includes('nodb@example.com')), 'no confirmation without an unsubscribe record');
    } finally { process.env.DATABASE_URL = saved; }
  });

  [resend, sheet, rm, site].forEach((s) => s.close());
  await forget();
  await pgServer.stop();
  await pg.close();
  results.forEach(([s, n]) => console.log(s, n));
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
