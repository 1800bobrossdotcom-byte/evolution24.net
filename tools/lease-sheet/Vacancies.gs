/**
 * Evolution24 Properties: what the LEASE WORKSHEETS say is vacant, for the website.
 *
 * Lives in the leasing team's "LEASE WORKSHEETS 2026" spreadsheet (Extensions → Apps Script).
 * The website's availability sync (.github/workflows/availability.yml, several times a day)
 * asks this script's web-app address, with a secret token, which units each building's tab
 * marks vacant and the rent to advertise for each (its "Total Amount Due", or "Total Rent
 * charged"). It answers with unit numbers and rents only: never a tenant's name, phone or
 * payments, and it can neither change the sheet nor read anything else. The website then
 * lists exactly those units at those rents (scripts/availability.mjs).
 *
 * A unit is vacant when its tenant cell says VACANT. A name there means it is taken, even
 * while the months still say VACANT (a new lease is entered there first). Only a blank tenant
 * cell falls back to the latest month with anything in it: VACANT, within the last three
 * months, is vacant. Parking, garages, storage, offices and shops are left out. The same rules
 * as scripts/vacancy_sheet.py, which reads an exported copy; keep the two in step.
 *
 * ONE-TIME SETUP (about five minutes, by someone who can edit the spreadsheet)
 *   1. Open LEASE WORKSHEETS 2026 → Extensions → Apps Script. Delete the sample code, paste
 *      this whole file in, and press Save.
 *   2. Check the function menu says "setup" and press Run. Allow access when Google asks (if
 *      it says the app isn't verified: Advanced → Go to the project). The Execution log shows
 *      what each tab reads as vacant now, and the connection token.
 *   3. Deploy → New deployment → gear icon → Web app. Execute as: Me. Who has access: Anyone.
 *      Deploy, and copy the Web app URL. ("Anyone" lets the sync reach it; the token keeps
 *      everyone else out. Who can SEE the spreadsheet is still its Share setting.)
 *   4. On GitHub: the evolution24.net repository → Settings → Secrets and variables → Actions →
 *      New repository secret: VACANCY_SHEET_URL (the Web app URL) and VACANCY_SHEET_TOKEN (the
 *      token from step 2).
 * From then on each sync reads the worksheet first. If it cannot (the script is off, a tab was
 * renamed), the run says so and the last answer is used, for up to three days.
 *
 * A NEW TAB NEXT YEAR ("301 Central 2027"): change its name in TABS below, Save, then Deploy →
 * Manage deployments → pencil → Version: New version → Deploy. The address stays the same.
 * Lost the token? Open the spreadsheet: Evolution24 website → Show the connection token.
 */

// Each building's tab on the website, by its address there. "block": the heading a building's
// units follow, when two share a tab; "until": the heading where the next building begins.
const TABS = {
  '301-central-avenue': { tab: '301 Central 2026' },
  'water-street': { tab: '168-176 N Water St 2026' },
  '145-south-fitzhugh-street': { tab: '145 S Fitzhugh 2026' },
  '181-st-paul-street': { tab: '179-189 St Paul 2026' },
  'biltmore': { tab: '357 Alexander St 2025-2026' },
  '2215-james-street': { tab: '2215 James 2026' },
  '121-park-drive': { tab: '121 Park 2026' },
  '31-genesee-street': { tab: '31 Gen/379 Main 2025-2026', until: '379 Main' },
  '379-south-main-street': { tab: '31 Gen/379 Main 2025-2026', block: '379 Main' },
  '561-south-main-street': { tab: '561 Main 2026' },
};
const NOT_A_HOME = /spot|garage|parking|storage|office|commercial|airbnb|total/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ZONE = 'America/New_York';

const isVacant = (v) => typeof v === 'string' && /vacan/i.test(v);
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

/** The unit as the team typed it; Sheets turned some, like "1-3", into dates (1 March). */
function unitName_(v) {
  if (v instanceof Date) return `${v.getDate()}-${v.getMonth() + 1}`;
  const s = String(v === null || v === undefined ? '' : v).trim();
  return /^\d+\.0$/.test(s) ? s.slice(0, -2) : s;
}

/** 1–12 for a month column's heading ("November", a date, "PAID August 2025"), else 0. */
function monthOf_(h) {
  if (h instanceof Date) return h.getMonth() + 1;
  const s = String(h || '').trim().toLowerCase();
  for (let i = 0; i < 12; i++) if (new RegExp(`^(paid\\s+)?${MONTHS[i]}`).test(s)) return i + 1;
  return 0;
}

/** [{unit, rent}] that one building's rows mark vacant. rows: the tab's values, as getValues gives them. */
function readBuilding_(rows, spec, month) {
  let start = 0;
  let stop = rows.length;
  const first = (r) => String(r[0] || '').toLowerCase();
  if (spec.block) start = rows.findIndex((r) => first(r).includes(spec.block.toLowerCase()));
  if (spec.until) { const u = rows.findIndex((r) => first(r).includes(spec.until.toLowerCase())); if (u >= 0) stop = u; }
  if (start < 0) throw new Error(`no "${spec.block}" heading on ${spec.tab}`);
  rows = rows.slice(start, stop);
  const who = (c) => /tenant|first name/i.test(String(c || ''));
  const h = rows.slice(0, 6).findIndex((r) => r.some(who));
  if (h < 0) throw new Error(`no tenant column on ${spec.tab}`);
  const head = rows[h];
  const tenant = head.findIndex(who);
  const total = head.findIndex((c) => /total (amount due|rent)/i.test(String(c || '')));
  const months = head.map((c, j) => [j, j > tenant ? monthOf_(c) : 0]).filter(([, m]) => m);
  const recent = [0, 1, 2].map((k) => ((month - k - 1 + 12) % 12) + 1);
  const out = [];
  const seen = {};
  rows.slice(h + 1).forEach((r) => {
    const name = unitName_(r[0]);
    const rent = total >= 0 && typeof r[total] === 'number' && r[total] > 0 ? Math.round(r[total]) : null;
    if (name in seen) { if (seen[name] && seen[name].rent === null && rent) seen[name].rent = rent; return; }
    if (!name || /^unit/i.test(name) || [name, ...r.slice(1, tenant)].some((c) => NOT_A_HOME.test(String(c || '')))) return;
    seen[name] = null;
    const filled = months.filter(([j]) => !isBlank(r[j]));
    const [lastJ, lastM] = filled.length ? filled[filled.length - 1] : [-1, 0];
    if (isVacant(r[tenant]) || (isBlank(r[tenant]) && lastJ >= 0 && isVacant(r[lastJ]) && recent.includes(lastM))) {
      seen[name] = { unit: name, rent };
      out.push(seen[name]);
    }
  });
  return out;
}

/** The whole answer: {as_of, buildings: {slug: [{unit, rent}]}}. */
function vacancies_(ss) {
  const now = new Date();
  const month = Number(Utilities.formatDate(now, ZONE, 'M'));
  const plain = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sheets = ss.getSheets();
  const buildings = {};
  Object.keys(TABS).forEach((slug) => {
    const spec = TABS[slug];
    const sheet = sheets.find((s) => plain(s.getName()) === plain(spec.tab));
    if (!sheet) throw new Error(`no tab named "${spec.tab}"`);
    buildings[slug] = readBuilding_(sheet.getDataRange().getValues(), spec, month);
  });
  return { as_of: Utilities.formatDate(now, ZONE, 'yyyy-MM-dd'), buildings };
}

const json_ = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

/** The website's question: POST {"token": "…"}. */
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'Bad request.' }); }
  if (!body.token || body.token !== tokenFor_()) return json_({ error: 'Wrong token.' });
  try {
    return json_(vacancies_(SpreadsheetApp.getActiveSpreadsheet()));
  } catch (err) {
    return json_({ error: `The worksheet could not be read: ${err.message}` });
  }
}

/** Run once from the editor: checks every tab reads, and prints the token. */
function setup() {
  const out = vacancies_(SpreadsheetApp.getActiveSpreadsheet());
  Object.keys(out.buildings).forEach((slug) => console.log(`${slug}: ${out.buildings[slug].map((u) => `${u.unit} $${u.rent}`).join(', ') || 'none'}`));
  console.log('Connection token. Paste the next line, and only that, into GitHub as VACANCY_SHEET_TOKEN:');
  console.log(tokenFor_());
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Evolution24 website')
    .addItem('What the website will list', 'showVacancies')
    .addItem('Show the connection token', 'showToken')
    .addToUi();
}

function showVacancies() {
  const out = vacancies_(SpreadsheetApp.getActiveSpreadsheet());
  const lines = Object.keys(out.buildings).map((slug) => `${TABS[slug].tab}: ${out.buildings[slug].map((u) => `${u.unit} ($${u.rent})`).join(', ') || 'none'}`);
  SpreadsheetApp.getUi().alert('Vacant, as the website will list them at its next update', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function showToken() {
  SpreadsheetApp.getUi().alert('Connection token (GitHub secret VACANCY_SHEET_TOKEN)', tokenFor_(), SpreadsheetApp.getUi().ButtonSet.OK);
}

function tokenFor_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  return token;
}

if (typeof module !== 'undefined') module.exports = { readBuilding_, unitName_, monthOf_, TABS };   // for the tests
