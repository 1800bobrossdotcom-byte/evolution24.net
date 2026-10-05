// The Rent Manager client and the connection check, against a stand-in for Rent Manager.
//   node scripts/test-rent-manager.cjs
// Runs the real scripts (tools/rent-manager/RentManager.gs and Check.gs) with Apps Script's
// services replaced by in-memory stand-ins, and Rent Manager's Web API by a fake that follows
// its overview: sign-in and token, pages of up to 1,000 with X-Total-Results, 403 for no access,
// 404 for nothing found, an hourly request limit with its headers and 429. No network, no
// dependencies. It cannot prove Rent Manager names its fields as the fake does: running the
// check against the real API does that.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const CODE = ['RentManager.gs', 'Check.gs'].map((f) => fs.readFileSync(path.join(ROOT, 'tools', 'rent-manager', f), 'utf8')).join('\n');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'properties.json'), 'utf8')).properties;

const HOST = 'evolution.api.rentmanager.com';
const USER = 'e24-sync-reader';
const PASSWORD = 'Correct-Horse-Battery-9';
const START = Date.UTC(2026, 9, 5, 14, 0, 0);

/* ---- Rent Manager, faked ------------------------------------------------------------------- */
const PII = ['Jane', 'Doe', 'jane.doe@example.com', '585-555-0199', 'Pat Prospect', 'pat@example.com', '1234.56', '777.77', '1234567890'];

function fakeData() {
  const properties = [
    [1, '301 Central Ave - ROC'], [6, '145 S Fitzhugh - ROC'], [8, '168-172 N Water Street-ROC'], [11, '179-189 St Paul -ROC'],
    [12, '50 Charlotte Sq'], [2, '2215 James St- SYR'], [3, '121 Park Dr. - Manlius'], [10, '379 Main St - Geneva'],
    [5, '561 S Main St - Geneva'], [7, '31 Genesee St- Geneva'], [13, '357 Alexander St- ROC'],   // no Biltmore (9)
  ].map(([id, name]) => ({ PropertyID: id, Name: name, ShortName: name.slice(0, 6).trim(), IsActive: true, Street: name }));
  const units = [];
  SITE.forEach((p) => (p.units || []).forEach((u) => {
    if (p.pid === 9) return;                                             // its building is missing too
    units.push({ UnitID: u.uid, PropertyID: u.uid === 152 ? 5 : p.pid, Name: u.unit, UnitTypeID: 1, IsVacant: true });
  }));
  for (let i = 0; units.length < 2345; i++) units.push({ UnitID: 1000 + i, PropertyID: [1, 6, 8, 11, 13][i % 5], Name: `F${i}`, UnitTypeID: 2, IsVacant: false });
  const one = (key) => [{ [key]: 1, Name: 'Sample', CreateDate: '2026-01-01T00:00:00', UpdateDate: '2026-01-02T00:00:00' }];
  return {
    Properties: properties,
    Units: units,
    Tenants: [{ TenantID: 1, FirstName: 'Jane', LastName: 'Doe', Email: 'jane.doe@example.com', Phone: '585-555-0199', Balance: 1234.56 }],
    Prospects: [{ ProspectID: 1, FirstName: 'Pat', LastName: 'Prospect', Name: 'Pat Prospect', Email: 'pat@example.com' }],
    GLAccounts: [
      { GLAccountID: 1, Reference: '4000', Name: 'Rent Income', GLAccountType: 'Income', IsActive: true },
      { GLAccountID: 2, Reference: '1010', Name: 'CNB Operating 1234567890', GLAccountType: 'Bank', IsActive: true },
    ],
    ChargeTypes: [{ ChargeTypeID: 1, Name: 'Rent', Description: 'Monthly rent' }, { ChargeTypeID: 2, Name: '=HYPERLINK("http://x")', Description: '+1' }],
    Reports: [{ ReportID: 749, Name: 'Basic Owner Statement' }, { ReportID: 51, Name: 'General Ledger' }],
    Locations: [{ LocationID: 1, Name: 'Evolution24' }],
    Bills: [
      { BillID: 1, PostDate: '2026-09-01T00:00:00', Amount: 777.77, BillDetails: [{ PropertyID: 8, Amount: 777.77 }] },
      { BillID: 2, PostDate: '2026-08-15T00:00:00', Amount: 50, BillDetails: [{ PropertyID: 8 }, { PropertyID: 6 }] },
      { BillID: 3, PostDate: '2025-01-01T00:00:00', Amount: 10, BillDetails: [{ PropertyID: 1 }] },
    ],
    UnitTypes: one('UnitTypeID'), UnitStatusTypes: one('UnitStatusTypeID'), MarketRents: one('MarketRentID'), LeadSources: one('LeadSourceID'),
    ProspectStages: one('ProspectStageID'), Leases: one('LeaseID'), LeaseRenewals: one('LeaseRenewalID'), RecurringCharges: one('RecurringChargeID'),
    Charges: one('ChargeID'), Payments: one('PaymentID'), Credits: one('CreditID'), Deposits: one('DepositID'), SecurityDepositTypes: one('SecurityDepositTypeID'),
    RecurringBills: one('RecurringBillID'), Vendors: one('VendorID'), Checks: one('CheckID'), Journals: one('JournalID'), Owners: one('OwnerID'),
    ManagementFeesSetup: one('ManagementFeesSetupID'), ManagementFeeHistory: one('ManagementFeeHistoryID'), ServiceManagerIssues: one('ServiceManagerIssueID'),
    ServiceManagerStatuses: one('ServiceManagerStatusID'), ServiceManagerCategories: one('ServiceManagerCategoryID'), Inspections: one('InspectionID'),
    HistoryNotes: one('HistoryNoteID'), UserDefinedFields: one('UserDefinedFieldID'), Users: one('UserID'),
    Applications: [],                                                    // nothing found: 404
  };
}

function fakeRentManager(clock, options) {
  const o = Object.assign({ limit: 60, resetIn: 3000, denied: ['Budgets'], tokenLife: Infinity, failOnce: [], rejectBillEmbed: false }, options || {});
  const data = fakeData();
  const rm = { calls: [], tokens: new Map(), limit: o.limit, used: 0, resetAt: clock.now + o.resetIn * 1000, signIns: 0, failOnce: o.failOnce.slice() };
  const json = (status, body, extra) => ({ status, body: body === undefined ? '' : JSON.stringify(body), headers: extra || {} });
  const error = (status, words) => json(status, { DeveloperMessage: words, UserMessage: words });

  rm.handle = (method, url, headers, payload) => {
    const u = new URL(url);
    rm.calls.push({ method, path: u.pathname, query: u.search, headers });
    if (clock.now >= rm.resetAt) { rm.used = 0; rm.resetAt = clock.now + 3600 * 1000; }
    rm.used++;
    const limits = () => ({ 'X-RateLimit': String(rm.limit), 'X-RateRemaining': String(Math.max(0, rm.limit - rm.used)),
      'X-RateTimeLeft': String(Math.max(0, Math.round((rm.resetAt - clock.now) / 1000))) });
    const reply = (r) => { r.headers = Object.assign(limits(), r.headers); return r; };
    if (rm.used > rm.limit) return reply(error(429, 'Rate limit exceeded.'));
    const fail = rm.failOnce.findIndex((f) => f.path === u.pathname);
    if (fail >= 0) { const f = rm.failOnce.splice(fail, 1)[0]; return reply(error(f.status, 'Temporarily unavailable.')); }

    if (u.pathname === '/Authentication/AuthorizeUser') {
      assert.strictEqual(method, 'post');
      const body = JSON.parse(payload);
      rm.signIns++;
      rm.lastSignIn = body;
      if (body.Username !== USER || body.Password !== PASSWORD) return reply(error(401, 'Invalid user name or password.'));
      const token = `tok${rm.signIns}x${'9f'.repeat(14)}`;
      rm.tokens.set(token, rm.used);
      return reply(json(200, token));
    }
    const token = headers['X-RM12Api-ApiToken'];
    if (!token || !rm.tokens.has(token) || rm.used - rm.tokens.get(token) > o.tokenLife) return reply(error(401, 'Unable to authenticate - Invalid API Token.'));
    if (method !== 'get') return reply(error(405, 'Read-only test.'));

    const resource = u.pathname.slice(1);
    if (o.denied.includes(resource)) return reply(error(403, 'You do not have permission.'));
    if (!(resource in data)) return reply(error(404, 'No resource found that matches the request.'));
    let records = data[resource].map((r) => Object.assign({}, r));
    const q = u.searchParams;
    const embeds = (q.get('embeds') || '').split(',').filter(Boolean);
    for (const e of embeds) {
      if (resource !== 'Bills' || e !== 'BillDetails' || o.rejectBillEmbed) return reply(error(400, `Unknown embed ${e}.`));
    }
    if (resource === 'Bills' && !embeds.includes('BillDetails')) records.forEach((r) => delete r.BillDetails);
    for (const f of (q.get('filters') || '').split(';').filter(Boolean)) {
      const [field, op, value] = f.split(',');
      if (resource !== 'Bills' || field !== 'PostDate' || op !== 'ge') return reply(error(400, `Unknown filter ${field}.`));
      records = records.filter((r) => r.PostDate.slice(0, 10) >= value);
    }
    if (!records.length) return reply(error(404, 'No records found.'));
    const paged = q.has('pagenumber') || records.length > 1000;
    const size = Math.min(Number(q.get('pagesize') || 1000), 1000);
    const page = Number(q.get('pagenumber') || 1);
    const slice = paged ? records.slice((page - 1) * size, page * size) : records;
    const extra = {};
    if (paged) {
      extra['X-Total-Results'] = String(records.length);
      if (page * size < records.length) extra.Link = `<https://${HOST}/${resource}?pagenumber=${page + 1}&pagesize=${size}>; rel="next"`;
    }
    return reply(json(paged && slice.length < records.length ? 206 : 200, slice, extra));
  };
  return rm;
}

/* ---- Apps Script, in memory --------------------------------------------------------------- */
function appsScript(settings, rmOptions) {
  const clock = { now: START };
  const rm = fakeRentManager(clock, rmOptions);
  const props = new Map(Object.entries(settings));
  const logs = [];
  const sleeps = [];
  const books = [];
  const fetched = [];
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const book = (name) => {
    const tabs = [];
    const tab = (title) => {
      const cells = new Map();
      const t = { title, cells, values: () => { const out = []; cells.forEach((v, k) => { const [r, c] = k.split(',').map(Number); (out[r - 1] = out[r - 1] || [])[c - 1] = v; }); return out; } };
      const range = (r, c, nr, nc) => {
        const R = { setValues(rows) {
          assert.strictEqual(rows.length, nr, `${title}: ${rows.length} rows for a range of ${nr}`);
          rows.forEach((row, i) => { assert.strictEqual(row.length, nc, `${title} row ${i + 1}: ${row.length} values for ${nc} columns`); row.forEach((v, j) => cells.set(`${r + i},${c + j}`, v)); });
          return P; } };
        const P = new Proxy(R, { get: (x, k) => (k in x ? x[k] : () => P) });
        return P;
      };
      const S = new Proxy(Object.assign(t, {
        getName: () => t.title, setName: (n) => { t.title = n; return S; }, getLastRow: () => (cells.size ? 1 : 0),
        getRange: (r, c, nr = 1, nc = 1) => range(r, c, nr, nc),
      }), { get: (x, k) => (k in x ? x[k] : () => S) });
      return S;
    };
    const ss = { name, tabs, getSheets: () => tabs.slice(), insertSheet: (n) => { const s = tab(n); tabs.push(s); return s; }, getUrl: () => `https://docs.google.com/spreadsheets/d/fake${books.length}/edit` };
    tabs.push(tab('Sheet1'));
    books.push(ss);
    return ss;
  };
  const ctx = vm.createContext({
    Date: FakeDate,
    console: { log: (...a) => logs.push(a.join(' ')) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => { props.set(k, String(v)); }, deleteProperty: (k) => { props.delete(k); } }) },
    UrlFetchApp: { fetch: (url, params) => {
      fetched.push(url);
      assert.ok(url.startsWith(`https://${HOST}/`), `a request left Rent Manager: ${url}`);       // as the manifest's allowlist would
      const r = rm.handle(params.method, url, params.headers || {}, params.payload);
      return { getResponseCode: () => r.status, getContentText: () => r.body, getAllHeaders: () => r.headers };
    } },
    Utilities: {
      sleep: (ms) => { sleeps.push(ms); clock.now += ms; },
      formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd' ? new Date(d.getTime()).toISOString().slice(0, 10) : new Date(d.getTime()).toISOString()),
    },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    SpreadsheetApp: { create: (n) => book(n) },
  });
  vm.runInContext(`${CODE}\n;globalThis.__gs = { rmList, rmGet, rmUsage, checkRentManager, WEBSITE, PROBES, CHECK_RESERVE };`, ctx);
  return { gs: ctx.__gs, rm, props, logs, sleeps, books, fetched, clock };
}

const SETTINGS = { RM_COMPANY: 'evolution', RM_USERNAME: USER, RM_PASSWORD: PASSWORD };
const tabValues = (ss, title) => { const t = ss.tabs.find((x) => x.title === title); assert.ok(t, `no ${title} tab`); return t.values(); };
const everything = (env) => JSON.stringify(env.books.map((b) => b.tabs.map((t) => t.values()))) + env.logs.join('\n');
const throwsWith = (fn, re) => { try { fn(); } catch (e) { assert.match(e.message, re); return e; } throw new Error('it did not throw'); };

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok  ', name]); } catch (e) { results.push(['FAIL', `${name}: ${e.message}`]); } };

test('signs in with the user, password and location, sends the token, and keeps it for the next run', () => {
  const env = appsScript(SETTINGS);
  env.gs.rmList('Properties');
  env.gs.rmList('Locations');
  assert.deepStrictEqual(env.rm.lastSignIn, { Username: USER, Password: PASSWORD, LocationID: 1 });
  assert.strictEqual(env.rm.signIns, 1, 'one sign-in for two requests');
  const token = env.props.get('RM_TOKEN');
  assert.ok(token && token.startsWith('tok1'), 'the token is kept in the script properties');
  assert.ok(env.rm.calls.filter((c) => c.method === 'get').every((c) => c.headers['X-RM12Api-ApiToken'] === token));
});
test('a token Rent Manager no longer takes is replaced, once', () => {
  const env = appsScript(Object.assign({ RM_TOKEN: 'stale-token-0000000000' }, SETTINGS));
  assert.strictEqual(env.gs.rmList('Properties').length, 11);
  assert.strictEqual(env.rm.signIns, 1);
  assert.notStrictEqual(env.props.get('RM_TOKEN'), 'stale-token-0000000000');
});
test('a refused sign-in says which settings to check, and never shows the password', () => {
  const env = appsScript(Object.assign({}, SETTINGS, { RM_PASSWORD: 'Wrong-Password-77' }));
  const e = throwsWith(() => env.gs.rmList('Properties'), /refused the sign-in.*RM_PASSWORD/);
  assert.ok(!e.message.includes('Wrong-Password-77'));
  assert.strictEqual(env.props.get('RM_TOKEN'), undefined);
});
test('missing settings are named, and nothing is sent', () => {
  const env = appsScript({ RM_USERNAME: USER });
  throwsWith(() => env.gs.rmList('Properties'), /RM_COMPANY, RM_PASSWORD/);
  assert.strictEqual(env.rm.calls.length, 0);
});
test('long lists are read page by page to the end', () => {
  const env = appsScript(SETTINGS);
  const units = env.gs.rmList('Units');
  assert.strictEqual(units.length, 2345);
  assert.deepStrictEqual(env.rm.calls.filter((c) => c.path === '/Units').map((c) => c.query), [1, 2, 3].map((n) => `?pagenumber=${n}&pagesize=1000`));
});
test('nothing found is an empty list; with strict, an error', () => {
  const env = appsScript(SETTINGS);
  assert.deepStrictEqual(Array.from(env.gs.rmList('Applications')), []);
  const e = throwsWith(() => env.gs.rmList('Applications', { strict: true }), /Nothing found/);
  assert.strictEqual(e.status, 404);
});
test('no access is an error, in plain words', () => {
  const env = appsScript(SETTINGS);
  const e = throwsWith(() => env.gs.rmList('Budgets'), /may not see it/);
  assert.strictEqual(e.status, 403);
});
test('a brief Rent Manager outage is tried again', () => {
  const env = appsScript(SETTINGS, { failOnce: [{ path: '/Properties', status: 503 }] });
  assert.strictEqual(env.gs.rmList('Properties').length, 11);
  assert.ok(env.sleeps.length >= 1);
});
test('the hourly limit: a short wait for the reset, a clear stop for a long one', () => {
  const short = appsScript(SETTINGS, { limit: 3, resetIn: 40 });
  short.gs.rmList('Properties'); short.gs.rmList('Locations');            // sign-in + 2: none left
  assert.strictEqual(short.gs.rmUsage().remaining, 0);
  assert.strictEqual(short.gs.rmList('Reports').length, 2);                 // waits for the reset, then carries on
  assert.ok(short.sleeps.some((ms) => ms >= 40000));
  const long = appsScript(SETTINGS, { limit: 3, resetIn: 2000 });
  long.gs.rmList('Properties'); long.gs.rmList('Locations');
  const e = throwsWith(() => long.gs.rmList('Reports'), /limit is used up; it resets in about 33 minutes/);
  assert.strictEqual(e.status, 429);
});
test('the token goes only to this company\'s Rent Manager', () => {
  const env = appsScript(SETTINGS);
  throwsWith(() => env.gs.rmGet('https://elsewhere.example/steal'), /Not a Rent Manager resource/);
  throwsWith(() => env.gs.rmGet('../Units'), /Not a Rent Manager resource/);
  assert.strictEqual(env.rm.calls.length, 0);
});

const full = appsScript(SETTINGS);
const url = full.gs.checkRentManager();
const report = full.books[0];
test('the check writes its sheet: Summary, Buildings, Units, Resources, Accounts, Charge types, Reports', () => {
  assert.ok(/^https:\/\/docs\.google\.com\//.test(url));
  assert.deepStrictEqual(report.tabs.map((t) => t.title), ['Summary', 'Buildings', 'Units', 'Resources', 'Accounts', 'Charge types', 'Reports']);
  assert.ok(full.logs.some((l) => l.includes(url)), 'the log gives the address');
});
test('the check only reads: every request is a GET, but the sign-in', () => {
  assert.deepStrictEqual([...new Set(full.rm.calls.map((c) => (c.path === '/Authentication/AuthorizeUser' ? 'sign-in' : c.method)))].sort(), ['get', 'sign-in']);
});
test('the check matches buildings by Rent Manager ID, and says what differs', () => {
  const rows = tabValues(report, 'Buildings').slice(1);
  const by = (id) => rows.find((r) => r[0] === id);
  assert.strictEqual(by(8)[6], 'Same building');                             // "Water Street" ~ "168-172 N Water Street-ROC"
  assert.strictEqual(by(6)[6], 'Same building');                             // "145 South Fitzhugh" ~ "145 S Fitzhugh - ROC"
  assert.strictEqual(by(13)[6], 'Not on the website');                       // 357 Alexander
  assert.strictEqual(by(9)[6], 'On the website, not found in Rent Manager'); // The Biltmore
  assert.strictEqual(by(10)[6], 'Same ID; check the name');                  // "379 South Main" vs "379 Main St - Geneva"
  assert.strictEqual(by(8)[3], fakeData().Units.filter((u) => u.PropertyID === 8).length);
});
test('the check finds the website\'s units, and flags one in another building', () => {
  const rows = tabValues(report, 'Units').slice(1);
  assert.strictEqual(rows.find((r) => r[2] === 62)[4], 'Same unit');
  assert.strictEqual(rows.find((r) => r[2] === 152)[4], 'Found, but in another building');
  assert.strictEqual(rows.find((r) => r[2] === 128)[4], 'Not found in Rent Manager');
});
test('the check reports the limit, access, empties and recent bills per building', () => {
  const summary = Object.fromEntries(tabValues(report, 'Summary').slice(1));
  assert.match(summary['Hourly request limit'], /^60 an hour; \d+ left/);
  assert.match(summary['Bills posted since 2026-07-07'], /^2, so bills are entered in Rent Manager/);
  assert.match(summary['No access for this user'], /Budgets/);
  assert.match(summary['Nothing found (empty, or none this user may see)'], /Applications/);
  const resources = tabValues(report, 'Resources').slice(1);
  const tenants = resources.find((r) => r[1] === 'Tenants');
  assert.deepStrictEqual(tenants.slice(2, 4), ['Readable', 1]);
  assert.strictEqual(tenants[4], 'Balance, Email, FirstName, LastName, Phone, TenantID');
  assert.strictEqual(resources.length, 6 + full.gs.PROBES.length);
  const bills = Object.fromEntries(tabValues(report, 'Buildings').slice(1).map((r) => [r[0], r[4]]));
  assert.deepStrictEqual([bills[8], bills[6], bills[1]], [2, 1, 0]);
});
test('no personal details, amounts, password or token reach the sheet or the log', () => {
  const all = everything(full);
  for (const secret of [...PII, PASSWORD, full.props.get('RM_TOKEN')]) assert.ok(!all.includes(secret), `"${secret}" reached the report or log`);
  assert.ok(all.includes('CNB Operating •••90'), 'a long number in an account name is masked');
  assert.ok(all.includes('\'=HYPERLINK'), 'text that looks like a formula stays text');
});
test(`the check stops early, and says so, keeping ${5} requests in hand`, () => {
  const env = appsScript(SETTINGS, { limit: 20 });
  env.gs.checkRentManager();
  const summary = Object.fromEntries(tabValues(env.books[0], 'Summary').slice(1));
  assert.match(summary['Not checked yet'], /hourly request limit ran low; run the check again in about \d+ minutes/);
  assert.ok(env.rm.used <= 20 - env.gs.CHECK_RESERVE, `it used ${env.rm.used} of 20`);
  assert.ok(!env.rm.calls.some((c, i) => i >= 20), 'no request past the limit');
});
test('when Rent Manager names the bill details differently, the check still counts bills', () => {
  const env = appsScript(SETTINGS, { rejectBillEmbed: true });
  env.gs.checkRentManager();
  const summary = Object.fromEntries(tabValues(env.books[0], 'Summary').slice(1));
  assert.match(summary['Bills posted since 2026-07-07'], /^2, so bills are entered in Rent Manager$/);
});
test('when Rent Manager keeps refusing the token, the check stops instead of asking forty more times', () => {
  const env = appsScript(SETTINGS, { tokenLife: 0 });
  const e = throwsWith(() => env.gs.checkRentManager(), /Not signed in/);
  assert.strictEqual(e.status, 401);
  assert.ok(env.rm.used <= 4, `it sent ${env.rm.used} requests`);
  assert.strictEqual(env.books.length, 0, 'no half-written report');
});
test('the check knows every building and unit on the website, by Rent Manager ID', () => {
  const inside = JSON.parse(JSON.stringify(full.gs.WEBSITE.map((w) => [w.id, w.units.map((u) => u[0])])));   // out of the sandbox's own Array
  assert.deepStrictEqual(inside, SITE.map((p) => [p.pid, (p.units || []).map((u) => u.uid)]));
});

results.forEach(([s, n]) => console.log(s, n));
console.log(`\nThe full check used ${full.rm.used} requests of ${full.rm.limit}.`);
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
