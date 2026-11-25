// Tests the lease worksheet's link to the website, with made-up rows (no real tenant data):
//   node scripts/test-lease-sheet.cjs
// 1. tools/lease-sheet/Vacancies.gs reads a tab the way the team keeps it.
// 2. scripts/fetch-vacancies.mjs asks a stand-in web app (which answers through a redirect,
//    as Apps Script's does), checks the answer, and keeps the last one when anything is wrong.
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e24-lease-'));
fs.copyFileSync(path.join(__dirname, '..', 'tools', 'lease-sheet', 'Vacancies.gs'), path.join(dir, 'Vacancies.cjs'));
const gs = require(path.join(dir, 'Vacancies.cjs'));

const HEAD = ['Apartment #', 'Tenant Name', 'Phone Number', 'Rent Amount', 'Total Amount Due', '# of Beds', 'August', 'September', 'October', 'November'];
const TAB = [
  HEAD,
  ['', '', '', '', '', '', '', '', '', ''],
  [101, 'VACANT', '', 1200, 1495, 1295, 1200, 'VACANT', 'VACANT', ''],          // tenant cell VACANT: vacant, at its Total Amount Due
  [102, 'A Tenant', '555', 1300, 1400, 1300, 'VACANT', 'VACANT', 'VACANT', ''],  // a name: taken, whatever the months say
  [103, '', '', 1100, 1250, 1100, 1100, 1100, 'VACANT', ''],                     // blank, latest month VACANT: vacant
  [104, '', '', 1100, 1250, 1100, 'VACANT', 1100, 1100, ''],                     // blank, paid since: taken
  [new Date(2024, 2, 1), 'VACANT', '', 900, 1020, 900, '', '', '', ''],         // "1-3", turned into 1 March by Sheets
  ['Spot 8', 'VACANT', '', 50, 50, '', '', '', '', ''],                          // parking: never a home
  ['105-F', 'VACANT', '', 1700, '', '', '', '', '', ''],                         // no rent in the sheet: null
  [14, 'VACANT', '', 1850, 1850, 'Commercial', '', '', '', ''],                  // a shop, by its "# of Beds": never a home
  ['TOTAL', '', '', '', '', '', '', '', '', ''],
];

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('the tenant cell decides; a blank one falls back to the latest month; homes only; dates read back', () => {
  const got = gs.readBuilding_(TAB, { tab: 'Test' }, 11);
  assert.deepStrictEqual(got, [
    { unit: '101', rent: 1495 }, { unit: '103', rent: 1250 }, { unit: '1-3', rent: 1020 }, { unit: '105-F', rent: null },
  ]);
});

test('a month heading is a month; "Max Market" is not March', () => {
  assert.strictEqual(gs.monthOf_('November'), 11);
  assert.strictEqual(gs.monthOf_('PAID August 2025'), 8);
  assert.strictEqual(gs.monthOf_(new Date(2025, 8, 1)), 9);
  assert.strictEqual(gs.monthOf_('Max Market (unfurnished)'), 0);
});

test('two buildings on one tab are read apart', () => {
  const tab = [['Unit', 'Tenant Name', 'Total Rent charged', 'November'], [1, 'VACANT', 1000, ''], [2, 'Tenant', 1100, 1100],
    ['379 Main St', '', '', ''], ['Unit', 'Tenant Name', 'Total Rent charged', 'November'], [1, 'Tenant', 900, 900], [2, 'VACANT', 2200, '']];
  assert.deepStrictEqual(gs.readBuilding_(tab, { tab: 'x', until: '379 Main' }, 11), [{ unit: '1', rent: 1000 }]);
  assert.deepStrictEqual(gs.readBuilding_(tab, { tab: 'x', block: '379 Main' }, 11), [{ unit: '2', rent: 2200 }]);
});

(async () => {
  const { fetchVacancies, checked } = await import(path.join(__dirname, 'fetch-vacancies.mjs'));
  let reply = { as_of: '2026-11-25', buildings: { 'water-street': [{ unit: '203', rent: 1600 }] } };
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/exec')) {             // Apps Script answers a POST with a redirect to the result
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { seen.push(JSON.parse(body)); res.writeHead(302, { Location: '/echo' }); res.end(); });
      return;
    }
    const token = seen.length && seen[seen.length - 1].token;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(token === 'right' ? reply : { error: 'Wrong token.' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/exec`;
  const file = path.join(dir, 'vacancy-sheet.json');
  const logs = [];
  const run = (env) => fetchVacancies({ env, file, log: (s) => logs.push(s) });

  test('the answer is saved, with the token sent in the body', async () => {
    assert.strictEqual(await run({ VACANCY_SHEET_URL: url, VACANCY_SHEET_TOKEN: 'right' }), true);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepStrictEqual(saved.buildings, { 'water-street': [{ unit: '203', rent: 1600 }] });
    assert.strictEqual(saved.as_of, '2026-11-25');
    assert.deepStrictEqual(seen[seen.length - 1], { token: 'right' });
  });

  test('a wrong token, or an answer of the wrong shape, keeps the last answer', async () => {
    const before = fs.readFileSync(file, 'utf8');
    assert.strictEqual(await run({ VACANCY_SHEET_URL: url, VACANCY_SHEET_TOKEN: 'wrong' }), false);
    assert.ok(logs.at(-1).includes('Wrong token'));
    reply = { as_of: '2026-11-26', buildings: { 'water-street': [{ unit: '<script>', rent: 1 }] } };
    assert.strictEqual(await run({ VACANCY_SHEET_URL: url, VACANCY_SHEET_TOKEN: 'right' }), false);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.throws(() => checked({ buildings: {} }), /no date/);
  });

  test('without the settings it does nothing', async () => {
    assert.strictEqual(await run({}), false);
    assert.ok(logs.at(-1).includes('not connected'));
  });

  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
  }
  server.close();
  console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
