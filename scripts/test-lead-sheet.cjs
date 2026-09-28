// Every property's enquiries land on that property's own tab of the lead sheet.
//   node scripts/test-lead-sheet.cjs
// Runs the real sheet script (tools/lead-sheet/Code.gs) behind the real contact endpoint
// (api/inquiry.js), with Google Sheets replaced by an in-memory stand-in that keeps each tab's
// values and formulas. No network, no dependencies. Styling calls are accepted and ignored, so
// this cannot prove Google takes every one of them: running setup in a real sheet does that.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const assert = require('assert');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'api', 'leads-config.json'), 'utf8'));

/* ---- Google Sheets, in memory ------------------------------------------------------------- */
function sheetsStandIn() {
  const noop = () => new Proxy(function () {}, { get: (t, k) => (k === 'build' ? () => ({}) : noop()), apply: () => noop() });
  const ss = { sheets: [], active: null };
  let nextId = 1;
  const makeSheet = (name) => {
    const cells = new Map();                       // "row,col" -> value, or {f: formula}
    const key = (r, c) => `${r},${c}`;
    const sh = { name, id: nextId++, maxRows: 1000, maxCols: 26, cells };
    const range = (r, c, nr = 1, nc = 1) => {
      const R = {
        setValues(rows) { rows.forEach((row, i) => row.forEach((v, j) => cells.set(key(r + i, c + j), v))); return P; },
        setValue(v) { cells.set(key(r, c), v); return P; },
        setFormula(f) { cells.set(key(r, c), { f }); return P; },
        getValue() { return cells.has(key(r, c)) ? cells.get(key(r, c)) : ''; },
        createTextFinder(q) {
          return { matchEntireCell() { return this; },
            findNext() { for (let i = 0; i < nr; i++) if (String(cells.get(key(r + i, c))) === q) return {}; return null; } };
        },
      };
      const P = new Proxy(R, { get: (t, k) => (k in t ? t[k] : () => P) });   // every styling call: accepted, ignored
      return P;
    };
    const col = (L) => L.charCodeAt(0) - 64;
    const a1 = (s) => {
      const m = /^([A-Z])(\d+)(?::([A-Z])(\d+)?)?$/.exec(s);
      if (!m) throw new Error(`the stand-in cannot read the range "${s}"`);
      return range(+m[2], col(m[1]), m[4] ? +m[4] - +m[2] + 1 : 1, m[3] ? col(m[3]) - col(m[1]) + 1 : 1);
    };
    Object.assign(sh, {
      getName: () => sh.name, setName: (n) => { sh.name = n; return S; }, getSheetId: () => sh.id, getParent: () => ss,
      getRange: (a, b, c, d) => (typeof a === 'string' ? a1(a) : range(a, b, c, d)),
      getLastRow: () => Math.max(0, ...[...cells].filter(([, v]) => v !== '').map(([k]) => +k.split(',')[0])),
      getMaxRows: () => sh.maxRows, getMaxColumns: () => sh.maxCols,
      insertRowsAfter: (at, n) => { sh.maxRows += n; }, insertColumnsAfter: (at, n) => { sh.maxCols += n; },
      insertRowBefore: (at) => {
        [...cells].filter(([k]) => +k.split(',')[0] >= at).sort(([x], [y]) => +y.split(',')[0] - +x.split(',')[0])
          .forEach(([k, v]) => { const [r, c] = k.split(',').map(Number); cells.delete(k); cells.set(key(r + 1, c), v); });
        sh.maxRows++;
      },
      getBandings: () => [], getProtections: () => [], getFilter: () => null, getImages: () => [],
      clear: () => { cells.clear(); }, insertImage: () => noop(),
      row: (r) => [...Array(sh.maxCols)].map((_, i) => (cells.has(key(r, i + 1)) ? cells.get(key(r, i + 1)) : '')),
    });
    const S = new Proxy(sh, { get: (t, k) => (k in t ? t[k] : () => S) });
    return S;
  };
  Object.assign(ss, {
    getSheetByName: (n) => ss.sheets.find((s) => s.getName() === n) || null,
    getSheets: () => ss.sheets.slice(),
    insertSheet: (n, i) => { const s = makeSheet(n); ss.sheets.splice(i == null ? ss.sheets.length : i, 0, s); return s; },
    setActiveSheet: (s) => { ss.active = s; return s; },
    moveActiveSheet: (pos) => { ss.sheets.splice(ss.sheets.indexOf(ss.active), 1); ss.sheets.splice(pos - 1, 0, ss.active); },
    toast: () => {},
  });
  ss.sheets.push(makeSheet('Sheet1'));             // a new Google Sheet starts with one empty tab
  const props = new Map();
  const ctx = vm.createContext({
    console: { log: () => {} },
    SpreadsheetApp: { getActive: () => ss, newDataValidation: noop, newConditionalFormatRule: noop, newRichTextValue: noop,
      newTextStyle: noop, WrapStrategy: {}, BandingTheme: {}, ProtectionType: {}, BorderStyle: {}, CopyPasteType: {},
      getUi: () => ({ createMenu: noop, alert: () => {}, ButtonSet: {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => crypto.randomUUID(), base64Decode: (b) => Buffer.from(b, 'base64'), newBlob: () => ({}) },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools', 'lead-sheet', 'Code.gs'), 'utf8') +
    '\n;globalThis.__gs = { setup, doPost, tokenFor_, PROPERTIES, HEADERS, GENERAL };', ctx);
  return { ss, gs: ctx.__gs };
}

const listen = (fn) => new Promise((resolve) => { const s = http.createServer(fn); s.listen(0, '127.0.0.1', () => resolve(s)); });
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });

(async () => {
  const { ss, gs } = sheetsStandIn();
  gs.setup();
  const names = Object.values(CONFIG.properties).map((p) => p.name);
  const tabs = () => ss.getSheets().map((s) => s.getName());
  const col = (h) => gs.HEADERS.indexOf(h);
  const leadRows = (tab) => {           // the rows under the titles that hold an enquiry
    const s = ss.getSheetByName(tab); const out = [];
    for (let r = 2; r <= s.getLastRow(); r++) { const row = s.row(r); if (row[col('Enquiry #')]) out.push(row); }
    return out;
  };

  // The sheet's web app: a POST runs doPost, and answers the way Apps Script does, with a 302
  // to a second address that returns the JSON, which fetch follows.
  let pending = null;
  const sheet = await listen(async (req, res) => {
    if (req.method === 'POST') { pending = gs.doPost({ postData: { contents: await readBody(req) } }).s; res.writeHead(302, { Location: '/echo' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(pending);
  });
  const mails = [];
  const resend = await listen(async (req, res) => { mails.push(JSON.parse(await readBody(req))); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"re_1"}'); });
  Object.assign(process.env, {
    LEAD_TO: 'leasing@example.com', LEAD_FROM: 'Evolution24 Properties <leasing@example.com>', RESEND_API_KEY: 're_test',
    RESEND_API_URL: `http://127.0.0.1:${resend.address().port}/emails`,
    LEADS_SHEET_URL: `http://127.0.0.1:${sheet.address().port}/exec`, LEADS_SHEET_TOKEN: gs.tokenFor_(),
  });
  const site = await listen(require(path.join(ROOT, 'api', 'inquiry.js')));
  let ip = 1;
  const send = async (fields) => {
    const r = await fetch(`http://127.0.0.1:${site.address().port}/api/inquiry/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Forwarded-For': `10.1.0.${ip++}` },
      body: JSON.stringify({ first_name: 'Test', last_name: 'Lead', email: 'test@example.com', phone: '585-555-0100', interest: 'tour',
        bedrooms: '1', move_in: '1-2', source: 'search', message: 'Hello', website: '', ...fields }) });
    const out = await r.json();
    assert.ok(r.status === 202 && out.ok, `the endpoint refused it: ${JSON.stringify(out)}`);
    return out.id;
  };

  const results = [];
  const test = async (name, fn) => { try { await fn(); results.push(['ok  ', name]); } catch (e) { results.push(['FAIL', `${name}: ${e.message}`]); } };

  await test('setup makes Overview, General, a tab for every property the form offers, and Lists', async () => {
    assert.deepStrictEqual(tabs(), ['Overview', gs.GENERAL, ...names, 'Lists']);
  });
  await test('the sheet script and the website list the same properties, in the same order', async () => {
    assert.deepStrictEqual(Array.from(gs.PROPERTIES, (p) => p.name), names);
  });
  for (const [slug, p] of Object.entries(CONFIG.properties)) {
    await test(`an enquiry about ${p.name} lands on its own tab, and only there`, async () => {
      const id = await send({ property: slug, first_name: p.name.replace(/[^A-Za-z0-9 ]/g, ''), last_name: 'Prospect' });
      const holding = tabs().filter((t) => leadRows(t).some((row) => row[col('Enquiry #')] === id));
      assert.deepStrictEqual(holding, [p.name]);
      const row = ss.getSheetByName(p.name).row(2);          // newest at the top
      assert.strictEqual(row[col('Enquiry #')], id);
      assert.strictEqual(row[col('Status')], 'New');
      assert.strictEqual(row[col('Replied')], false);
      assert.ok(mails.at(-1).html.includes(`on the <strong>${p.name}</strong> tab`), 'the email names the tab');
    });
  }
  await test('an enquiry with no property picked lands on General', async () => {
    const id = await send({ property: '' });
    assert.strictEqual(ss.getSheetByName(gs.GENERAL).row(2)[col('Enquiry #')], id);
  });
  await test('Charlotte Square (it has its own lead sheet) lands on General, not a tab of its own', async () => {
    const id = await send({ property: 'charlotte-square' });
    assert.strictEqual(ss.getSheetByName(gs.GENERAL).row(2)[col('Enquiry #')], id);
    assert.ok(!tabs().includes('Charlotte Square'));
  });
  await test('newest at the top: a second enquiry for a property goes above the first', async () => {
    const [slug, p] = Object.entries(CONFIG.properties)[0];
    const before = leadRows(p.name).length;
    const id = await send({ property: slug, first_name: 'Second' });
    assert.strictEqual(leadRows(p.name).length, before + 1);
    assert.strictEqual(ss.getSheetByName(p.name).row(2)[col('Enquiry #')], id);
  });
  await test('the same enquiry sent twice (a retry) is kept once', async () => {
    const lead = { id: 'E24-000000-TEST', received: new Date().toISOString(), property: names[1], name: 'Retry' };
    const post = () => JSON.parse(gs.doPost({ postData: { contents: JSON.stringify({ token: gs.tokenFor_(), lead }) } }).s);
    assert.strictEqual(post().ok, true); assert.strictEqual(post().duplicate, true);
    assert.strictEqual(leadRows(names[1]).filter((row) => row[col('Enquiry #')] === lead.id).length, 1);
  });
  await test('the Overview has a row for every tab, linked to it', async () => {
    const ov = ss.getSheetByName('Overview');
    const linked = [];
    for (let r = 1; r <= 60; r++) { const x = ov.row(r)[1]; if (x && x.f && /^=HYPERLINK\("#gid=/.test(x.f)) linked.push(/,"(.*)"\)$/.exec(x.f)[1]); }
    assert.deepStrictEqual(linked, [gs.GENERAL, ...names]);
  });

  results.forEach(([s, n]) => console.log(s, n));
  console.log('\nRows on each tab:', tabs().filter((t) => t !== 'Overview' && t !== 'Lists').map((t) => `${t} ${leadRows(t).length}`).join(' · '));
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
  [sheet, resend, site].forEach((s) => s.close());
  process.exit(failed ? 1 : 0);
})();
