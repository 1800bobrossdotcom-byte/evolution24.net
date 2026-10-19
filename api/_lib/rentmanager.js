/* =============================================================================
   Each website enquiry about a building, added to Rent Manager as a prospect
   of that building, so nobody types it in again. Off until RM_PROSPECTS=on.

   Rent Manager's Prospects resource takes a new prospect by POST, with its
   building (PropertyID), name, a contact with the email and phone, and
   optionally the lead source and target move-in. It can only create one with
   the status "Prospect"; moving it along is the team's, in Rent Manager.
   (Rent Manager 12 Web API: Prospects, Contacts, PhoneNumbers; release notes
   12.230 on creating prospects.) An enquiry with no building picked is not
   sent: Rent Manager files every prospect under a property.

   One prospect per person per building: if the same email asked about the
   same building in the last 90 days and is already in Rent Manager, the new
   enquiry is noted against that prospect instead of making a second.

   Environment variables (Vercel → Settings → Environment Variables):
     RM_PROSPECTS        on, to switch this on
     RM_USERNAME, RM_PASSWORD
                         a Rent Manager user that may add prospects, and
                         nothing else it does not need; not the read-only
                         availability user if that one cannot write
     RM_COMPANY          optional: the company code, "evolution" if not set
     RM_LOCATION_ID      optional: only for a company with several locations
     RM_LEAD_SOURCE_ID   optional: the ID of Rent Manager's "Website" lead source
     RM_PHONE_TYPE_ID    optional: the ID of the phone type to file numbers as
     RM_BASE_URL         only for the local tests, which point it at a stub
   Try it on one test enquiry first, and check the prospect in Rent Manager.
   ============================================================================= */
'use strict';

const { CONFIG, labelOf, moveInLabel } = require('./leads.js');

const TIMEOUT_MS = 12000;
const DEDUPE_DAYS = 90;
let cached = { key: '', token: '' };     // the sign-in, kept while this server instance is warm

const rmOn = (env) => /^(on|yes|true|1)$/i.test(String(env.RM_PROSPECTS || '').trim()) && Boolean(env.RM_USERNAME && env.RM_PASSWORD);
const base = (env) => String(env.RM_BASE_URL || `https://${String(env.RM_COMPANY || 'evolution').trim().toLowerCase()}.api.rentmanager.com`).replace(/\/+$/, '');
const scrub = (env, s) => [env.RM_PASSWORD, cached.token].filter((x) => x && String(x).length >= 4)
  .reduce((out, secret) => out.split(String(secret)).join('•••'), String(s));

async function call(env, path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-RM12Api-ApiToken'] = token;
  const res = await fetch(base(env) + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

const said = (env, r) => {
  const d = r.data;
  const words = d && typeof d === 'object' ? (d.UserMessage || d.Message || d.DeveloperMessage || '') : '';
  return words ? ` Rent Manager said: ${scrub(env, String(words)).slice(0, 200)}` : '';
};

async function signIn(env) {
  const key = `${base(env)}|${env.RM_USERNAME}|${env.RM_LOCATION_ID || ''}`;
  if (cached.key === key && cached.token) return cached.token;
  const body = { Username: env.RM_USERNAME, Password: env.RM_PASSWORD };
  if (env.RM_LOCATION_ID) body.LocationID = Number(env.RM_LOCATION_ID);
  const r = await call(env, '/Authentication/AuthorizeUser', { method: 'POST', body });
  const token = typeof r.data === 'string' ? r.data : r.data && (r.data.Token || r.data.ApiToken || r.data.token);
  if (!r.ok || !token) throw new Error(`Rent Manager did not accept the login (${r.status}).${said(env, r)}`);
  cached = { key, token: String(token).replace(/^"+|"+$/g, '') };
  return cached.token;
}

/** What Rent Manager is sent: the building, the person, and what they asked. */
function prospectFor(env, row) {
  const contact = { FirstName: row.first_name, LastName: row.last_name, Email: row.email, IsPrimary: true };
  if (row.phone) {
    const phone = { PhoneNumber: row.phone, IsPrimary: true };
    if (env.RM_PHONE_TYPE_ID) phone.PhoneNumberTypeID = Number(env.RM_PHONE_TYPE_ID);
    contact.PhoneNumbers = [phone];
  }
  const asked = [labelOf('interest', row.interest), row.unit && `asked about ${row.unit}`,
    row.move_in && `moving in ${moveInLabel(row.move_in)}`].filter(Boolean).join(', ');
  const p = {
    PropertyID: CONFIG.properties[row.property].pid,
    FirstName: row.first_name,
    LastName: row.last_name,
    Comment: `Website enquiry ${row.ref}${asked ? `: ${asked}` : ''}.`.slice(0, 500),
    Contacts: [contact],
  };
  if (row.message) p.WebMessage = String(row.message).slice(0, 2000);
  if (/^\d{4}-\d{2}$/.test(row.move_in || '')) p.MoveInDate = `${row.move_in}-01T00:00:00`;
  if (env.RM_LEAD_SOURCE_ID) p.LeadSourceID = Number(env.RM_LEAD_SOURCE_ID);
  return p;
}

/** Add the enquiry to Rent Manager. {tried, ok, id, note}; never throws. */
async function addProspect(env, row) {
  if (!rmOn(env)) return { tried: false, ok: false, note: 'Sending leads to Rent Manager is off (RM_PROSPECTS).' };
  if (!row.property || !CONFIG.properties[row.property]) return { tried: false, ok: false, note: 'No building picked, so not sent to Rent Manager.' };
  if (env.DB && row.id) {
    try {
      const had = await env.DB.prepare(
        `SELECT rm_id, ref FROM inquiries
          WHERE lower(email) = lower(?) AND property = ? AND rm_ok = 1 AND rm_id IS NOT NULL AND id <> ? AND ts > ?
          ORDER BY ts DESC LIMIT 1`,
      ).bind(row.email, row.property, row.id, Math.floor(Date.now() / 1000) - DEDUPE_DAYS * 86400).first();
      if (had) return { tried: true, ok: true, id: had.rm_id, note: `Already in Rent Manager from enquiry ${had.ref}.` };
    } catch { /* no history to check: carry on */ }
  }
  try {
    let token = await signIn(env);
    let r = await call(env, '/Prospects', { method: 'POST', token, body: [prospectFor(env, row)] });
    if (r.status === 401) {
      cached = { key: '', token: '' };
      token = await signIn(env);
      r = await call(env, '/Prospects', { method: 'POST', token, body: [prospectFor(env, row)] });
    }
    if (!r.ok) {
      const why = r.status === 403 ? 'The Rent Manager user may not add prospects.' : `Rent Manager answered ${r.status}.`;
      return { tried: true, ok: false, note: `${why}${said(env, r)}` };
    }
    const saved = Array.isArray(r.data) ? r.data[0] : r.data;
    const id = saved && (saved.ProspectID || saved.ProspectDisplayID || saved.ID);
    return { tried: true, ok: true, id: id ? String(id) : null, note: 'Added to Rent Manager as a prospect.' };
  } catch (err) {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { tried: true, ok: false, note: timeout ? 'Rent Manager took too long to answer.' : scrub(env, String(err.message || err)).slice(0, 300) };
  }
}

/** Send it, and note how it went on the enquiry. */
async function prospectAndRecord(env, row) {
  const result = await addProspect(env, row);
  if (result.tried && env.DB && row.id) {
    await env.DB.prepare('UPDATE inquiries SET rm_ok = ?, rm_id = ?, rm_note = ? WHERE id = ?')
      .bind(result.ok ? 1 : 0, result.id || null, result.note, row.id).run().catch(() => {});
  }
  return result;
}

module.exports = { rmOn, addProspect, prospectAndRecord, prospectFor };
