// Tests scripts/availability.mjs against a stand-in for Rent Manager's Web API.
//   node scripts/test-availability.cjs
// No network, no dependencies. The stand-in serves made-up units for the website's own
// buildings, in the shapes Charlotte Square's live checks saw: occupancy records with an
// OccupancyType, unit statuses by name, market rents as an embed. Works on a copy of
// data/properties.json in a temporary folder; the real file is never touched.
'use strict';
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REAL = path.join(__dirname, '..', 'data', 'properties.json');
const TODAY = '2026-10-19';
const NOW = new Date('2026-10-19T15:00:00Z');

function listen(fn) {
  return new Promise((resolve) => { const s = http.createServer(fn); s.listen(0, '127.0.0.1', () => resolve(s)); });
}

// Made-up units: [UnitID, PropertyID, Name, beds, baths, sqft, rent, occupancy, unit status]
const vacant = { OccupancyType: 'Vacant' };
const occupied = { OccupancyType: 'Occupied' };
const UNITS = [
  [6, 1, '6', 2, 1, 0, 1950, vacant, 'Vacant-Unrented'],                       // 301 Central: rent changed
  [7, 1, '7', 1, 1, 0, 1500, occupied, 'Occupied'],                             // leased: stays off
  [34, 6, '1-1', 1, 1, 650, 1750, vacant, 'Ready'],                            // 145 South Fitzhugh
  [36, 6, '1-3', 1, 1, 650, 1365, { OccupancyType: 'Notice', ExpectedMoveOutDate: '2026-11-15T00:00:00' }, 'Notice-Unrented'],
  [39, 6, '2-2', 0, 1, 450, 1195, { OccupancyType: 'Notice', ExpectedMoveOutDate: '2026-11-15T00:00:00' }, 'Notice-Rented'],   // already leased
  [48, 6, '4-2', 0, 1, 450, 1600, vacant, 'Vacant-Rented'],                   // "Vacant-Rented": already leased
  [128, 9, '10-F', 0, 1, 365, 1595, vacant, 'Ready'],                          // Biltmore, furnished by name
  [129, 9, '11', 0, 1, 365, 1495, vacant, 'Model'],                            // a model: never for rent
  [130, 9, '12', 0, 1, 365, 0, vacant, 'Ready'],                               // open, but no rent
  [55, 5, '5', 2, 1, 0, 1425, vacant, 'Not Ready'],                            // 561 South Main: being made ready
  [152, 10, '2', 3, 1, 0, 3300, vacant, 'Ready'],                              // 379 South Main
  [26, 3, '4', 1, 1, 0, 1695, vacant, 'Ready'],                                // 121 Park Drive
  [27, 3, '5', 2, 1, 0, 1895, vacant, 'Ready'],                                // hidden by hand on the site
  [172, 11, '4E', 0, 0, 470, 1195, vacant, 'Ready'],                           // 181 St. Paul
  [185, 11, '6E', 0, 0, 520, 1200, vacant, 'Ready'],
  [2001, 2, '1', 2, 1, 0, 1300, vacant, 'Ready'],                              // 2215 James: something opens
  [62, 8, '103RV', 0, 1, 348, 1175, vacant, 'Ready'],                          // Water Street
  [64, 8, '105RV', 0, 1, 483, 1300, vacant, 'Ready'],
  [73, 8, '302RV', 1, 1, 619, 1590, vacant, 'Ready'],
  [85, 8, '502RV', 1, 1, 619, 1625, occupied, 'Occupied'],                     // leased since the last copy
  [12001, 12, '101', 2, 2, 1100, 2400, vacant, 'Ready'],                       // Charlotte Square: never touched
  [2101, 2, 'Garage 1', 0, 0, 0, 100, vacant, 'Ready'],                         // 2215 James: a garage, never a home
  [2102, 2, 'P4', 0, 0, 0, 150, vacant, 'Ready'],                               // parking by another name: too cheap
  [9, 1, '9', 1, 1, 0, 1395, { OccupancyType: 'Notice', ExpectedMoveOutDate: '2027-05-31T00:00:00' }, 'Notice-Unrented'],   // free in 7 months
];
// Plenty of leased units, so the open share stays under a quarter.
for (let i = 0; i < 80; i++) UNITS.push([5000 + i, 8, `X${i}`, 1, 1, 600, 1500, occupied, 'Occupied']);

function rmUnit([id, pid, name, beds, baths, sqft, rent, occ, status], ask) {
  const u = { UnitID: id, PropertyID: pid, Name: name, SortOrder: 0 };
  if (!ask.fields.length) return u;
  const want = (f) => ask.fields.includes(f);
  if (want('Bedrooms')) u.Bedrooms = beds;
  if (want('Bathrooms')) u.Bathrooms = baths;
  if (want('SquareFootage')) u.SquareFootage = sqft;
  const emb = (e) => ask.embeds.includes(e) && want(e);    // an embed comes back only when named in fields too
  if (emb('CurrentOccupancyStatus')) u.CurrentOccupancyStatus = occ;
  if (emb('CurrentUnitStatus')) u.CurrentUnitStatus = { Name: status };
  if (emb('CurrentMarketRent')) u.CurrentMarketRent = rent ? { Amount: rent, FromDate: '2026-01-01T00:00:00' } : null;
  if (emb('UnitType')) u.UnitType = { Name: beds ? `${beds}B/1B` : 'Studio', Bedrooms: beds };
  return u;
}

(async () => {
  const mod = await import(path.join(__dirname, 'availability.mjs'));
  const log = [];
  let refuse = new Set();         // embeds this stand-in refuses
  let users = { 'web-user': 'pw-correct' };
  let seen = [];
  const rm = await listen((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(req.method + ' ' + u.pathname + u.search);
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'X-RateRemaining': '500', 'X-RateTimeLeft': '1800', ...headers }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/Authentication/AuthorizeUser') {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => { const j = JSON.parse(b); users[j.Username] === j.Password ? send(200, 'token-abcdefgh-123') : send(401, { UserMessage: 'Invalid user name or password' }); });
      return;
    }
    if (req.headers['x-rm12api-apitoken'] !== 'token-abcdefgh-123') return send(401, { Message: 'Not signed in' });
    if (u.pathname !== '/Units') return send(404, { Message: 'Not found' });
    const fields = (u.searchParams.get('fields') || '').split(',').filter(Boolean);
    const embeds = (u.searchParams.get('embeds') || '').split(',').filter(Boolean);
    const bad = embeds.find((e) => refuse.has(e));
    if (bad) return send(400, { UserMessage: `Invalid embed: ${bad}` });
    const m = /^PropertyID,eq,(\d+)$/.exec(u.searchParams.get('filters') || '');
    const rows = UNITS.filter((x) => !m || x[1] === Number(m[1])).map((x) => rmUnit(x, { fields, embeds }));
    return rows.length ? send(200, rows, { 'X-Total-Results': String(rows.length) }) : send(404, { Message: 'No results' });
  });
  const env = { RM_USERNAME: 'web-user', RM_PASSWORD: 'pw-correct', RM_BASE_URL: `http://127.0.0.1:${rm.address().port}` };
  const copy = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e24-avail-'));
    const file = path.join(dir, 'properties.json');
    const data = JSON.parse(fs.readFileSync(REAL, 'utf8'));
    // The live list changes with Rent Manager; the tests start from the one they were written against.
    const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-availability-units.json'), 'utf8'));
    data.units_as_of = before.units_as_of;
    for (const p of data.properties) if (before.units[p.slug]) p.units = JSON.parse(JSON.stringify(before.units[p.slug]));
    data.properties.find((p) => p.slug === '121-park-drive').hide_units = ['5'];
    data.properties.find((p) => p.slug === 'biltmore').units[0].note = 'Furnished';
    fs.writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
    return file;
  };
  const run = (file, argv = [], over = {}) => { log.length = 0; seen = []; return mod.run({ env: { ...env, ...over }, argv, file, now: NOW, log: (s) => log.push(s) }); };
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const units = (data, slug) => data.properties.find((p) => p.slug === slug).units;

  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);

  test('reads each building and writes what is open', async () => {
    const file = copy();
    const out = await run(file);
    assert.equal(out.written, true);
    const d = read(file);
    assert.equal(d.units_as_of, TODAY);
    assert.deepEqual(units(d, '301-central-avenue'), [{ uid: 6, unit: '6', beds: 2, baths: 1, rent: 1950 }]);
    assert.deepEqual(units(d, '2215-james-street').map((u) => u.unit), ['1']);
    assert.deepEqual(units(d, 'water-street').map((u) => u.unit), ['103RV', '105RV', '302RV']);
    assert.ok(log.join('\n').includes('502RV: no longer open'));
    assert.ok(log.join('\n').includes('6: $1,900 → $1,950'));
  });

  test('vacant-rented and notice-rented units are already leased; a model is never for rent', async () => {
    const file = copy();
    await run(file);
    const d = read(file);
    assert.deepEqual(units(d, '145-south-fitzhugh-street').map((u) => u.unit), ['1-1', '1-3']);
    assert.deepEqual(units(d, 'biltmore').map((u) => u.unit), ['10']);
  });

  test('a unit on notice opens on its move-out date; one being made ready is open now', async () => {
    const file = copy();
    await run(file);
    const d = read(file);
    const notice = units(d, '145-south-fitzhugh-street').find((u) => u.unit === '1-3');
    assert.equal(notice.available, '2026-11-15');
    assert.ok(!('available' in units(d, '145-south-fitzhugh-street').find((u) => u.unit === '1-1')));
    assert.deepEqual(units(d, '561-south-main-street').map((u) => u.unit), ['5']);
  });

  test('"-F" means furnished; what was typed by hand stays', async () => {
    const file = copy();
    await run(file);
    const b = units(read(file), 'biltmore')[0];
    assert.equal(b.unit, '10');
    assert.equal(b.note, 'Furnished');
    assert.equal(b.uid, 128);
  });

  test('hide_units keeps a unit off; a unit with no rent is left off and named', async () => {
    const file = copy();
    await run(file);
    const d = read(file);
    assert.deepEqual(units(d, '121-park-drive').map((u) => u.unit), ['4']);
    assert.ok(log.some((l) => /Left off: The Biltmore unit 12: open, but no market rent/.test(l)));
  });

  test('only homes, and only soon: no garage, nothing under $300, nothing more than 90 days off', async () => {
    const file = copy();
    await run(file);
    const james = units(read(file), '2215-james-street').map((u) => u.unit);
    assert.deepStrictEqual(james, ['1']);
    assert.ok(!log.some((l) => /Garage/.test(l)), 'a garage is not even reported');
    assert.ok(log.some((l) => /Left off: 2215 James Street unit P4: open at \$150 a month, too little for a home/.test(l)));
    assert.ok(!units(read(file), '301-central-avenue').some((u) => u.unit === '9'));
    assert.ok(log.some((l) => /Left off: 301 Central Avenue unit 9: free from 2027-05-31, more than 90 days off/.test(l)));
  });

  test('Charlotte Square, with its own site, is never touched', async () => {
    const file = copy();
    const before = read(file).properties.find((p) => p.slug === 'charlotte-square');
    await run(file);
    assert.deepEqual(read(file).properties.find((p) => p.slug === 'charlotte-square'), before);
    assert.ok(!seen.some((s) => s.includes('PropertyID,eq,12')));
  });

  test('asks for the embeds by name in fields too, and only reads', async () => {
    const file = copy();
    await run(file);
    const q = seen.find((s) => s.startsWith('GET /Units'));
    for (const e of ['UnitType', 'CurrentOccupancyStatus', 'CurrentUnitStatus', 'CurrentMarketRent']) {
      assert.ok(decodeURIComponent(q).includes(`embeds=`) && new URL('http://x' + q.slice(4)).searchParams.get('fields').split(',').includes(e), e);
    }
    assert.ok(seen.every((s) => s.startsWith('GET ') || s.startsWith('POST /Authentication/')));
  });

  test('an embed this Rent Manager refuses is dropped, and the rest still work', async () => {
    refuse = new Set(['UnitStatuses']);
    try {
      const file = copy();
      await run(file);
      assert.ok(log[0].includes('It took only these embeds'));
      assert.deepEqual(units(read(file), 'water-street').map((u) => u.unit), ['103RV', '105RV', '302RV']);
    } finally { refuse = new Set(); }
  });

  test('a dry run writes nothing', async () => {
    const file = copy();
    const before = fs.readFileSync(file, 'utf8');
    await run(file, ['--dry-run']);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.ok(log.includes('Dry run: nothing written.'));
  });

  test('a wrong password stops it, says so, and never prints the password', async () => {
    const file = copy();
    const before = fs.readFileSync(file, 'utf8');
    await assert.rejects(run(file, [], { RM_PASSWORD: 'pw-wrong-secret' }), (e) => /did not accept the login/.test(e.message) && !e.message.includes('pw-wrong-secret'));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });

  test('nothing open anywhere is not written unless allowed', async () => {
    const saved = UNITS.splice(0, UNITS.length, ...UNITS.map((u) => [...u.slice(0, 7), occupied, 'Occupied']));
    try {
      const file = copy();
      const before = fs.readFileSync(file, 'utf8');
      await assert.rejects(run(file), /nothing open anywhere/);
      assert.equal(fs.readFileSync(file, 'utf8'), before);
      await run(file, ['--allow-empty']);
      assert.equal(read(file).properties.filter((p) => !p.external).reduce((s, p) => s + p.units.length, 0), 0);
    } finally { UNITS.splice(0, UNITS.length, ...saved); }
  });

  test('more than a quarter open is held for a person', async () => {
    const saved = UNITS.splice(0, UNITS.length, ...UNITS.map((u) => (u[0] >= 5000 && u[0] < 5060 ? [...u.slice(0, 7), vacant, 'Ready'] : u)));
    try {
      const file = copy();
      await assert.rejects(run(file), /more than a quarter/);
      await run(file, ['--allow-many']);
    } finally { UNITS.splice(0, UNITS.length, ...saved); }
  });

  test('the file keeps its format: one-space indent, a final newline, the same keys', async () => {
    const file = copy();
    await run(file);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.endsWith('}\n') && text.startsWith('{\n "_about"'));
    const a = read(file), b = JSON.parse(fs.readFileSync(REAL, 'utf8'));
    assert.deepEqual(Object.keys(a), Object.keys(b));
    assert.equal(a.properties.length, b.properties.length);
  });

  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
  }
  rm.close();
  console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
