#!/usr/bin/env node
/* =============================================================================
   Asks the lease worksheet what is vacant, and saves its answer as
   data/vacancy-sheet.json for scripts/availability.mjs.

     node scripts/fetch-vacancies.mjs

   The worksheet's script (tools/lease-sheet/Vacancies.gs, a web app in the
   LEASE WORKSHEETS spreadsheet) answers a POST {token} with
   {as_of, buildings: {slug: [{unit, rent}]}}: unit numbers and rents only.

   Settings, from the environment (GitHub: Settings → Secrets and variables → Actions):
     VACANCY_SHEET_URL     the script's Web app URL (…/exec)
     VACANCY_SHEET_TOKEN   the token its setup printed

   Never fails the sync: without the settings it does nothing, and if the
   worksheet cannot be reached or answers wrongly it says so and keeps the last
   answer, which availability.mjs stops trusting after three days.
   ============================================================================= */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'vacancy-sheet.json');
const ABOUT = 'From the leasing team\'s LEASE WORKSHEETS (tools/lease-sheet/Vacancies.gs, fetched by scripts/fetch-vacancies.mjs, '
  + 'or scripts/vacancy_sheet.py from an export): the units each building\'s tab marks vacant, with the rent to advertise '
  + '(Total Amount Due). scripts/availability.mjs lists exactly these, at these rents, while as_of is recent. No tenant details.';

/** The answer, checked: only unit numbers and rents for buildings the site knows the shape of. */
export function checked(answer) {
  if (!answer || typeof answer !== 'object') throw new Error('it did not answer with JSON');
  if (answer.error) throw new Error(`it said: ${String(answer.error).slice(0, 200)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(answer.as_of))) throw new Error('its answer has no date');
  if (!answer.buildings || typeof answer.buildings !== 'object') throw new Error('its answer has no buildings');
  const buildings = {};
  for (const [slug, units] of Object.entries(answer.buildings)) {
    if (!/^[a-z0-9-]{2,60}$/.test(slug) || !Array.isArray(units)) throw new Error(`its answer for "${slug.slice(0, 40)}" is not a list`);
    buildings[slug] = units.map((u) => {
      const unit = String(u && u.unit || '').trim();
      if (!/^[\w .\-/#]{1,20}$/.test(unit)) throw new Error(`a unit at ${slug} is not a unit number`);
      const num = (v, lo, hi) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < lo || Number(v) > hi ? null : Number(v));
      const rent = num(u.rent, 1, 99999);
      return { unit, rent: rent && Math.round(rent), beds: num(u.beds, 0, 6), baths: num(u.baths, 0.5, 6),
        sqft: num(u.sqft, 150, 20000), furnished: u.furnished === true, commercial: u.commercial === true };
    });
  }
  if (!Object.keys(buildings).length) throw new Error('its answer names no buildings');
  return { _about: ABOUT, as_of: answer.as_of, buildings };
}

export async function fetchVacancies({ env = process.env, file = OUT, log = console.log } = {}) {
  const url = String(env.VACANCY_SHEET_URL || '').trim();
  const token = String(env.VACANCY_SHEET_TOKEN || '').trim();
  if (!url || !token) { log('Lease worksheet: not connected (VACANCY_SHEET_URL and VACANCY_SHEET_TOKEN); the last answer stays.'); return false; }
  try {
    const res = await fetch(url, {
      method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }), signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let answer;
    try { answer = JSON.parse(text); } catch { throw new Error(`it answered ${res.status}, not JSON (is the web app deployed for "Anyone"?)`); }
    const data = checked(answer);
    writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
    const n = Object.values(data.buildings).reduce((s, u) => s + u.length, 0);
    log(`Lease worksheet: read ${data.as_of}, ${n} vacant across ${Object.keys(data.buildings).length} buildings.`);
    return true;
  } catch (err) {
    log(`::warning::Lease worksheet could not be read: ${err.message}. The last answer stays, and is trusted for three days from when it was read.`);
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) fetchVacancies();
