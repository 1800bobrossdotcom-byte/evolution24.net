// The labor report (tools/pay-log/Report.gs) against pay logs made by tools/pay-log/make.py.
//   node scripts/test-pay-report.cjs                 (makes the pay logs first: needs Python and LibreOffice Calc)
//   PAY_FIXTURE=fixture.json node scripts/test-pay-report.cjs
//   PREVIEW=dir node scripts/test-pay-report.cjs     also draws each tab to dir/*.png (needs Playwright)
// Runs the real script with Apps Script's services replaced by strict in-memory stand-ins: any
// method the stand-ins don't have (and so, as far as they know, Apps Script doesn't either) fails
// the test. The pay logs are real ones, filled in and calculated by LibreOffice, read cell by cell,
// so the report is tested against the layout make.py actually writes. Every table is checked
// against sums worked out here from the entries alone.
'use strict';
process.env.TZ = 'UTC';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// The logo goes in at build time (scripts/build.py); before that, put it in here.
const CODE = fs.readFileSync(path.join(ROOT, 'tools', 'pay-log', 'Report.gs'), 'utf8')
  .replace("const LOGO_PNG = '';", () => `const LOGO_PNG = '${fs.readFileSync(path.join(ROOT, 'source', 'logo', 'sheet-logo.png')).toString('base64')}';`);
const SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let fixture = process.env.PAY_FIXTURE;
if (!fixture) {
  fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pay-report-')), 'fixture.json');
  execFileSync('python3', [path.join(ROOT, 'tools', 'pay-log', 'test.py'), '--fixture', fixture], { stdio: 'inherit' });
}
const LOGS = JSON.parse(fs.readFileSync(fixture, 'utf8'));

/* ---- strict stand-ins ------------------------------------------------------------------ */
function strict(obj, name) {
  return new Proxy(obj, {
    get(t, k) {
      if (typeof k === 'symbol' || k in t) return t[k];
      throw new Error(`${name}.${String(k)} is not part of the stand-in (is it real Apps Script?)`);
    },
  });
}

class Sheet {
  constructor(name, rows = 1000, cols = 26) {
    Object.assign(this, { name, maxRows: rows, maxCols: cols, cells: new Map(), merges: [], charts: [], images: [],
      widths: {}, heights: {}, frozen: 0, gridlines: true, tab: null });
  }
  cell(r, c) {
    const k = `${r},${c}`;
    if (!this.cells.has(k)) this.cells.set(k, { value: '', fmt: {} });
    return this.cells.get(k);
  }
  peek(r, c) { return (this.cells.get(`${r},${c}`) || { value: '' }).value; }
  api(ss) {
    const sheet = this;
    const range = (r, c, nr = 1, nc = 1) => {
      assert(Number.isInteger(r) && Number.isInteger(c) && r >= 1 && c >= 1 && nr >= 1 && nc >= 1, `bad range ${r},${c},${nr},${nc}`);
      assert(r + nr - 1 <= sheet.maxRows && c + nc - 1 <= sheet.maxCols,
        `range ${r},${c},${nr},${nc} is outside the sheet (${sheet.maxRows} x ${sheet.maxCols})`);
      const each = (fn) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fn(sheet.cell(r + i, c + j), i, j); };
      const fmt = (key) => (v) => { each((cell) => { cell.fmt[key] = v; }); return api; };
      const put = (v) => {
        if (typeof v === 'string' && v.startsWith("'")) return { value: v.slice(1), text: true };
        if (typeof v === 'string' && v.startsWith('=')) return { value: v, formula: true };
        return { value: v };
      };
      const api = strict({
        r, c, nr, nc, sheet,
        getValue: () => sheet.peek(r, c),
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sheet.peek(r + i, c + j))),
        setValue: (v) => { each((cell) => Object.assign(cell, put(v))); return api; },
        setValues: (rows) => {
          assert(Array.isArray(rows) && rows.length === nr && rows.every((row) => row.length === nc),
            `setValues: ${rows.length} x ${rows[0] && rows[0].length} into ${nr} x ${nc}`);
          rows.forEach((row) => row.forEach((v) => assert(['string', 'number', 'boolean'].includes(typeof v)
            || Object.prototype.toString.call(v) === '[object Date]', `setValues: can't set ${v}`)));
          each((cell, i, j) => { cell.formula = cell.text = false; Object.assign(cell, put(rows[i][j])); });
          return api;
        },
        setNumberFormat: fmt('numberFormat'), setBackground: fmt('background'), setFontColor: fmt('fontColor'),
        setFontWeight: fmt('fontWeight'), setFontSize: fmt('fontSize'), setFontFamily: fmt('fontFamily'),
        setFontStyle: fmt('fontStyle'), setHorizontalAlignment: fmt('align'), setVerticalAlignment: fmt('valign'),
        setWrap: fmt('wrap'), setDataValidation: fmt('validation'),
        setBorder: (...a) => { assert.strictEqual(a.length, 8, 'setBorder takes 8 arguments'); return fmt('border')(a[6]); },
        merge: () => {
          assert(nr * nc > 1, 'merging one cell');
          sheet.merges.forEach((m) => assert(!(m.r < r + nr && r < m.r + m.nr && m.c < c + nc && c < m.c + m.nc),
            'merging over a merge: Sheets refuses'));
          sheet.merges.push({ r, c, nr, nc });
          return api;
        },
        breakApart: () => {
          sheet.merges = sheet.merges.filter((m) => !(m.r >= r && m.c >= c && m.r + m.nr <= r + nr && m.c + m.nc <= c + nc));
          return api;
        },
      }, 'Range');
      return api;
    };
    const a1 = (ref) => {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      assert(m, `A1 reference ${ref}`);
      return range(Number(m[2]), m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0));
    };
    const builder = () => {
      const spec = { ranges: [], options: {} };
      const b = strict({
        setChartType: (t) => { assert(t, 'chart type'); spec.type = t; return b; },
        addRange: (rg) => { spec.ranges.push(rg); return b; },
        setNumHeaders: (n) => { spec.headers = n; return b; },
        setPosition: (row, col, x, y) => { spec.position = { row, col, x, y }; return b; },
        setOption: (k, v) => { spec.options[k] = v; return b; },
        build: () => strict({ spec, getRanges: () => spec.ranges }, 'EmbeddedChart'),
      }, 'EmbeddedChartBuilder');
      return b;
    };
    return strict({
      getName: () => sheet.name,
      getRange: (...a) => (typeof a[0] === 'string' ? a1(a[0]) : range(...a)),
      getLastRow: () => Math.max(0, ...[...sheet.cells].filter(([, v]) => v.value !== '').map(([k]) => Number(k.split(',')[0]))),
      getLastColumn: () => Math.max(0, ...[...sheet.cells].filter(([, v]) => v.value !== '').map(([k]) => Number(k.split(',')[1]))),
      getMaxRows: () => sheet.maxRows,
      getMaxColumns: () => sheet.maxCols,
      insertRowsAfter: (after, n) => { sheet.maxRows += n; },
      insertColumnsAfter: (after, n) => { sheet.maxCols += n; },
      clear: () => { sheet.cells.clear(); },
      setHiddenGridlines: (v) => { sheet.gridlines = !v; },
      setColumnWidth: (col, px) => { sheet.widths[col] = px; },
      setRowHeight: (row, px) => { sheet.heights[row] = px; },
      setFrozenRows: (n) => { sheet.frozen = n; },
      setTabColor: (c) => { sheet.tab = c; },
      newChart: builder,
      insertChart: (chart) => { sheet.charts.push(chart); },
      getCharts: () => sheet.charts.slice(),
      removeChart: (chart) => { sheet.charts = sheet.charts.filter((c) => c !== chart); },
      getImages: () => sheet.images.slice(),
      insertImage: (blob, col, row, x, y) => {
        const img = strict({ blob, col, row,
          setWidth: (w) => { img.w = w; return img; }, setHeight: (h) => { img.h = h; return img; },
          remove: () => { sheet.images = sheet.images.filter((i) => i !== img); } }, 'OverGridImage');
        sheet.images.push(img);
        return img;
      },
    }, 'Sheet');
  }
}

class Book {
  constructor(id, sheets) { this.id = id; this.sheets = sheets; this.toasts = []; }
  api() {
    const book = this;
    return strict({
      getId: () => book.id,
      getSheetByName: (n) => { const s = book.sheets.find((x) => x.name === n); return s ? s.api(book) : null; },
      getSheets: () => book.sheets.map((s) => s.api(book)),
      insertSheet: (name, index) => {
        assert(!book.sheets.some((s) => s.name === name), `a sheet called ${name} already exists`);
        const s = new Sheet(name);
        book.sheets.splice(index, 0, s);
        return s.api(book);
      },
      deleteSheet: (s) => { assert(book.sheets.length > 1, 'cannot delete the only sheet'); book.sheets = book.sheets.filter((x) => x.name !== s.getName()); },
      getSpreadsheetTimeZone: () => 'America/New_York',
      toast: (m) => { book.toasts.push(m); },
    }, 'Spreadsheet');
  }
}

/** A pay log as Sheets would hand it to the script: rows from the fixture, dates as Dates, blanks as ''. */
function payLogBook(id, rows) {
  const sheet = new Sheet('Pay log', rows.length, 6);
  rows.forEach((row, i) => row.forEach((v, j) => {
    if (v === null || v === undefined) return;
    sheet.cell(i + 1, j + 1).value = v && v.date ? new Date(`${v.date}T00:00:00Z`) : v;
  }));
  return new Book(id, [sheet, new Sheet('Weekly summary'), new Sheet('Monthly summary')]);
}

/** A small pay log written here, for people the fixture doesn't have. */
function syntheticLog(name, lines) {
  const rows = Array.from({ length: 10 + lines.length }, () => Array(6).fill(null));
  rows[4] = ['Person', name, null, null, null, null];
  lines.forEach(([day, prop, hours, pay], i) => { rows[10 + i] = [{ date: day }, prop, hours, pay, null, { date: day }]; });
  return rows;
}

/**
 * Drive laid out like the Pay Logs shared drive: the report in Accounting, each pay log in a
 * folder of its own (one two folders down), the template and odds and ends in another, and a pay
 * log outside the drive that must not be read.
 */
function world(logs) {
  const report = new Book('report', [new Sheet('Sheet1')]);
  const books = { report };
  const folders = {};
  const folder = (id, parent) => { folders[id] = { id, parent, files: [] }; return folders[id]; };
  folder('drive', null);
  folder('accounting', 'drive').files.push({ id: 'report', name: 'Evolution24 Labor Report', mime: SHEETS_MIME });
  logs.forEach((log, i) => {
    const id = `log${i}`;
    books[id] = payLogBook(id, log.rows);
    const home = i === 0 ? folder('nested', folder('person0', 'drive').id) : folder(`person${i}`, 'drive');
    home.files.push({ id, name: log.name, mime: SHEETS_MIME });
  });
  books.template = payLogBook('template', syntheticLog('', []));
  books.elsewhere = payLogBook('elsewhere', syntheticLog('Not Ours', [['2026-10-12', 'Water Street', 5, 100]]));
  books.broken = new Book('broken', [new Sheet('Sheet1')]);
  folder('misc', 'drive').files.push({ id: 'template', name: 'Evolution24 Pay Log - Template', mime: SHEETS_MIME },
    { id: 'xlsx', name: 'Evolution24 Pay Log - Alex Test.xlsx', mime: XLSX_MIME },
    { id: 'budget', name: 'Budget 2026', mime: SHEETS_MIME },
    { id: 'broken', name: 'Evolution24 Pay Log - Broken', mime: SHEETS_MIME });
  folder('other-drive', null).files.push({ id: 'elsewhere', name: 'Evolution24 Pay Log - Not Ours', mime: SHEETS_MIME });
  const files = new Proxy({}, { get: (_, id) => Object.values(folders).flatMap((f) => f.files.map((x) => ({ ...x, folder: f.id })))
    .find((x) => x.id === id) });
  const opened = [];
  const props = {};
  const triggers = [];
  const menus = [];
  const iterator = (items) => { let i = 0; return strict({ hasNext: () => i < items.length, next: () => items[i++] }, 'Iterator'); };
  const folderApi = (f) => strict({
    getId: () => f.id,
    getParents: () => iterator(f.parent ? [folderApi(folders[f.parent])] : []),
    getFolders: () => iterator(Object.values(folders).filter((x) => x.parent === f.id).map(folderApi)),
    getFilesByType: (mime) => iterator(f.files.filter((x) => x.mime === mime).map((x) => fileApi({ ...x, folder: f.id }))),
  }, 'Folder');
  const fileApi = (f) => strict({ getId: () => f.id, getName: () => f.name, getUrl: () => `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
    getParents: () => iterator([folderApi(folders[f.folder])]) }, 'File');
  const addLog = (id, name, rows, home) => {
    books[id] = payLogBook(id, rows);
    (folders[home] || folder(home, 'drive')).files.push({ id, name, mime: SHEETS_MIME });
  };
  const pad = (n) => String(n).padStart(2, '0');
  const sandbox = {
    SpreadsheetApp: strict({
      getActiveSpreadsheet: () => report.api(),
      openById: (id) => { opened.push(id); assert(books[id], `no spreadsheet ${id}`); return books[id].api(); },
      getUi: () => strict({ createMenu: (name) => {
        const menu = { name, items: [] };
        const m = strict({ addItem: (label, fn) => { menu.items.push([label, fn]); return m; }, addToUi: () => { menus.push(menu); } }, 'Menu');
        return m;
      } }, 'Ui'),
      newDataValidation: () => {
        const v = strict({ requireDate: () => v, setAllowInvalid: () => v, build: () => 'date' }, 'DataValidationBuilder');
        return v;
      },
      BorderStyle: { SOLID: 'SOLID' },
    }, 'SpreadsheetApp'),
    DriveApp: strict({ getFileById: (id) => fileApi(files[id]) }, 'DriveApp'),
    MimeType: { GOOGLE_SHEETS: SHEETS_MIME },
    Charts: { ChartType: { BAR: 'BAR', COLUMN: 'COLUMN' } },
    Utilities: strict({
      formatDate: (d, tz, pattern) => {
        assert(Object.prototype.toString.call(d) === '[object Date]', 'formatDate needs a Date');
        if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (pattern === 'EEE M/d/yy h:mm a') return 'Mon 10/12/26 9:00 AM';
        throw new Error(`formatDate pattern ${pattern}`);
      },
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      base64Decode: (s) => Buffer.from(s, 'base64'),
    }, 'Utilities'),
    PropertiesService: strict({ getDocumentProperties: () => strict({
      getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }, 'Properties') }, 'PropertiesService'),
    LockService: strict({ getDocumentLock: () => strict({ tryLock: () => true, releaseLock: () => {} }, 'Lock') }, 'LockService'),
    ScriptApp: strict({
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: (fn) => strict({ timeBased: () => strict({ everyHours: (n) => strict({ create: () => {
        const t = strict({ getHandlerFunction: () => fn, hours: n }, 'Trigger');
        triggers.push(t);
        return t;
      } }, 'ClockTriggerBuilder') }, 'ClockTriggerBuilder') }, 'TriggerBuilder'),
    }, 'ScriptApp'),
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);
  return { sandbox, report, books, addLog, opened, props, triggers, menus };
}

/* ---- what the report should say, from the entries alone -------------------------------- */
const weekEnding = (day) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7)); return d.toISOString().slice(0, 10); };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (day) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

function expectedLines(logs) {
  const out = [];
  logs.forEach((log) => {
    const person = log.person;
    const week = {};
    log.entries.forEach(([day, , h]) => { week[weekEnding(day)] = (week[weekEnding(day)] || 0) + h; });
    log.entries.forEach(([day, prop, h]) => {
      const pay = !log.rate ? 0 : log.per === 'week' ? log.rate * h / week[weekEnding(day)] : log.rate * h;
      out.push({ person, day, property: prop || '(no property)', hours: h, pay });
    });
  });
  return out;
}

function sums(lines, key, value) {
  const out = {};
  lines.forEach((l) => { const k = key(l); out[k] = (out[k] || 0) + l[value]; });
  return out;
}

/* ---- reading the report back ----------------------------------------------------------- */
function findRow(sheet, text) {
  for (let r = 1; r <= sheet.maxRows; r++) if (sheet.peek(r, 1) === text) return r;
  return 0;
}

/** The table under a heading: { columns: [...], rows: { label: [values] }, total: [...] }. */
function table(sheet, heading) {
  const h = findRow(sheet, heading);
  assert(h, `no "${heading}" on ${sheet.name}`);
  const columns = [];
  for (let c = 2; sheet.peek(h + 1, c) !== ''; c++) columns.push(sheet.peek(h + 1, c));
  const rows = {};
  let r = h + 2;
  for (; sheet.peek(r, 1) !== 'Total'; r++) {
    assert(sheet.peek(r, 1) !== '', `${heading}: ran off the table at row ${r}`);
    rows[sheet.peek(r, 1)] = columns.map((_, i) => sheet.peek(r, i + 2));
  }
  return { header: h + 1, columns, rows, total: columns.map((_, i) => sheet.peek(r, i + 2)), totalRow: r };
}

function close(a, b, label) {
  assert(Math.abs(a - b) < 0.005, `${label}: got ${a}, expected ${b}`);
}

function checkMatrix(sheet, heading, lines, rowKey, value) {
  const t = table(sheet, heading);
  const cell = {};
  lines.forEach((l) => { const k = `${rowKey(l)}|${l.person}`; cell[k] = (cell[k] || 0) + l[value]; });
  const rowKeys = Object.keys(sums(lines, rowKey, value));
  assert.deepStrictEqual(Object.keys(t.rows).sort(), rowKeys.sort(), `${heading}: rows`);
  Object.entries(t.rows).forEach(([row, values]) => {
    t.columns.slice(0, -1).forEach((person, i) => close(values[i], cell[`${row}|${person}`] || 0, `${heading} ${row} / ${person}`));
    close(values[values.length - 1], values.slice(0, -1).reduce((a, b) => a + b, 0), `${heading} ${row} total`);
  });
  close(t.total[t.total.length - 1], lines.reduce((a, l) => a + l[value], 0), `${heading} grand total`);
  return t;
}

/* ---- the tests ------------------------------------------------------------------------- */
const PALETTE = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#6250D6', '#E34948'];
const SERIES_OF = (map, person) => (map[person] >= 0 ? PALETTE[map[person]] : '#8C8A80');
const ALL = expectedLines(LOGS);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
let preview = null;

test('reads the pay logs in every folder of the drive, skips the rest, and lays out its three tabs', () => {
  const w = world(LOGS);
  w.sandbox.refreshReport();
  assert.deepStrictEqual(w.report.sheets.map((s) => s.name), ['Report', 'By month', 'Data'], 'tabs, and Sheet1 gone');
  assert.deepStrictEqual(w.opened.sort(), ['broken', 'log0', 'log1', 'log2', 'log3'],
    'opens the pay logs in every folder of the drive (one two folders down), and nothing else: not the template, the xlsx, '
    + 'the budget, itself, or a pay log in another drive');
  const data = w.report.sheets[2];
  const rows = [];
  for (let r = 2; data.peek(r, 1) !== ''; r++) rows.push([1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => data.peek(r, c)));
  assert.strictEqual(rows.length, ALL.length, 'one Data row per line');
  close(rows.reduce((a, r) => a + r[6], 0), ALL.reduce((a, l) => a + l.hours, 0), 'Data hours');
  close(rows.reduce((a, r) => a + r[7], 0), ALL.reduce((a, l) => a + l.pay, 0), 'Data pay');
  assert.deepStrictEqual([...new Set(rows.filter((r) => r[0] === 'Alex Test').map((r) => r[1]))].sort(), ['Maintenance', 'Management'], 'roles');
  const injected = rows.find((r) => String(r[5]).startsWith('=HYPERLINK'));
  assert(injected, 'the odd property name is there');
  const cell = [...data.cells.values()].find((c) => c.value === injected[5]);
  assert(cell.text && !cell.formula, 'a property name that looks like a formula is kept as text');
  rows.forEach((r) => assert.strictEqual(r[3].getDay(), 5, 'pay week ending is a Friday'));
  assert.strictEqual(w.report.sheets[0].images.length, 1, 'logo');
  preview = w;
});

test('Report: labor cost and hours by property and person, totals both ways', () => {
  const w = world(LOGS);
  w.sandbox.refreshReport();
  const report = w.report.sheets[0];
  const cost = checkMatrix(report, 'Labor cost by property and person', ALL, (l) => l.property, 'pay');
  checkMatrix(report, 'Hours by property and person', ALL, (l) => l.property, 'hours');
  assert.deepStrictEqual(cost.columns, ['Sam Test', 'Alex Test', 'Jo Test', 'Total'], 'people, most paid first');
  const props = Object.keys(cost.rows);
  const totals = props.map((p) => cost.rows[p][cost.columns.length - 1]);
  assert.deepStrictEqual(totals.slice().sort((a, b) => b - a), totals, 'properties, most cost first');
  const headline = report.peek(8, 1);
  const pay = ALL.reduce((a, l) => a + l.pay, 0);
  assert(headline.startsWith(`$${pay.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} labor cost`), headline);
  assert(headline.includes('3 people'), headline);
});

test('Report: each person, with a link to their pay log and a note when something is missing', () => {
  const w = world(LOGS);
  w.sandbox.refreshReport();
  const report = w.report.sheets[0];
  const h = findRow(report, 'By person') + 1;
  const rows = {};
  for (let r = h + 1; report.peek(r, 1) !== ''; r++) rows[report.peek(r, 1)] = [2, 3, 4, 5, 6].map((c) => report.peek(r, c));
  const label = (l) => (l.role ? `${l.person}  ·  ${l.role}` : l.person);
  const lines = [];
  LOGS.forEach((log) => expectedLines([log]).forEach((l) => lines.push({ ...l, role: log.role })));
  const pay = sums(lines, label, 'pay');
  const hours = sums(lines, label, 'hours');
  assert.deepStrictEqual(Object.keys(rows).sort(), ['Alex Test  ·  Maintenance', 'Alex Test  ·  Management', 'Broken', 'Jo Test', 'Sam Test'],
    'one row per pay log, each of Alex\'s roles on its own');
  Object.keys(pay).forEach((p) => {
    close(rows[p][0], pay[p], `${p} labor cost`);
    close(rows[p][1], hours[p], `${p} hours`);
    assert(/^=HYPERLINK\("https:\/\/docs\.google\.com\/spreadsheets\/d\/log\d\/edit","Open"\)$/.test(rows[p][3]), rows[p][3]);
  });
  assert.strictEqual(rows['Jo Test'][4], 'No rate of pay set: 4 hours not priced.');
  assert.strictEqual(rows['Alex Test  ·  Maintenance'][4], '');
  assert.strictEqual(rows.Broken[4], 'No "Pay log" tab, so it was skipped.');
  assert.strictEqual(rows['Alex Test  ·  Maintenance'][2].toISOString().slice(0, 10), '2027-09-30', 'last entry');
});

test('charts: stacked, drawn from the tables, one colour per person in every chart', () => {
  const w = world(LOGS);
  w.sandbox.refreshReport();
  const [report, month] = w.report.sheets;
  assert.strictEqual(report.charts.length, 2);
  assert.strictEqual(month.charts.length, 1);
  const cost = table(report, 'Labor cost by property and person');
  const [byProperty, byPerson] = report.charts.map((c) => c.spec);
  const rg = byProperty.ranges[0];
  assert.deepStrictEqual([rg.r, rg.c, rg.nr, rg.nc], [cost.header, 1, Object.keys(cost.rows).length + 1, cost.columns.length],
    'the property chart covers the table, without its Total row and column');
  assert.strictEqual(byProperty.type, 'BAR');
  assert.strictEqual(byProperty.options.isStacked, true);
  assert.strictEqual(byProperty.headers, 1);
  // Colours go by name order on first sight (Alex, Jo, Sam), whatever the column order.
  const colour = { 'Alex Test': '#2A78D6', 'Jo Test': '#EB6834', 'Sam Test': '#1BAF7A' };
  const seriesOf = (spec, columns) => columns.map((_, i) => spec.options.series[i].color);
  assert.deepStrictEqual(seriesOf(byProperty, cost.columns.slice(0, -1)), cost.columns.slice(0, -1).map((p) => colour[p]));
  const months = table(month, 'By person');
  const mspec = month.charts[0].spec;
  assert.strictEqual(mspec.type, 'COLUMN');
  assert.deepStrictEqual(seriesOf(mspec, months.columns.slice(0, -1)), months.columns.slice(0, -1).map((p) => colour[p]));
  const h = findRow(report, 'By person') + 1;
  assert.deepStrictEqual([byPerson.ranges[0].r, byPerson.ranges[0].nc], [h, 2], 'person chart: names and labor cost');
  assert(byPerson.position.row > h + 4, 'the person chart sits under its table');
  assert(byProperty.position.row > cost.totalRow, 'the property chart sits under its table');
  const hoursHeading = findRow(report, 'Hours by property and person');
  assert(hoursHeading >= byProperty.position.row + Math.ceil(byProperty.options.height / 21), 'the next table starts below the chart');
});

test('By month: labor cost month by month, by person and by property', () => {
  const w = world(LOGS);
  w.sandbox.refreshReport();
  const month = w.report.sheets[1];
  const lab = (l) => monthLabel(l.day);
  checkMatrix(month, 'By person', ALL, lab, 'pay');
  const t = table(month, 'By property');
  const cell = {};
  ALL.forEach((l) => { const k = `${lab(l)}|${l.property}`; cell[k] = (cell[k] || 0) + l.pay; });
  Object.entries(t.rows).forEach(([m, values]) => t.columns.slice(0, -1).forEach((p, i) => close(values[i], cell[`${m}|${p}`] || 0, `${m} ${p}`)));
  assert.deepStrictEqual(Object.keys(t.rows), ['Oct 2026', 'Nov 2026', 'Sep 2027'], 'months in order');
});

test('the period on Report narrows every table, stays put, and can be typed either way round', () => {
  const w = world(LOGS);
  w.sandbox.refreshReport();
  const report = w.report.sheets[0];
  report.cell(5, 2).value = new Date('2026-10-31T00:00:00Z');   // typed backwards
  report.cell(5, 4).value = new Date('2026-10-12T00:00:00Z');
  w.sandbox.refreshReport();
  const inside = ALL.filter((l) => l.day >= '2026-10-12' && l.day <= '2026-10-31');
  checkMatrix(report, 'Labor cost by property and person', inside, (l) => l.property, 'pay');
  checkMatrix(w.report.sheets[1], 'By person', inside, (l) => monthLabel(l.day), 'pay');
  assert.strictEqual(report.peek(5, 2).toISOString().slice(0, 10), '2026-10-12');
  assert.strictEqual(report.peek(5, 4).toISOString().slice(0, 10), '2026-10-31');
  let n = 0;
  for (let r = 2; w.report.sheets[2].peek(r, 1) !== ''; r++) n++;
  assert.strictEqual(n, ALL.length, 'Data keeps every line');
});

test('refreshing again rebuilds in place: no doubled charts or logos', () => {
  const w = world(LOGS);
  w.sandbox.refreshReport();
  w.sandbox.refreshReport();
  w.sandbox.refreshReport();
  assert.deepStrictEqual(w.report.sheets.map((s) => [s.charts.length, s.images.length]), [[2, 1], [1, 1], [0, 0]]);
});

test('colours stay with people as others join; past the eighth, people stay in the tables and go grey', () => {
  const w = world(LOGS);
  w.sandbox.refreshReport();
  const before = JSON.parse(w.props.personColours);
  ['Aaron', 'Bea', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus'].forEach((n, i) => {
    w.addLog(`x${i}`, `Evolution24 Pay Log - ${n}`, syntheticLog(n, [[`2026-10-${12 + i}`, 'Water Street', 2, 40 + i]]), `folder-${n}`);
  });
  w.sandbox.refreshReport();
  const after = JSON.parse(w.props.personColours);
  Object.keys(before).forEach((p) => assert.strictEqual(after[p], before[p], `${p} kept its colour`));
  assert.deepStrictEqual(Object.values(after).filter((i) => i >= 0).sort(), [0, 1, 2, 3, 4, 5, 6, 7], 'eight colours in use');
  assert.deepStrictEqual(Object.keys(after).filter((p) => after[p] < 0).sort(), ['Fay', 'Gus'], 'the last two to arrive have none');
  const cost = table(w.report.sheets[0], 'Labor cost by property and person');
  const people = cost.columns.slice(0, -1);
  assert.strictEqual(people.length, 10, 'everyone has a column');
  assert.deepStrictEqual(people.slice(-2), ['Gus', 'Fay'], 'the grey ones last, most paid first');
  const spec = w.report.sheets[0].charts[0].spec;
  assert.deepStrictEqual(people.map((_, i) => spec.options.series[i].color), people.map((p) => SERIES_OF(after, p)),
    'each person in their own colour, Fay and Gus in grey');
  close(cost.rows['Water Street'][people.indexOf('Fay')], 45, 'Fay has her own column');
});

test('menu, the hourly refresh, and an empty folder', () => {
  const w = world([]);
  w.sandbox.onOpen();
  assert.deepStrictEqual(w.menus[0].items.map((i) => i[1]), ['refreshReport', 'refreshEveryHour', 'stopRefreshing']);
  w.sandbox.refreshEveryHour();
  w.sandbox.refreshEveryHour();
  assert.strictEqual(w.triggers.length, 1, 'one hourly trigger, however often it is asked for');
  assert.strictEqual(w.triggers[0].hours, 1);
  w.sandbox.stopRefreshing();
  assert.strictEqual(w.triggers.length, 0);
  w.sandbox.refreshReport();
  const report = w.report.sheets[0];
  assert.strictEqual(report.peek(10, 1), 'No hours logged in this period.');
  assert(String(report.peek(findRow(report, 'By person') + 2, 1)).startsWith('Broken'), 'still lists the broken file');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

/* ---- a picture of each tab, to look at ------------------------------------------------- */
async function drawPreview(w, dir) {
  let pw;
  try { pw = require('playwright'); } catch { pw = require(path.join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')); }
  const logo = fs.readFileSync(path.join(ROOT, 'source', 'logo', 'sheet-logo.png')).toString('base64');
  const show = (cell) => {
    const v = cell.value;
    const f = cell.fmt.numberFormat || '';
    if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
      return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][v.getDay()]} ${v.getMonth() + 1}/${v.getDate()}/${String(v.getFullYear()).slice(2)}`;
    }
    if (typeof v === 'number') {
      if (v === 0 && f.includes('–')) return '–';
      if (f.startsWith('$')) return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return String(Math.round(v * 100) / 100);
    }
    if (cell.formula && v.startsWith('=HYPERLINK')) return '<u style="color:#2A78D6">Open</u>';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  };
  const chartSvg = (sheet, spec) => {
    const rg = spec.ranges[0];
    const cats = [];
    const names = [];
    for (let j = 1; j < rg.nc; j++) names.push(sheet.peek(rg.r, rg.c + j));
    for (let i = 1; i < rg.nr; i++) cats.push([sheet.peek(rg.r + i, rg.c), names.map((_, j) => sheet.peek(rg.r + i, rg.c + 1 + j) || 0)]);
    const W = spec.options.width;
    const H = spec.options.height;
    const across = spec.type === 'BAR';
    const max = Math.max(1, ...cats.map(([, v]) => v.reduce((a, b) => a + b, 0)));
    const colours = names.map((_, j) => spec.options.series[j].color);
    let out = `<svg width="${W}" height="${H}" style="background:#fff;font:12px Manrope,Arial"><text x="12" y="22" font-weight="700" font-size="13">${spec.options.title}</text>`;
    if (names.length > 1) names.forEach((n, j) => { out += `<rect x="${12 + j * 110}" y="34" width="10" height="10" rx="2" fill="${colours[j]}"/><text x="${26 + j * 110}" y="43">${n}</text>`; });
    const top = 60, left = across ? 180 : 50, plotW = W - left - 20, plotH = H - top - 40;
    cats.forEach(([label, vals], i) => {
      let acc = 0;
      if (across) {
        const band = plotH / cats.length;
        const y = top + i * band + band * 0.2;
        out += `<text x="${left - 8}" y="${y + band * 0.4}" text-anchor="end">${String(label).slice(0, 26)}</text>`;
        vals.forEach((v, j) => { const w = (v / max) * plotW; if (w > 0) out += `<rect x="${left + acc + 1}" y="${y}" width="${Math.max(0, w - 2)}" height="${band * 0.6}" fill="${colours[j]}"/>`; acc += w; });
      } else {
        const band = plotW / cats.length;
        const x = left + i * band + band * 0.2;
        out += `<text x="${x + band * 0.3}" y="${top + plotH + 16}" text-anchor="middle">${label}</text>`;
        vals.forEach((v, j) => { const h = (v / max) * plotH; if (h > 0) out += `<rect x="${x}" y="${top + plotH - acc - h + 1}" width="${band * 0.6}" height="${Math.max(0, h - 2)}" fill="${colours[j]}"/>`; acc += h; });
      }
    });
    return `${out}</svg>`;
  };
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  for (const sheet of w.report.sheets) {
    const rows = Math.min(140, Math.max(...[...sheet.cells.keys()].map((k) => Number(k.split(',')[0]))) + 30);
    const cols = Math.max(...Object.keys(sheet.widths).map(Number));
    const covered = new Set();
    let html = `<div style="position:relative;font:10pt Manrope,Arial;color:#151613"><table style="border-collapse:collapse;table-layout:fixed">`;
    html += `<colgroup>${Array.from({ length: cols }, (_, j) => `<col style="width:${sheet.widths[j + 1] || 100}px">`).join('')}</colgroup>`;
    const tops = [0];
    for (let r = 1; r <= rows; r++) {
      const h = sheet.heights[r] || 21;
      tops.push(tops[r - 1] + h);
      html += `<tr style="height:${h}px">`;
      for (let c = 1; c <= cols; c++) {
        if (covered.has(`${r},${c}`)) continue;
        const m = sheet.merges.find((x) => x.r === r && x.c === c);
        if (m) for (let i = 0; i < m.nr; i++) for (let j = 0; j < m.nc; j++) if (i || j) covered.add(`${r + i},${c + j}`);
        const cell = sheet.cells.get(`${r},${c}`) || { value: '', fmt: {} };
        const f = cell.fmt;
        const right = typeof cell.value === 'number' || cell.value instanceof Date;
        const style = [`background:${f.background || '#fff'}`, `color:${f.fontColor || '#151613'}`, `font-size:${f.fontSize || 10}pt`,
          `font-weight:${f.fontWeight === 'bold' ? 700 : 400}`, `font-style:${f.fontStyle || 'normal'}`,
          `text-align:${f.align || (right ? 'right' : 'left')}`, f.border ? `border:1px solid ${f.border}` : '',
          'padding:0 4px', `white-space:${f.wrap ? 'normal' : 'nowrap'}`, 'overflow:hidden'].join(';');
        html += `<td style="${style}"${m ? ` colspan="${m.nc}" rowspan="${m.nr}"` : ''}>${cell.value === '' ? '' : show(cell)}</td>`;
      }
      html += '</tr>';
    }
    html += '</table>';
    sheet.images.forEach((img) => { html += `<img src="data:image/png;base64,${logo}" style="position:absolute;left:${14}px;top:${12}px;width:${img.w}px;height:${img.h}px">`; });
    sheet.charts.forEach((ch) => {
      const p = ch.spec.position;
      html += `<div style="position:absolute;left:0;top:${tops[p.row - 1]}px">${chartSvg(sheet, ch.spec)}</div>`;
    });
    html += '</div>';
    await page.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;700&display=swap" rel="stylesheet"></head><body style="margin:16px">${html}</body></html>`);
    await page.waitForTimeout(300);
    const file = path.join(dir, `${sheet.name.replace(/\s+/g, '-').toLowerCase()}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`preview: ${file}`);
  }
  await browser.close();
}

(async () => {
  if (process.env.PREVIEW && preview) {
    fs.mkdirSync(process.env.PREVIEW, { recursive: true });
    await drawPreview(preview, process.env.PREVIEW);
  }
  if (failed) {
    console.log(`${failed} of ${tests.length} failed`);
    process.exit(1);
  }
  console.log(`labor report: all ${tests.length} tests pass`);
})();
