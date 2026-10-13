/**
 * Evolution24 labor report: a Google Sheet of its own that reads every pay log in the shared drive
 * it sits in and breaks the labor cost down by property and by person, with charts. It only reads
 * the pay logs; it never writes to them.
 *
 * Set up, once:
 *  1. In the Pay Logs shared drive, in a folder only managers can open (Accounting), make a new
 *     Google Sheet and call it "Evolution24 Labor Report".
 *  2. Extensions > Apps Script. Replace the code there with this file.
 *  3. Project Settings (the gear): tick "Show appsscript.json manifest file in editor". Back in the
 *     editor, replace appsscript.json with tools/pay-log/appsscript.json, so the report can read
 *     Drive but not change it.
 *  4. Save. Choose refreshReport at the top and press Run; allow access when asked.
 *  5. In the sheet: Evolution24 > Refresh report whenever you want it up to date, or
 *     Evolution24 > Refresh every hour.
 *
 * The tabs:
 *  Report      labor cost for each property, split by person, with a chart; the same in hours;
 *              each person's total with a chart, and a link to their pay log. The From and To
 *              dates at the top choose the period (blank: everything).
 *  By month    labor cost month by month, split by person (with a chart) and by property.
 *  Properties  the buildings that share office / all-properties time, and each one's share.
 *  Data        every line read from the pay logs, after sharing: person, date, property, what it
 *              was logged as, hours, pay. Rewritten on each refresh; use it for your own pivots.
 *
 * Office / all properties: hours logged against "Office / all properties" (or "Office", or "All
 * properties") belong to every building, so the report shares them, and their pay, across the
 * buildings on the Properties tab in proportion to each one's share: equal shares to start with;
 * put in unit counts to share by size, or 0 to leave a building out. The pay logs keep the line as
 * logged; only the report divides it.
 *
 * Which files: every Google Sheet with "Pay Log" in its name, except the template, in the folder
 * above the report's own folder (the top of the shared drive, when the report is in Accounting) and
 * in every folder under it, so each person's pay log can sit in a private folder of its own. Each is
 * read as tools/pay-log/make.py lays it out, on its "Pay log" tab: the name in B5, the role (if any)
 * in B7, and from row 11 down a row per day: the date in A, six property and hours slots in B to M,
 * and each slot's pay in the hidden columns R to W. (Pay logs from before the six slots, with one
 * property per line, the date in the hidden column F and pay in D, are still read.) Someone with two roles keeps two pay logs under the same name; the report adds
 * them together and lists each role under By person. The report reads them as whoever refreshes it,
 * so that person needs access to every folder.
 *
 * Each person keeps one chart colour for good, in every chart. Charts have eight colours, so from
 * the ninth person on, people are drawn in grey (the tables name everyone).
 */

const LOG_PREFIX = 'Evolution24 Pay Log - ';
const LOG_NAME = /pay\s*log/i;
const MAX_DEPTH = 3;   // how many folders deep to look
const LOG_TAB = 'Pay log';
const LOG_FIRST_ROW = 11;
const SLOTS = 6;            // property and hours slots in each day's row
const SLOT_PAY_COL = 18;    // R: the first slot's pay (hidden)
const TABS = { report: 'Report', month: 'By month', properties: 'Properties', data: 'Data' };
const SHARED_LABEL = 'Office / all properties';
const SHARED = /^(office|all properties|office\s*\/\s*all properties)$/i;
// The buildings that share office / all-properties time, an equal share each to start with; after
// the first refresh, the Properties tab is the list. Matches tools/pay-log/make.py's property list.
const BUILDINGS = ['301 Central Avenue', '145 South Fitzhugh', 'Water Street', 'The Biltmore', '181 St. Paul',
  'Charlotte Square', '2215 James Street', '121 Park Drive', '379 South Main', '561 South Main', '31 Genesee Street',
  '440 Armstrong', '444 Armstrong', '452 Armstrong', '4940 Hillcrest', '300 Alexander'];
const SHARES_FIRST_ROW = 7;
const NO_PROPERTY = '(no property)';

const INK = '#151613';
const CREAM = '#E5E6D3';
const TAN = '#DEBB92';
const PAPER = '#F4F1EA';
const ACCENT = '#8A6232';
const INPUT = '#F8EEDF';
const LINE = '#D8D3C6';
const MUTED = '#6B6A63';
const WHITE = '#FFFFFF';
const SANS = 'Manrope';
// Chart colours: one per person, in a fixed order that stays tellable apart for colour-blind readers.
const SERIES = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#6250D6', '#E34948'];
const OTHER_COLOUR = '#8C8A80';
const MONEY = '$#,##0.00;-$#,##0.00;"–"';
const HOURS = '0.0#;-0.0#;"–"';
const ROW_PX = 21;   // a row's default height, for leaving room under a chart

const LOGO_PNG = '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';

/** Menu in the sheet. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Evolution24')
    .addItem('Refresh report', 'refreshReport')
    .addItem('Refresh every hour', 'refreshEveryHour')
    .addItem('Stop refreshing every hour', 'stopRefreshing')
    .addToUi();
}

function refreshEveryHour() {
  stopRefreshing();
  ScriptApp.newTrigger('refreshReport').timeBased().everyHours(1).create();
  toast_(SpreadsheetApp.getActiveSpreadsheet(), 'The report will refresh itself every hour.');
}

function stopRefreshing() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'refreshReport')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** Read every pay log and rebuild the tabs. */
function refreshReport() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(60 * 1000)) return;   // a refresh is already running
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = ss.getSpreadsheetTimeZone();
    const report = tab_(ss, TABS.report, 0);
    const month = tab_(ss, TABS.month, 1);
    const props = tab_(ss, TABS.properties, 2);
    const data = tab_(ss, TABS.data, 3);
    dropBlankDefault_(ss);
    const period = period_(report, tz);
    const shares = readShares_(props);
    const read = readPayLogs_(ss);
    const all = share_(read.lines, shares);
    const lines = all.filter((l) => (!period.from || l.day >= period.from) && (!period.to || l.day <= period.to));
    const colours = colours_(read.lines.map((l) => l.person));
    writeData_(data, all);
    writeReport_(report, lines, read.sources, period, colours, tz, shares);
    writeMonths_(month, lines, colours);
    writeShares_(props, shares);
    toast_(ss, 'Read ' + read.sources.length + ' pay logs, ' + read.lines.length + ' lines.');
  } finally {
    lock.releaseLock();
  }
}

/* ---- reading the pay logs -------------------------------------------------------------- */

/** The pay logs: in the folder above the report's own folder, and in every folder under that. */
function payLogFiles_(ss) {
  const tops = [];
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  while (parents.hasNext()) {
    const folder = parents.next();
    const up = folder.getParents();
    tops.push(up.hasNext() ? up.next() : folder);
  }
  const seen = {};
  const files = [];
  const visit = (folder, depth) => {
    if (seen[folder.getId()]) return;
    seen[folder.getId()] = true;
    const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (it.hasNext()) {
      const f = it.next();
      const name = f.getName();
      if (seen[f.getId()] || f.getId() === ss.getId() || !LOG_NAME.test(name) || /template/i.test(name)) continue;
      seen[f.getId()] = true;
      files.push(f);
    }
    if (depth >= MAX_DEPTH) return;
    const sub = folder.getFolders();
    while (sub.hasNext()) visit(sub.next(), depth + 1);
  };
  tops.forEach((folder) => visit(folder, 0));
  return files.sort((a, b) => (a.getName() < b.getName() ? -1 : a.getName() > b.getName() ? 1 : 0));
}

function readPayLogs_(ss) {
  const lines = [];
  const sources = payLogFiles_(ss).map((file) => {
    const name = file.getName();
    const source = { file: name, url: file.getUrl(), role: '', unpriced: 0, last: '', problem: '',
      person: name.indexOf(LOG_PREFIX) === 0 ? name.slice(LOG_PREFIX.length) : name };
    try {
      const book = SpreadsheetApp.openById(file.getId());
      const sheet = book.getSheetByName(LOG_TAB);
      if (!sheet) {
        source.problem = 'No "' + LOG_TAB + '" tab, so it was skipped.';
        return source;
      }
      const tz = book.getSpreadsheetTimeZone();
      source.person = text_(sheet.getRange('B5').getValue()) || source.person;
      if (text_(sheet.getRange('A7').getValue()) === 'Role') source.role = text_(sheet.getRange('B7').getValue());
      const last = sheet.getLastRow();
      if (last < LOG_FIRST_ROW) return source;
      const add = (date, property, hours, pay) => {
        if (!isDate_(date) || typeof hours !== 'number' || !(hours > 0)) return;
        const day = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
        const priced = typeof pay === 'number';
        if (!priced) source.unpriced += hours;
        lines.push({ person: source.person, role: source.role, day: day, property: text_(property) || NO_PROPERTY,
          hours: hours, pay: priced ? pay : 0, url: source.url });
        if (day > source.last) source.last = day;
      };
      const rows = last - LOG_FIRST_ROW + 1;
      if (text_(sheet.getRange('B8').getValue()) === 'Property 1') {
        // A row per day: the date in A, then property and hours pairs, each pair's pay further along.
        const width = Math.min(sheet.getMaxColumns(), SLOT_PAY_COL + SLOTS - 1);
        sheet.getRange(LOG_FIRST_ROW, 1, rows, width).getValues().forEach((row) => {
          for (let k = 0; k < SLOTS; k++) add(row[0], row[1 + 2 * k], row[2 + 2 * k], row[SLOT_PAY_COL - 1 + k]);
        });
      } else {
        // The first layout: a line per property, the date in F.
        sheet.getRange(LOG_FIRST_ROW, 1, rows, 6).getValues().forEach((row) => add(row[5], row[1], row[2], row[3]));
      }
    } catch (e) {
      source.problem = 'Could not be read: ' + e.message;
    }
    return source;
  });
  return { lines: lines, sources: sources };
}

/* ---- office / all properties ----------------------------------------------------------- */

/** The Properties tab: each building and its share. Blank share: 1. A fresh tab starts from BUILDINGS. */
function readShares_(sheet) {
  const last = sheet.getLastRow();
  if (last < SHARES_FIRST_ROW) return BUILDINGS.map((name) => ({ name: name, share: 1 }));
  return sheet.getRange(SHARES_FIRST_ROW, 1, last - SHARES_FIRST_ROW + 1, 2).getValues()
    .map((row) => ({ name: text_(row[0]), share: typeof row[1] === 'number' ? Math.max(0, row[1]) : text_(row[1]) === '' ? 1 : 0 }))
    .filter((r) => r.name && !SHARED.test(r.name));
}

/**
 * Lines with office / all-properties time become one line per building, each with its share of the
 * hours and pay; every other line stays as it is. `loggedAs` keeps what the pay log said.
 */
function share_(lines, shares) {
  const takers = shares.filter((s) => s.share > 0);
  const total = takers.reduce((a, s) => a + s.share, 0);
  const out = [];
  lines.forEach((l) => {
    if (!SHARED.test(l.property) || !total) {
      out.push(Object.assign({}, l, { loggedAs: l.property }));
      return;
    }
    takers.forEach((s) => {
      const part = s.share / total;
      out.push(Object.assign({}, l, { property: s.name, loggedAs: SHARED_LABEL, hours: l.hours * part, pay: l.pay * part, shared: true }));
    });
  });
  return out;
}

function writeShares_(sheet, shares) {
  const width = 4;
  reset_(sheet, width, [230, 90, 150, 360]);
  band_(sheet, width, 'Properties  ·  sharing office / all-properties time');
  sheet.getRange(5, 1, 1, width).merge()
    .setValue('Hours logged as "' + SHARED_LABEL + '" are shared across these buildings by their shares. Equal shares split '
      + 'it evenly; put in unit counts to split it by size; 0 leaves a building out. Add buildings in the tan rows, '
      + 'then Evolution24 > Refresh report.')
    .setWrap(true).setFontColor(MUTED).setFontStyle('italic').setFontSize(9);
  sheet.setRowHeight(5, 44);
  header_(sheet, SHARES_FIRST_ROW - 1, ['Property', 'Share', 'Share of office time'], width);
  const rows = shares.length + 10;
  const last = SHARES_FIRST_ROW + rows - 1;
  const values = [];
  for (let i = 0; i < rows; i++) {
    const s = shares[i];
    const r = SHARES_FIRST_ROW + i;
    values.push([s ? safe_(s.name) : '', s ? s.share : '',
      '=IF(OR(A' + r + '="",B' + r + '=""),"",B' + r + '/SUM($B$' + SHARES_FIRST_ROW + ':$B$' + last + '))']);
  }
  sheet.getRange(SHARES_FIRST_ROW, 1, rows, 3).setValues(values);
  sheet.getRange(SHARES_FIRST_ROW, 1, rows, 2).setBackground(INPUT);
  sheet.getRange(SHARES_FIRST_ROW, 3, rows, 1).setNumberFormat('0.0%');
  grid_(sheet.getRange(SHARES_FIRST_ROW, 1, rows, 3));
  sheet.setFrozenRows(3);
  sheet.setTabColor(TAN);
}

/* ---- the tabs -------------------------------------------------------------------------- */

function writeReport_(sheet, lines, sources, period, colours, tz, shares) {
  const people = columns_(lines, colours);
  const properties = ranked_(lines, (l) => l.property);
  const width = Math.max(people.length + 2, 6);
  reset_(sheet, width, [230].concat(Array(width - 1).fill(118)));
  band_(sheet, width, 'Labor report  ·  every pay log, by property and person');

  // The period, kept from the last refresh.
  sheet.getRange('A5').setValue('Period');
  sheet.getRange('C5').setValue('to').setHorizontalAlignment('center');
  [['B5', period.fromDate], ['D5', period.toDate]].forEach(([a1, d]) => {
    sheet.getRange(a1).setValue(d || '').setNumberFormat('ddd m/d/yy').setBackground(INPUT).setFontWeight('bold')
      .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  });
  sheet.getRange(5, 5, 1, width - 4).merge().setValue('Blank means everything. Change the dates, then Evolution24 > Refresh report.')
    .setFontColor(MUTED).setFontStyle('italic').setFontSize(9);
  sheet.getRange('A6').setValue('Updated');
  sheet.getRange(6, 2, 1, 3).merge().setValue(Utilities.formatDate(new Date(), tz, 'EEE M/d/yy h:mm a')).setFontColor(MUTED);

  const pay = sum_(lines, 'pay');
  const hours = sum_(lines, 'hours');
  sheet.getRange(8, 1, 1, width).merge()
    .setValue(money_(pay) + ' labor cost   ·   ' + number_(hours) + ' hours   ·   ' + people.length + (people.length === 1 ? ' person' : ' people')
      + '   ·   ' + properties.length + (properties.length === 1 ? ' property' : ' properties'))
    .setFontSize(15).setFontWeight('bold').setBackground(PAPER);
  sheet.setRowHeight(8, 36);
  const shared = lines.filter((l) => l.shared);
  if (shared.length) {
    const takers = shares.filter((s) => s.share > 0).length;
    sheet.getRange(9, 1, 1, width).merge()
      .setValue('Includes ' + number_(sum_(shared, 'hours')) + ' hours and ' + money_(sum_(shared, 'pay')) + ' of office / '
        + 'all-properties time, shared across ' + takers + ' buildings by their shares on the Properties tab.')
      .setFontColor(MUTED).setFontStyle('italic').setFontSize(9);
  }

  let row = 10;
  if (!lines.length) {
    sheet.getRange(row, 1).setValue('No hours logged in this period.').setFontColor(MUTED);
    row += 2;
  } else {
    const top = row + 1;
    row = matrix_(sheet, row, 'Labor cost by property and person', 'Property', properties, people,
      (p, person) => cell_(lines, 'pay', (l) => l.property === p && l.person === person), MONEY);
    row = chart_(sheet, row, sheet.getRange(top, 1, properties.length + 1, people.length + 1), Charts.ChartType.BAR,
      properties.length, 'Labor cost by property, split by person', people.map((p) => colourOf_(p, colours)), width);
    row = matrix_(sheet, row, 'Hours by property and person', 'Property', properties, people,
      (p, person) => cell_(lines, 'hours', (l) => l.property === p && l.person === person), HOURS);
  }

  // Each person: totals for the period, and their pay log.
  heading_(sheet, row, 'By person');
  const head = ['Person', 'Labor cost', 'Hours', 'Last entry', 'Pay log', 'Note'];
  header_(sheet, row + 1, head, width);
  const byPerson = sources.map((s) => {
    const mine = lines.filter((l) => l.url === s.url);
    const note = s.problem || (s.unpriced ? 'No rate of pay set: ' + number_(s.unpriced) + ' hours not priced.' : '');
    return [safe_(s.person + (s.role ? '  ·  ' + s.role : '')), sum_(mine, 'pay'), sum_(mine, 'hours'), s.last ? date_(s.last) : '',
      '=HYPERLINK("' + s.url + '","Open")', note];
  }).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const first = row + 2;
  if (byPerson.length) {
    const body = sheet.getRange(first, 1, byPerson.length, head.length);
    body.setValues(byPerson);
    sheet.getRange(first, 2, byPerson.length, 1).setNumberFormat(MONEY);
    sheet.getRange(first, 3, byPerson.length, 1).setNumberFormat(HOURS);
    sheet.getRange(first, 4, byPerson.length, 1).setNumberFormat('ddd m/d/yy');
    sheet.getRange(first, 6, byPerson.length, 1).setFontColor(ACCENT).setFontSize(9);
    grid_(sheet.getRange(first, 1, byPerson.length, head.length));
    row = chart_(sheet, first + byPerson.length + 1, sheet.getRange(row + 1, 1, byPerson.length + 1, 2), Charts.ChartType.BAR,
      byPerson.length, 'Labor cost by person', [ACCENT], Math.min(width, 4));
  } else {
    sheet.getRange(first, 1).setValue('No pay logs found. Put this report in the same Drive folder as the pay logs '
      + '(their Google Sheets copies, named "' + LOG_PREFIX + '…").').setFontColor(ACCENT);
  }
  sheet.setFrozenRows(3);
  sheet.setTabColor(INK);
}

function writeMonths_(sheet, lines, colours) {
  const people = columns_(lines, colours);
  const properties = ranked_(lines, (l) => l.property);
  const months = unique_(lines.map((l) => l.day.slice(0, 7))).sort();
  const width = Math.max(people.length + 2, properties.length + 2, 6);
  reset_(sheet, width, [130].concat(Array(width - 1).fill(118)));
  band_(sheet, width, 'Labor cost by month');
  sheet.getRange('A5').setValue('The months in the period chosen on Report, or every month with hours if it is blank.')
    .setFontColor(MUTED).setFontStyle('italic').setFontSize(9);
  const labels = months.map(month_);
  if (!months.length) {
    sheet.getRange('A7').setValue('No hours logged in this period.').setFontColor(MUTED);
    return;
  }
  let row = matrix_(sheet, 7, 'By person', 'Month', labels, people,
    (m, person) => cell_(lines, 'pay', (l) => month_(l.day.slice(0, 7)) === m && l.person === person), MONEY);
  row = chart_(sheet, row, sheet.getRange(8, 1, months.length + 1, people.length + 1), Charts.ChartType.COLUMN,
    months.length, 'Labor cost by month, split by person', people.map((p) => colourOf_(p, colours)), width);
  matrix_(sheet, row, 'By property', 'Month', labels, properties,
    (m, p) => cell_(lines, 'pay', (l) => month_(l.day.slice(0, 7)) === m && l.property === p), MONEY);
  sheet.setFrozenRows(3);
  sheet.setTabColor(ACCENT);
}

function writeData_(sheet, lines) {
  const head = ['Person', 'Role', 'Date', 'Pay week ending', 'Month', 'Property', 'Logged as', 'Hours', 'Labor cost', 'Pay log'];
  const rows = lines.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.person < b.person ? -1 : 1))
    .map((l) => [safe_(l.person), safe_(l.role), date_(l.day), date_(weekEnding_(l.day)), month_(l.day.slice(0, 7)),
      safe_(l.property), safe_(l.loggedAs), l.hours, l.pay, l.url]);
  const width = head.length;
  sheet.getCharts().forEach((c) => sheet.removeChart(c));
  ensure_(sheet, rows.length + 1, width);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), width).setFontFamily(SANS).setFontSize(10).setFontColor(INK);
  header_(sheet, 1, head, width);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
    sheet.getRange(2, 3, rows.length, 2).setNumberFormat('ddd m/d/yy');
    sheet.getRange(2, 8, rows.length, 1).setNumberFormat(HOURS);
    sheet.getRange(2, 9, rows.length, 1).setNumberFormat(MONEY);
  }
  [130, 120, 110, 120, 100, 200, 170, 80, 100, 320].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(1);
  sheet.setTabColor(MUTED);
}

/* ---- building blocks ------------------------------------------------------------------- */

/** A table: one row per item, one column per column key, and totals both ways. Returns the next free row. */
function matrix_(sheet, row, title, corner, items, keys, value, format) {
  heading_(sheet, row, title);
  const head = [corner].concat(keys.map(safe_), ['Total']);
  header_(sheet, row + 1, head, head.length);
  const body = items.map((item) => {
    const values = keys.map((k) => value(item, k));
    return [safe_(item)].concat(values, [values.reduce((a, b) => a + b, 0)]);
  });
  const totals = ['Total'];
  for (let c = 1; c < head.length; c++) totals.push(body.reduce((a, r) => a + r[c], 0));
  const first = row + 2;
  sheet.getRange(first, 1, body.length + 1, head.length).setValues(body.concat([totals]));
  sheet.getRange(first, 2, body.length + 1, head.length - 1).setNumberFormat(format);
  grid_(sheet.getRange(first, 1, body.length + 1, head.length));
  sheet.getRange(first, head.length, body.length + 1, 1).setFontWeight('bold').setBackground(CREAM);
  sheet.getRange(first + body.length, 1, 1, head.length).setFontWeight('bold').setBackground(CREAM);
  return first + body.length + 2;
}

/**
 * A stacked chart of `range` (a table's header row and its `count` rows, labels in the first
 * column, one series per other column), placed at `row`. Returns the first free row under it.
 */
function chart_(sheet, row, range, type, count, title, colours, width) {
  const px = 230 + 118 * (width - 1);
  const across = type === Charts.ChartType.BAR;
  const height = Math.max(260, 90 + (across ? 30 : 0) * count + (across ? 0 : 220));
  const series = {};
  colours.forEach((c, i) => { series[i] = { color: c }; });
  const builder = sheet.newChart()
    .setChartType(type)
    .addRange(range)
    .setNumHeaders(1)
    .setPosition(row, 1, 0, 0)
    .setOption('title', title)
    .setOption('titleTextStyle', { color: INK, fontSize: 13, bold: true })
    .setOption('fontName', SANS)
    .setOption('isStacked', true)
    .setOption('legend', { position: colours.length > 1 ? 'top' : 'none', textStyle: { color: INK } })
    .setOption('series', series)
    .setOption(across ? 'hAxis' : 'vAxis', { format: '$#,##0', gridlines: { color: '#ECEAE3' }, textStyle: { color: MUTED } })
    .setOption(across ? 'vAxis' : 'hAxis', { textStyle: { color: INK } })
    .setOption('backgroundColor', WHITE)
    .setOption('width', px)
    .setOption('height', height);
  sheet.insertChart(builder.build());
  return row + Math.ceil(height / ROW_PX) + 2;
}

function heading_(sheet, row, title) {
  sheet.getRange(row, 1).setValue(title).setFontSize(12).setFontWeight('bold').setFontColor(ACCENT);
}

function header_(sheet, row, labels, width) {
  sheet.getRange(row, 1, 1, labels.length).setValues([labels]);
  sheet.getRange(row, 1, 1, width).setBackground(INK).setFontColor(CREAM).setFontWeight('bold').setFontSize(9)
    .setWrap(true).setVerticalAlignment('middle');
  sheet.getRange(row, 2, 1, Math.max(1, labels.length - 1)).setHorizontalAlignment('center');
  sheet.setRowHeight(row, 30);
}

function grid_(range) {
  range.setBorder(true, true, true, true, true, true, LINE, SpreadsheetApp.BorderStyle.SOLID);
}

function band_(sheet, width, title) {
  sheet.getRange(1, 1, 2, width).setBackground(INK);
  sheet.getRange(3, 1, 1, width).setBackground(TAN);
  sheet.setRowHeight(1, 60);
  sheet.setRowHeight(2, 28);
  sheet.setRowHeight(3, 4);
  sheet.getRange(2, 1).setValue(title).setFontColor(CREAM).setFontWeight('bold').setFontSize(12);
  if (LOGO_PNG) sheet.insertImage(image_(LOGO_PNG, 'evolution24.png'), 1, 1, 14, 12).setWidth(176).setHeight(43);
}

/** Empty the tab (charts, logo, merges, values, formats) and size its columns. */
function reset_(sheet, width, widths) {
  sheet.getCharts().forEach((c) => sheet.removeChart(c));
  sheet.getImages().forEach((i) => i.remove());
  ensure_(sheet, 300, width);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, sheet.getMaxRows(), width).setFontFamily(SANS).setFontSize(10).setFontColor(INK)
    .setVerticalAlignment('middle');
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

function ensure_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}

function tab_(ss, name, index) {
  return ss.getSheetByName(name) || ss.insertSheet(name, index);
}

/** A new spreadsheet's empty "Sheet1" goes once the report's own tabs are there. */
function dropBlankDefault_(ss) {
  ss.getSheets().forEach((s) => {
    if (Object.values(TABS).indexOf(s.getName()) < 0 && /^Sheet\d+$/.test(s.getName()) && s.getLastRow() === 0
      && s.getLastColumn() === 0) ss.deleteSheet(s);
  });
}

/** From and To on the Report tab, as typed (dates) and as yyyy-MM-dd for comparing. */
function period_(sheet, tz) {
  const read = (a1) => {
    const v = sheet.getRange(a1).getValue();
    return isDate_(v) ? v : null;
  };
  let fromDate = read('B5');
  let toDate = read('D5');
  if (fromDate && toDate && fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  const key = (d) => (d ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '');
  return { fromDate: fromDate, toDate: toDate, from: key(fromDate), to: key(toDate) };
}

/**
 * Each person's chart colour, kept in the document's properties so it never changes: new people
 * take the next free colour, in name order. Returns name -> colour index (or -1 past the eighth).
 */
function colours_(names) {
  const props = PropertiesService.getDocumentProperties();
  let map = {};
  try { map = JSON.parse(props.getProperty('personColours') || '{}'); } catch (e) { map = {}; }
  const taken = Object.keys(map).map((k) => map[k]);
  unique_(names).sort().forEach((name) => {
    if (name in map) return;
    const free = SERIES.findIndex((_, i) => taken.indexOf(i) < 0);
    map[name] = free;
    if (free >= 0) taken.push(free);
  });
  props.setProperty('personColours', JSON.stringify(map));
  return map;
}

function colourOf_(person, colours) {
  const i = colours[person];
  return i >= 0 ? SERIES[i] : OTHER_COLOUR;
}

/** The people columns: those with a colour first, most paid first; then anyone past the eighth (grey in charts). */
function columns_(lines, colours) {
  const ranked = ranked_(lines, (l) => l.person);
  return ranked.filter((p) => colours[p] >= 0).concat(ranked.filter((p) => !(colours[p] >= 0)));
}

/** Distinct keys, highest labor cost first (then most hours, then by name). */
function ranked_(lines, keyOf) {
  const totals = {};
  lines.forEach((l) => {
    const k = keyOf(l);
    totals[k] = totals[k] || { pay: 0, hours: 0 };
    totals[k].pay += l.pay;
    totals[k].hours += l.hours;
  });
  return Object.keys(totals).sort((a, b) => totals[b].pay - totals[a].pay || totals[b].hours - totals[a].hours || (a < b ? -1 : 1));
}

function cell_(lines, field, test) {
  return lines.reduce((a, l) => (test(l) ? a + l[field] : a), 0);
}

function sum_(lines, field) {
  return lines.reduce((a, l) => a + l[field], 0);
}

function unique_(values) {
  return values.filter((v, i) => values.indexOf(v) === i);
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function text_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Text from a pay log is shown as text, never run as a formula. */
function safe_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** yyyy-MM-dd as a date at noon, so no time zone can move it to the day before. */
function date_(day) {
  const p = day.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12);
}

function weekEnding_(day) {
  const d = date_(day);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));   // on to Friday
  return [d.getFullYear(), ('0' + (d.getMonth() + 1)).slice(-2), ('0' + d.getDate()).slice(-2)].join('-');
}

function month_(yyyyMm) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[Number(yyyyMm.slice(5, 7)) - 1] + ' ' + yyyyMm.slice(0, 4);
}

function money_(n) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function number_(n) {
  return String(Math.round(n * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function image_(b64, name) {
  return Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', name);
}

function toast_(ss, message) {
  try { ss.toast(message, 'Evolution24', 5); } catch (e) { /* no one is looking: a timed refresh */ }
}
