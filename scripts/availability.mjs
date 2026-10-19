#!/usr/bin/env node
/* =============================================================================
   Availability from Rent Manager: what each building has open, and its rent.

     node scripts/availability.mjs              update data/properties.json
     node scripts/availability.mjs --dry-run    say what would change, write nothing

   Signs in to Rent Manager's Web API as the website's read-only user, reads
   each building's units with their type, status, occupancy and market rent,
   and rewrites each building's "units" in data/properties.json, with
   "units_as_of" set to today. python3 scripts/build.py then turns that into
   pages; .github/workflows/availability.yml does both several times a day and
   publishes the result.

   How a unit's state is read is Charlotte Square's (50CharlotteSquare,
   functions/_lib/rentmanager.js), which learned this company's Rent Manager on
   its live data: the embeds it accepts, that an embed comes back only when it
   is named in fields too, and how its occupancy records say vacant, on notice,
   or being made ready. Keep the two in step.

   Settings, from the environment (GitHub: Settings → Secrets and variables → Actions):
     RM_USERNAME, RM_PASSWORD   the website's Rent Manager user (read-only)
     RM_COMPANY                 optional: the company code, "evolution" if not set
     RM_LOCATION_ID             optional: only for a company with several locations
     RM_BASE_URL                only for the local tests, which point it at a stub

   What it keeps and what it changes:
     - Only buildings with a Rent Manager ID ("pid") and no outside leasing site
       ("external") are touched; Charlotte Square keeps its own facts.
     - A unit is matched by its Rent Manager ID ("uid"); what was typed on a unit
       by hand, such as "note", stays with it. A unit whose Rent Manager name ends
       in "-F" is furnished: the site shows it without the "-F", noted Furnished.
     - A building's "hide_units" (unit numbers) keeps those off the site, for a
       home already spoken for before its lease is in Rent Manager.
     - Open means vacant, being made ready, or on notice with a move-out date
       still to come; those last two carry "available": the date.
     - A unit with no market rent is left off and named in the report.
     - Nothing is written when the answer looks wrong: no open units anywhere
       while the site has some, or more open than a quarter of all units (and
       more than ten). Either is far likelier a permissions problem or a misread
       than real; --allow-empty and --allow-many override them.
   It only reads, and never prints the password, the token, or anything about
   a person. Its report names units only.
   ============================================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'data', 'properties.json');

const PAGE = 1000;
const MAX_WAIT_S = 90;
const TRIES = 3;

// What this company's Rent Manager accepted on Charlotte Square's live checks
// (it refused MarketRents). An embed only comes back when named in fields too.
const BASE_FIELDS = ['UnitID', 'PropertyID', 'Name', 'SortOrder'];
const PLAIN_FIELDS = ['UnitTypeID', 'SquareFootage', 'Bedrooms', 'Bathrooms'];
const KNOWN_EMBEDS = ['UnitType', 'UnitStatuses', 'CurrentOccupancyStatus', 'CurrentUnitStatus', 'CurrentMarketRent'];
const FURNISHED = /\s*-\s*F$/i;

export class RMError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

/* ---- Talking to Rent Manager ------------------------------------------------ */
export function client(env) {
  const companyCode = String(env.RM_COMPANY || 'evolution').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(companyCode)) throw new RMError('RM_COMPANY should be the company code alone, such as evolution.');
  if (!env.RM_USERNAME || !env.RM_PASSWORD) throw new RMError('RM_USERNAME and RM_PASSWORD are not set.');
  const base = String(env.RM_BASE_URL || `https://${companyCode}.api.rentmanager.com`).replace(/\/+$/, '');
  const state = { token: null, requests: 0, remaining: null, resetAt: null };
  const scrub = (s) => [env.RM_PASSWORD, state.token].filter((x) => x && String(x).length >= 4)
    .reduce((out, secret) => out.split(String(secret)).join('•••'), String(s));
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

  async function send(method, path, body, token) {
    for (let attempt = 1; ; attempt++) {
      if (state.remaining !== null && state.remaining <= 0) {
        const left = state.resetAt === null ? null : (state.resetAt - Date.now()) / 1000;
        if (left === null || left > MAX_WAIT_S) throw new RMError('Rent Manager’s hourly request limit is used up; the next run carries on.', 429);
        await sleep(Math.max(0, left) + 1);
        state.remaining = null;
      }
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers['X-RM12Api-ApiToken'] = token;
      let res;
      try {
        res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      } catch (err) {
        if (attempt < TRIES) { await sleep(2 * attempt); continue; }
        throw new RMError(`Rent Manager could not be reached (${scrub(err.message).slice(0, 200)}).`);
      }
      state.requests++;
      const n = (h) => { const v = res.headers.get(h); return v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v); };
      if (n('X-RateRemaining') !== null) state.remaining = n('X-RateRemaining');
      if (n('X-RateTimeLeft') !== null) state.resetAt = Date.now() + n('X-RateTimeLeft') * 1000;
      const text = await res.text();
      if (res.status === 429 && attempt < TRIES && n('X-RateTimeLeft') !== null && n('X-RateTimeLeft') <= MAX_WAIT_S) {
        await sleep(n('X-RateTimeLeft') + 1); continue;
      }
      if (res.status >= 500 && attempt < TRIES) { await sleep(2 * attempt); continue; }
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { status: res.status, ok: res.ok, data, total: n('X-Total-Results') };
    }
  }

  function explain(r, what) {
    const said = r.data && typeof r.data === 'object' ? (r.data.UserMessage || r.data.Message || r.data.DeveloperMessage || '') : '';
    const tail = said ? ` Rent Manager said: "${scrub(String(said)).slice(0, 200)}"` : '';
    if (r.status === 401) return `Rent Manager did not accept the login. Check RM_USERNAME and RM_PASSWORD, that the user has Web API access, and, if the company has more than one location, RM_LOCATION_ID.${tail}`;
    if (r.status === 403) return `The website's Rent Manager user is not allowed to read ${what}. Give it read access to properties and units.${tail}`;
    if (r.status === 429) return 'Rent Manager’s hourly limit on API calls is used up. The next run will try again.';
    if (r.status >= 500) return `Rent Manager had a problem answering (${r.status}). The next run will try again.${tail}`;
    return `Rent Manager answered ${r.status} when asked for ${what}.${tail}`;
  }

  async function signIn() {
    const body = { Username: env.RM_USERNAME, Password: env.RM_PASSWORD };
    if (env.RM_LOCATION_ID) body.LocationID = Number(env.RM_LOCATION_ID);
    const r = await send('POST', '/Authentication/AuthorizeUser', body);
    if (!r.ok) throw new RMError(explain(r, 'a login'), r.status);
    const token = typeof r.data === 'string' ? r.data : r.data && (r.data.Token || r.data.ApiToken || r.data.APIToken || r.data.token);
    if (!token) throw new RMError('Rent Manager accepted the login but sent back no token.', r.status);
    state.token = String(token).replace(/^"+|"+$/g, '').trim();
  }

  async function get(path) {
    if (!state.token) await signIn();
    let r = await send('GET', path, undefined, state.token);
    if (r.status === 401) { await signIn(); r = await send('GET', path, undefined, state.token); }
    return r;
  }

  return { get, explain, state, scrub };
}

const asList = (data) => (Array.isArray(data) ? data
  : data && Array.isArray(data.Items) ? data.Items
  : data && typeof data === 'object' ? [data] : []);
const unique = (a) => [...new Set(a)];

/** A building's units with the fields and embeds asked for, all pages; through
 *  the property when this Rent Manager will not filter units by property. */
async function unitsOf(rm, pid, embeds) {
  const qs = `fields=${unique([...BASE_FIELDS, ...PLAIN_FIELDS, ...embeds]).join(',')}${embeds.length ? `&embeds=${embeds.join(',')}` : ''}`;
  const rows = [];
  for (let page = 1; page <= 50; page++) {
    let r = await rm.get(`/Units?filters=PropertyID,eq,${pid}&${qs}&pagesize=${PAGE}&pagenumber=${page}`);
    if (r.status === 400 && page === 1) {
      const alt = await rm.get(`/Properties/${pid}/Units?${qs}&pagesize=${PAGE}&pagenumber=${page}`);
      if (!alt.ok) return { error: r };     // not the filter, then: the fields or embeds were refused
      r = alt;
    }
    if (r.status === 404) return rows;
    if (!r.ok) return { error: r };
    const batch = asList(r.data);
    rows.push(...batch);
    if (batch.length < PAGE || (r.total !== null && rows.length >= r.total)) return rows;
  }
  return rows;
}

/** The embeds this Rent Manager accepts: all of them if it takes them together,
 *  otherwise each one it takes on its own (asked once, on the first building). */
async function acceptedEmbeds(rm, pid) {
  const all = await unitsOf(rm, pid, KNOWN_EMBEDS);
  if (Array.isArray(all)) return { embeds: KNOWN_EMBEDS, first: all };
  if (all.error.status !== 400) throw new RMError(rm.explain(all.error, 'units'), all.error.status);
  const ok = [];
  for (const e of KNOWN_EMBEDS) {
    const one = await unitsOf(rm, pid, [e]);
    if (Array.isArray(one)) ok.push(e);
  }
  return { embeds: ok, first: null };
}

/* ---- Reading a unit (Charlotte Square's normalize, kept in step) ------------ */
const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const pos = (v) => { const n = toNum(v); return n && n > 0 ? n : null; };
const toDay = (v) => {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m && !m[1].startsWith('0001') && !m[1].startsWith('1900') ? m[1] : null;
};
const nameOf = (o) => {
  if (!o || typeof o !== 'object') return o;
  const inner = [o.UnitStatusType, o.StatusType, o.OccupancyStatusType, o.Type].find((t) => t && typeof t === 'object');
  return pick(o.Name, o.StatusName, o.Description, typeof o.Status === 'string' ? o.Status : undefined, inner && pick(inner.Name, inner.Description));
};
function currentOf(list, today) {
  if (!Array.isArray(list) || !list.length) return null;
  const live = list.filter((x) => x && typeof x === 'object')
    .map((x) => ({ x, from: toDay(pick(x.StartDate, x.DateFrom, x.EffectiveDate)) || '0000', to: toDay(pick(x.EndDate, x.DateTo)) }))
    .filter((r) => r.from <= today && (!r.to || r.to >= today))
    .sort((a, b) => (a.from < b.from ? 1 : -1));
  return live.length ? live[0].x : null;
}
function currentRent(u, today) {
  const direct = pick(pos(typeof u.MarketRent === 'object' ? undefined : u.MarketRent), pos(u.Rent), pos(u.AskingRent), pos(u.AdvertisedRent), pos(u.DefaultRent));
  if (direct) return direct;
  const cur = [u.CurrentMarketRent, u.MarketRent].find((o) => o && typeof o === 'object' && !Array.isArray(o));
  if (cur) {
    const a = toNum(pick(cur.Amount, cur.MarketRent, cur.Rent));
    if (a) return a;
  }
  const list = pick(u.MarketRents, u.UnitMarketRents);
  if (Array.isArray(list) && list.length) {
    const live = list
      .map((r) => ({ amount: toNum(pick(r.Amount, r.MarketRent, r.Rent)), from: toDay(pick(r.DateFrom, r.FromDate, r.StartDate, r.EffectiveDate)) || '0000' }))
      .filter((r) => r.amount && r.from <= today)
      .sort((a, b) => (a.from < b.from ? 1 : -1));
    if (live.length) return live[0].amount;
  }
  const type = u.UnitType || {};
  return toNum(pick(type.MarketRent, type.Rent, type.DefaultRent));
}
function occupancyOf(u) {
  const o = u.CurrentOccupancyStatus;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  return {
    hasType: 'OccupancyType' in o,
    type: typeof o.OccupancyType === 'string' ? o.OccupancyType.toLowerCase() : '',
    empty: !Object.keys(o).some((k) => o[k] !== null && o[k] !== '' && k !== 'MetaTag'),
    moveOut: toDay(pick(o.ExpectedMoveOutDate, o.MoveOutDate)),
    ended: toDay(o.EndDate),
  };
}
function fromTypeName(type, part) {
  const m = /(\d+)\s*(?:B|BR|BD|Bed(?:room)?s?)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:B|BA|Bath(?:room)?s?)\b/i.exec(String(type && type.Name || ''));
  return m ? Number(m[part]) : undefined;
}
const NOT_FOR_RENT = /model|\bdown\b|offline|admin|employee|unavailable|not available|hold/;
const RENTED = /rented|leased/;

/** One Rent Manager unit, read: its number, rooms, size, rent, and whether and when it is open. */
export function normalize(u, today) {
  const type = u.UnitType && typeof u.UnitType === 'object' ? u.UnitType : {};
  const id = pick(u.UnitID, u.Id, u.ID);
  if (id === undefined) return null;
  const fromList = currentOf(u.UnitStatuses, today) || currentOf(u.OccupancyStatuses, today);
  const t = String(pick(
    nameOf(u.CurrentOccupancyStatus), nameOf(u.OccupancyStatus), nameOf(u.CurrentUnitStatus),
    nameOf(u.UnitStatus), nameOf(u.VacancyStatus), nameOf(u.Vacancy), nameOf(fromList),
    typeof u.Status === 'string' ? u.Status : nameOf(u.Status), '',
  )).toLowerCase();
  const vacantFlag = pick(u.IsVacant, u.Vacant);
  // Order matters. "Vacant-Rented" and "Notice-Rented" are already leased; a
  // model, a down unit or an office is never for rent; "not ready" is empty
  // but being prepared, so it is open soon, not now. One step stricter than
  // Charlotte Square: a unit Rent Manager calls rented or leased is taken even
  // when its occupancy record still says vacant or on notice.
  let status = 'unknown';
  let occDate = null;
  const occ = occupancyOf(u);
  const rented = RENTED.test(t.replace(/un(rented|leased)/g, ''));
  if (rented) status = 'taken';
  else if (occ && (occ.hasType || occ.empty) && !NOT_FOR_RENT.test(t)) {
    if (/vacant/.test(occ.type) || occ.empty) status = 'vacant';
    else if (/future|pending|pre/.test(occ.type)) status = 'taken';
    else if (occ.ended && occ.ended < today) status = 'vacant';
    else if (occ.moveOut && occ.moveOut >= today) { status = 'notice'; occDate = occ.moveOut; }
    else status = 'taken';
    if (status === 'vacant' && /not ready|make[- ]?ready|unready/.test(t)) status = 'making-ready';
  }
  if (status !== 'unknown') { /* settled by the occupancy record */ }
  else if (NOT_FOR_RENT.test(t)) status = 'taken';
  else if (/occupied/.test(t)) status = 'taken';
  else if (/not ready|make[- ]?ready|unready/.test(t)) status = 'making-ready';
  else if (vacantFlag === true || /vacant|available|ready/.test(t)) status = 'vacant';
  else if (/notice|vacating|move[- ]?out/.test(t)) status = 'notice';
  else if (vacantFlag === false) status = 'taken';
  const statusObj = [u.CurrentOccupancyStatus, u.OccupancyStatus, u.CurrentUnitStatus, u.UnitStatus, u.Vacancy, fromList]
    .find((o) => o && typeof o === 'object' && !Array.isArray(o)) || {};
  const available = occDate || toDay(pick(u.AvailableDate, u.ReadyDate, u.DateAvailable, u.VacateDate, u.ExpectedMoveOutDate,
    statusObj.AvailableDate, statusObj.ReadyDate, statusObj === u.CurrentOccupancyStatus ? undefined : statusObj.EndDate, statusObj.Date));
  return {
    id,
    unit: String(pick(u.Name, u.UnitName, u.Number, id)).trim(),
    beds: pick(pos(u.Bedrooms), pos(u.Beds), pos(type.Bedrooms), fromTypeName(type, 1)) ?? 0,
    baths: pick(pos(u.Bathrooms), pos(u.Baths), pos(type.Bathrooms), fromTypeName(type, 2)) ?? null,
    sqft: pick(pos(u.SquareFootage), pos(u.SqFt), pos(type.SquareFootage)) ?? null,
    rent: currentRent(u, today),
    status,
    available,
  };
}

export const isOpen = (n, today) => n.status === 'vacant' || n.status === 'making-ready'
  || (n.status === 'notice' && Boolean(n.available) && n.available > today);

/** A unit as data/properties.json lists it, keeping what was typed on it by hand. */
export function siteUnit(n, kept, today) {
  const furnished = FURNISHED.test(n.unit);
  const unit = { uid: n.id, unit: n.unit.replace(FURNISHED, ''), beds: Math.round(n.beds || 0) };
  if (n.baths) unit.baths = Number.isInteger(n.baths) ? n.baths : Math.round(n.baths * 2) / 2;
  if (n.sqft) unit.sqft = Math.round(n.sqft);
  else if (kept && kept.sqft) unit.sqft = kept.sqft;      // Rent Manager has no size for it: keep ours
  unit.rent = Math.round(n.rent);
  if (n.available && n.available > today) unit.available = n.available;
  for (const [k, v] of Object.entries(kept || {})) {
    if (!['uid', 'unit', 'beds', 'baths', 'sqft', 'rent', 'available'].includes(k)) unit[k] = v;
  }
  if (furnished && !unit.note) unit.note = 'Furnished';
  return unit;
}

const natural = (s) => String(s).split(/(\d+)/).map((t) => (/^\d+$/.test(t) ? t.padStart(8, '0') : t)).join('');
const kind = (u) => (u.beds ? `${u.beds} bed` : 'studio');
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/** data, updated in place from each building's units as read. Returns the report. */
export function apply(data, unitsByPid, today) {
  const report = [];
  const skipped = [];
  let total = 0;
  let open = 0;
  for (const p of data.properties) {
    if (p.external || !p.pid || !unitsByPid.has(p.pid)) continue;
    const read = unitsByPid.get(p.pid).map((u) => normalize(u, today)).filter(Boolean);
    total += read.length;
    const hidden = new Set((p.hide_units || []).map(String));
    const kept = new Map((p.units || []).map((u) => [u.uid, u]));
    const units = [];
    for (const n of read.filter((x) => isOpen(x, today))) {
      if (hidden.has(n.unit.replace(FURNISHED, ''))) continue;
      if (!n.rent) { skipped.push(`${p.name} unit ${n.unit.replace(FURNISHED, '')}: open, but no market rent in Rent Manager`); continue; }
      units.push(siteUnit(n, kept.get(n.id), today));
    }
    units.sort((a, b) => (natural(a.unit) < natural(b.unit) ? -1 : 1));
    open += units.length;
    const lines = [];
    const ids = new Set(units.map((u) => u.uid));
    for (const u of units) {
      const was = kept.get(u.uid);
      const when = u.available ? `, from ${u.available}` : '';
      if (!was) lines.push(`  + ${u.unit}: ${kind(u)}, ${money(u.rent)}${when}`);
      else if (was.rent !== u.rent) lines.push(`  ~ ${u.unit}: ${money(was.rent)} → ${money(u.rent)}`);
      else if (JSON.stringify(was) !== JSON.stringify(u)) lines.push(`  ~ ${u.unit}: details updated${when}`);
    }
    for (const [uid, was] of kept) if (!ids.has(uid)) lines.push(`  − ${was.unit}: no longer open`);
    if (lines.length) report.push(`${p.name} (${units.length} open)`, ...lines);
    p.units = units;
  }
  return { report, skipped, total, open };
}

export function todayInRochester(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export async function run({ env = process.env, argv = process.argv.slice(2), file = DATA, now = new Date(), log = console.log } = {}) {
  const dry = argv.includes('--dry-run');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const today = todayInRochester(now);
  const rm = client(env);
  const pids = data.properties.filter((p) => p.pid && !p.external).map((p) => p.pid);
  const before = data.properties.filter((p) => !p.external).reduce((s, p) => s + (p.units || []).length, 0);

  const { embeds, first } = await acceptedEmbeds(rm, pids[0]);
  const unitsByPid = new Map([[pids[0], first]]);
  for (const pid of pids) {
    if (unitsByPid.get(pid)) continue;
    const rows = await unitsOf(rm, pid, embeds);
    if (!Array.isArray(rows)) throw new RMError(rm.explain(rows.error, `the units of property ${pid}`), rows.error.status);
    unitsByPid.set(pid, rows);
  }
  if (!first) {   // the first building was only used to find the embeds; read it properly
    const rows = await unitsOf(rm, pids[0], embeds);
    if (!Array.isArray(rows)) throw new RMError(rm.explain(rows.error, `the units of property ${pids[0]}`), rows.error.status);
    unitsByPid.set(pids[0], rows);
  }

  const { report, skipped, total, open } = apply(data, unitsByPid, today);
  log(`Rent Manager: ${total} units read across ${pids.length} buildings, ${open} open; ${rm.state.requests} requests.`
    + (embeds.length < KNOWN_EMBEDS.length ? ` (It took only these embeds: ${embeds.join(', ') || 'none'}.)` : ''));
  log(report.length ? report.join('\n') : 'No change to what is open or its rents.');
  skipped.forEach((s) => log(`Left off: ${s}`));
  if (open === 0 && before > 0 && !argv.includes('--allow-empty')) {
    throw new RMError(`Rent Manager shows nothing open anywhere, but the site lists ${before}. Nothing written: check the website user's permissions in Rent Manager, or run with --allow-empty if every building really is full.`);
  }
  if (open > Math.max(10, Math.ceil(total * 0.25)) && !argv.includes('--allow-many')) {
    throw new RMError(`Rent Manager shows ${open} of ${total} units open, more than a quarter. That is far likelier a misread than real, so nothing was written. Check a few in Rent Manager, then run with --allow-many if it is right.`);
  }
  if (dry) { log('Dry run: nothing written.'); return { report, written: false }; }
  data.units_as_of = today;
  writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
  log(`Wrote data/properties.json (availability as of ${today}).`);
  return { report, written: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((err) => {
    console.error(`Availability: ${err.message}`);
    process.exit(1);
  });
}
