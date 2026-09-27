// Tests api/inquiry.js against local stand-ins for Resend and the lead sheet's web app.
//   node scripts/test-inquiry.cjs
// No network, no dependencies. The sheet stand-in answers the way Apps Script does:
// a POST gets a 302 to a second address that returns the JSON, which fetch follows.
'use strict';
const http = require('http');
const assert = require('assert');
const path = require('path');

const handlerPath = path.join(__dirname, '..', 'api', 'inquiry.js');
const handler = require(handlerPath);   // settings are read per request, so one load serves every test

function listen(fn) {
  return new Promise((resolve) => { const s = http.createServer(fn); s.listen(0, '127.0.0.1', () => resolve(s)); });
}
const readJson = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b ? JSON.parse(b) : null)); });

(async () => {
  // Resend stand-in
  const mails = [];
  let resendMode = 'ok';
  const resend = await listen(async (req, res) => {
    const body = await readJson(req);
    mails.push({ auth: req.headers.authorization, body });
    if (resendMode === 'ok') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"re_1"}'); return; }
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end('{"message":"You can only send testing emails to your own email address"}');
  });
  // Lead sheet stand-in (Apps Script web app)
  const leads = [];
  let sheetMode = 'ok';
  const TOKEN = 'a'.repeat(64);
  let pending = null;
  const sheet = await listen(async (req, res) => {
    if (req.method === 'POST') {
      const body = await readJson(req);
      leads.push(body);
      pending = sheetMode === 'ok' && body.token === TOKEN ? { ok: true, tab: body.lead.property || 'General' } : { ok: false, error: 'Wrong token.' };
      res.writeHead(302, { Location: '/echo' }); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(pending));
  });

  const env = (over = {}) => {
    const base = {
      LEAD_TO: 'one@example.com, two@example.com', LEAD_FROM: 'Evolution24 Properties <leasing@example.com>',
      RESEND_API_KEY: 're_test', RESEND_API_URL: `http://127.0.0.1:${resend.address().port}/emails`,
      LEADS_SHEET_URL: `  http://127.0.0.1:${sheet.address().port}/exec `, LEADS_SHEET_TOKEN: `"${TOKEN}" `,
    };
    ['LEAD_TO', 'LEAD_FROM', 'RESEND_API_KEY', 'RESEND_API_URL', 'LEADS_SHEET_URL', 'LEADS_SHEET_TOKEN', 'LEADS_SHEET_LINK'].forEach((k) => delete process.env[k]);
    Object.assign(process.env, base, over);
    Object.keys(over).forEach((k) => { if (over[k] === undefined) delete process.env[k]; });
  };
  const site = await listen((req, res) => handler(req, res));
  const url = `http://127.0.0.1:${site.address().port}/api/inquiry/`;
  let ip = 1;
  const send = (data, { json = true, headers = {}, sameIp = false } = {}) => fetch(url, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', ...(json ? { Accept: 'application/json' } : {}), 'X-Forwarded-For': `10.0.0.${sameIp ? 250 : ip++}`, ...headers },
    body: json ? JSON.stringify(data) : new URLSearchParams(data).toString(),
  });
  const good = { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '(585) 555-0100', property: 'water-street',
    interest: 'tour', bedrooms: '1', move_in: '1-2', source: 'search', message: 'Hi <b>there</b>\nSecond line', website: '',
    utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'fall-2026', landing: '/properties/water-street/' };
  const results = [];
  const test = async (name, fn) => { mails.length = 0; leads.length = 0; resendMode = 'ok'; sheetMode = 'ok'; env(); try { await fn(); results.push(['ok  ', name]); } catch (e) { results.push(['FAIL', `${name}: ${e.message}`]); } };

  await test('a full enquiry reaches the sheet tab and both inboxes', async () => {
    const r = await send(good); const out = await r.json();
    assert.strictEqual(r.status, 202); assert.strictEqual(out.ok, true); assert.match(out.id, /^E24-\d{6}-[2-9A-HJ-NP-Z]{4}$/);
    assert.strictEqual(leads.length, 1); const lead = leads[0].lead;
    assert.strictEqual(leads[0].token, TOKEN, 'token read out of a messy paste');
    assert.strictEqual(lead.property, 'Water Street'); assert.strictEqual(lead.interest, 'Booking a tour'); assert.strictEqual(lead.bedrooms, '1 bedroom');
    assert.strictEqual(lead.move_in, 'In 1–2 months'); assert.strictEqual(lead.source, 'Search');
    assert.strictEqual(lead.came_via, 'google / cpc · fall-2026 · landed on /properties/water-street/');
    assert.strictEqual(lead.message, 'Hi <b>there</b>\nSecond line', 'message keeps its line break');
    assert.strictEqual(mails.length, 1); const m = mails[0].body;
    assert.deepStrictEqual(m.to, ['one@example.com', 'two@example.com']); assert.strictEqual(m.reply_to, 'jane@example.com');
    assert.strictEqual(m.from, 'Evolution24 Properties <leasing@example.com>'); assert.strictEqual(m.subject, 'New enquiry · Water Street · Jane Doe');
    assert.ok(m.html.includes('Hi &lt;b&gt;there&lt;/b&gt;'), 'message is escaped in the email');
    assert.ok(m.html.includes('Added to the lead sheet, on the <strong>Water Street</strong> tab.'));
    assert.ok(m.text.includes('Moving in: In 1–2 months'));
  });
  await test('Charlotte Square, or anything unknown, lands on General', async () => {
    for (const p of ['charlotte-square', 'nope', '']) {
      leads.length = 0; const r = await send({ ...good, property: p });
      assert.strictEqual(r.status, 202); assert.strictEqual(leads[0].lead.property, '');
    }
    assert.ok(mails.every((x) => x.body.subject.startsWith('New enquiry · No property picked')));
  });
  await test('choices not on the lists are dropped', async () => {
    await send({ ...good, interest: 'free money', bedrooms: '9', move_in: 'yesterday', source: '<script>' });
    const l = leads[0].lead; assert.deepStrictEqual([l.interest, l.bedrooms, l.move_in, l.source], ['', '', '', '']);
  });
  await test('a bad email address is refused, nothing sent', async () => {
    const r = await send({ ...good, email: 'not-an-email' }); assert.strictEqual(r.status, 400);
    assert.strictEqual(leads.length + mails.length, 0);
  });
  await test('the honeypot looks like success and sends nothing', async () => {
    const r = await send({ ...good, website: 'http://spam.example' }); assert.strictEqual(r.status, 202);
    assert.strictEqual(leads.length + mails.length, 0);
  });
  await test('a post from another site is refused', async () => {
    const r = await send(good, { headers: { Origin: 'https://evil.example' } }); assert.strictEqual(r.status, 403);
    assert.strictEqual(leads.length + mails.length, 0);
  });
  await test('this site\'s own origin is allowed', async () => {
    const r = await send(good, { headers: { Origin: `http://127.0.0.1:${site.address().port}` } }); assert.strictEqual(r.status, 202);
  });
  await test('a wrong sheet token still emails the team, and says why', async () => {
    env({ LEADS_SHEET_TOKEN: 'b'.repeat(64) });
    const r = await send(good); assert.strictEqual(r.status, 202);
    assert.ok(mails[0].body.html.includes('Not added to the lead sheet: The sheet said: Wrong token.'));
  });
  await test('an email failure still counts when the sheet has it', async () => {
    resendMode = 'fail'; const r = await send(good); assert.strictEqual(r.status, 202); assert.strictEqual(leads.length, 1);
  });
  await test('both failing asks the visitor to call', async () => {
    resendMode = 'fail'; env({ LEADS_SHEET_TOKEN: 'b'.repeat(64) });
    const r = await send(good); const out = await r.json();
    assert.strictEqual(r.status, 502); assert.match(out.error, /585-245-3071/);
  });
  await test('nothing configured says so, and records nothing', async () => {
    env({ RESEND_API_KEY: undefined, LEADS_SHEET_URL: undefined, LEADS_SHEET_TOKEN: undefined });
    const r = await send(good); assert.strictEqual(r.status, 503); assert.strictEqual(leads.length + mails.length, 0);
  });
  await test('email only (no sheet yet) works', async () => {
    env({ LEADS_SHEET_URL: undefined, LEADS_SHEET_TOKEN: undefined });
    const r = await send(good); assert.strictEqual(r.status, 202);
    assert.ok(mails[0].body.html.includes('The lead sheet is not connected'));
  });
  await test('without JavaScript: a plain form post comes back to #sent', async () => {
    const r = await send(good, { json: false }); assert.strictEqual(r.status, 303);
    assert.strictEqual(r.headers.get('location'), '/contact-us/#sent'); assert.strictEqual(leads[0].lead.property, 'Water Street');
  });
  await test('without JavaScript: a failure comes back to #not-sent', async () => {
    const r = await send({ ...good, email: 'x' }, { json: false }); assert.strictEqual(r.status, 303);
    assert.strictEqual(r.headers.get('location'), '/contact-us/#not-sent');
  });
  await test('the sixth send from one connection in ten minutes is refused', async () => {
    const codes = []; for (let i = 0; i < 6; i++) codes.push((await send(good, { sameIp: true })).status);
    assert.deepStrictEqual(codes, [202, 202, 202, 202, 202, 429]);
  });
  await test('only POST is answered', async () => {
    const r = await fetch(url); assert.strictEqual(r.status, 405);
  });

  results.forEach(([s, n]) => console.log(s, n));
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
  [resend, sheet, site].forEach((s) => s.close());
  process.exit(failed ? 1 : 0);
})();
