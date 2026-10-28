/* =============================================================================
   POST /api/inquiry/ — one enquiry, from a building's own form or the contact
   page, on Vercel.

   Charlotte Square's intake, for a site with eleven buildings:

     1. The enquiry is saved in the database (api/_lib/db.js), when one is
        connected: the dashboard's record, which nothing downstream can lose.
     2. At the same time it goes to the lead sheet (tools/lead-sheet/Code.gs),
        onto its building's tab, or General when none was picked; the visitor
        gets a short confirmation email (api/_lib/confirm.js); and, if switched
        on, it becomes a prospect of that building in Rent Manager
        (api/_lib/rentmanager.js).
     3. Then an email to everyone in LEAD_TO, saying how 1 and 2 went. Reply-To
        is the prospect, so replying in Gmail answers them.

   The visitor is told it worked if the database, the sheet or the email has
   it. Only when all three fail are they asked to call instead, because only
   then is nothing written down.

   Settings: see api/_lib/leads.js (email and the sheet), api/_lib/db.js (the
   database), api/_lib/rentmanager.js (Rent Manager). The allowed choices, the
   buildings and their open units come from leads-config.json, which
   scripts/build.py writes from the same data as the forms and the lead sheet,
   so they cannot drift apart. Charlotte Square is not in it: it has its own
   site, form and lead sheet.
   ============================================================================= */
'use strict';

const crypto = require('crypto');
const { database } = require('./_lib/db.js');
const { visitorHash, today } = require('./_lib/auth.js');
const { CONFIG, sheetOn, emailOn, moveInValue, leadFor, notify, logEmail, sheetAndRecord } = require('./_lib/leads.js');
const { confirmAndRecord } = require('./_lib/confirm.js');
const { prospectAndRecord } = require('./_lib/rentmanager.js');

/* Submissions per address per window. High enough that a couple sent in
   earnest, or a shared office connection, never trips it; low enough to be
   useless to a script. In the database when there is one; otherwise in memory,
   per server instance: a speed bump, not a wall. */
const MAX_PER_WINDOW = 5;
const WINDOW_S = 10 * 60;
const attempts = new Map();

const LIMITS = { first_name: 80, last_name: 80, email: 160, phone: 40, message: 2000, attribution: 120 };

/** Text as it may be stored: control characters out (they can fake email
 *  headers or hide text), trimmed, capped. Anything but a string is nothing. */
function clean(v, n) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}
/** The message keeps its line breaks. */
function cleanMessage(v, n) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim().slice(0, n);
}
/* Deliberately permissive: this catches a typo, it does not adjudicate RFC 5322. */
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const pick = (list, v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(list, v) ? v : '');
/** A page of this site: a path and nothing else. */
const pagePath = (v) => { const s = clean(v, 200); return /^\/[\w\-./]*$/.test(s) ? s : ''; };

/** A reference the team can quote: the date, then four characters that are
 *  hard to misread. Also what keeps a retried post from becoming two rows. */
function makeRef(now) {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let tail = '';
  for (const b of crypto.randomBytes(4)) tail += alphabet[b % alphabet.length];
  return `E24-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${tail}`;
}

function throttledInMemory(ip, now) {
  const hit = attempts.get(ip);
  if (!hit || now - hit.start >= WINDOW_S) {
    attempts.set(ip, { start: now, count: 1 });
    if (attempts.size > 5000) [...attempts.keys()].slice(0, 2500).forEach((k) => attempts.delete(k));
    return false;
  }
  hit.count += 1;
  return hit.count > MAX_PER_WINDOW;
}

/** The sliding window, in the database. A throttle that cannot be read fails
 *  open: it must never become an outage on the one form that earns money. */
async function throttled(db, ip, now) {
  if (!db) return throttledInMemory(ip, now);
  try {
    const row = await db.prepare('SELECT count, window_start FROM inquiry_attempts WHERE ip = ?').bind(ip).first();
    if (!row || now - row.window_start >= WINDOW_S) {
      await db.prepare(`INSERT INTO inquiry_attempts (ip, count, window_start) VALUES (?, 1, ?)
                        ON CONFLICT(ip) DO UPDATE SET count = 1, window_start = excluded.window_start`).bind(ip, now).run();
      return false;
    }
    if (row.count >= MAX_PER_WINDOW) return true;
    await db.prepare('UPDATE inquiry_attempts SET count = count + 1 WHERE ip = ?').bind(ip).run();
    return false;
  } catch {
    return throttledInMemory(ip, now);
  }
}

/** Where this visitor came from, read off their own pageviews (api/collect.js)
 *  when the page could not say: the first one today or yesterday carrying a
 *  campaign tag or an outside referrer, else simply the first. Needs no cookie. */
async function firstTouch(db, ip, ua) {
  const salt = process.env.VISITOR_SALT || 'unset';
  const now = new Date();
  const d0 = today(now);
  const d1 = today(new Date(now.getTime() - 86400000));
  const [v0, v1] = await Promise.all([visitorHash(ip, ua, salt, d0), visitorHash(ip, ua, salt, d1)]);
  return db.prepare(
    `SELECT path, ref, utm_source, utm_medium, utm_campaign FROM events
      WHERE kind = 'pageview' AND ((day = ? AND visitor = ?) OR (day = ? AND visitor = ?))
      ORDER BY (utm_source IS NULL AND ref IS NULL), ts LIMIT 1`,
  ).bind(d0, v0, d1, v1).first();
}

async function readBody(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  let raw = req.body;
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  if (raw === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 64 * 1024) throw new Error('too large');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  } else if (Buffer.isBuffer(raw)) {
    raw = raw.toString('utf8');
  }
  if (type === 'application/json') return JSON.parse(raw || '{}');
  return Object.fromEntries(new URLSearchParams(raw || ''));
}

/** The enquiry as stored: every choice checked against the form's own lists. */
function rowFrom(form, req, now) {
  const slug = pick(CONFIG.properties, form.property);
  const building = slug ? CONFIG.properties[slug] : null;
  const units = (building && building.units) || {};
  const unitId = pick(units, String(form.unit || ''));
  const unit = unitId ? units[unitId] : null;
  const a = (k) => clean(form[k], LIMITS.attribution);
  const ref = a('ref').replace(/^www\./, '');
  return {
    ref: makeRef(now),
    ts: Math.floor(now.getTime() / 1000),
    day: today(now),
    property: slug,
    property_name: building ? building.name : '',
    first_name: clean(form.first_name, LIMITS.first_name),
    last_name: clean(form.last_name, LIMITS.last_name),
    email: clean(form.email, LIMITS.email),
    phone: clean(form.phone, LIMITS.phone),
    interest: pick(CONFIG.interest, form.interest),
    bedrooms: pick(CONFIG.bedrooms, form.bedrooms) || (unit ? unit.bedrooms : ''),
    unit: unit ? unit.label : '',
    unit_id: unitId ? Number(unitId) : null,
    move_in: moveInValue(form.move_in),
    source: pick(CONFIG.source, form.source),
    message: cleanMessage(form.message, LIMITS.message),
    country: /^[A-Z]{2}$/.test(String(req.headers['x-vercel-ip-country'] || '')) ? req.headers['x-vercel-ip-country'] : null,
    form: form.form === 'property' && slug ? 'property' : 'contact',
    page: pagePath(form.page) || (form.form === 'property' && slug ? `/properties/${slug}/` : '/contact-us/'),
    utm_source: a('utm_source'), utm_medium: a('utm_medium'), utm_campaign: a('utm_campaign'),
    referrer: /^[a-z0-9.-]+$/i.test(ref) ? ref : '',
    landing: pagePath(form.landing),
    site: String(req.headers.host || '').slice(0, 100),
  };
}

const COLUMNS = ['ref', 'ts', 'day', 'property', 'property_name', 'first_name', 'last_name', 'email', 'phone', 'interest',
  'bedrooms', 'unit', 'unit_id', 'move_in', 'source', 'message', 'country', 'form', 'page',
  'utm_source', 'utm_medium', 'utm_campaign', 'referrer', 'landing'];

module.exports = async function handler(req, res) {
  const wantsJson = /application\/json/i.test(`${req.headers['content-type'] || ''} ${req.headers.accept || ''}`);
  let back = '/contact-us/';
  const reply = (status, body) => {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'no-store');
    if (wantsJson) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    } else {
      // The form without JavaScript: back to the page it was on, where the
      // fragment shows the matching notice with CSS alone.
      res.setHeader('Location', `${back}#${body.ok ? 'sent' : 'not-sent'}`);
      res.statusCode = 303;
      res.end();
    }
  };

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end();
    return;
  }
  // Only this site's own pages may post here.
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* unreadable: refused below */ }
    if (host !== req.headers.host) return reply(403, { error: 'Not allowed.' });
  }

  let form;
  try {
    form = (await readBody(req)) || {};
  } catch {
    return reply(400, { error: 'Please send the form again.' });
  }
  if (form.form === 'property' && pagePath(form.page)) back = pagePath(form.page);

  // The honeypot: a field people never see. Anything that fills it in is not a person.
  if (clean(form.website, 200)) return reply(202, { ok: true });

  const now = new Date();
  const db = database();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (await throttled(db, ip, Math.floor(now.getTime() / 1000))) {
    return reply(429, { error: `Too many messages from this connection. Please call us on ${CONFIG.office_phone}.` });
  }

  const row = rowFrom(form, req, now);
  if (!row.first_name || !row.last_name || !looksLikeEmail(row.email)) return reply(400, { error: 'Please check your name and email address.' });

  if (!db && !sheetOn() && !emailOn()) {
    console.error('inquiry: no database, lead sheet or email is configured; nothing was recorded for', row.ref);
    return reply(503, { error: `Our form is not connected yet. Please call us on ${CONFIG.office_phone}.` });
  }

  const env = { ...process.env, DB: db };
  // 1. The database, first: the record the dashboard keeps.
  let stored = false;
  if (db) {
    try {
      if (!row.utm_source && !row.referrer) {
        const t = await firstTouch(db, ip, String(req.headers['user-agent'] || '')).catch(() => null);
        if (t) Object.assign(row, { utm_source: t.utm_source || '', utm_medium: t.utm_medium || '', utm_campaign: t.utm_campaign || '', referrer: t.ref || '', landing: row.landing || t.path || '' });
      }
      const r = await db.prepare(`INSERT INTO inquiries (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')}) RETURNING id`)
        .bind(...COLUMNS.map((c) => (row[c] === '' ? null : row[c]))).first();
      row.id = r.id;
      stored = Boolean(row.id);
    } catch (err) {
      console.error('inquiry', row.ref, 'database:', err.message);
    }
  }

  // 2. The sheet, the visitor's confirmation and Rent Manager, side by side. Links in
  // emails always point at the live site, whatever address the request came in on.
  const reqOrigin = CONFIG.site;
  const [sheet, , rm] = await Promise.all([
    sheetAndRecord(env, row),
    stored ? confirmAndRecord(env, row, reqOrigin) : Promise.resolve(null),
    prospectAndRecord(env, row),
  ]);

  // 3. The team's email, saying how those went.
  const mail = await notify(env, leadFor(row), { sheet, rm, origin: reqOrigin });
  if (stored) {
    await logEmail(env, 'notification', row.id, mail);
    await db.prepare('UPDATE inquiries SET notified = ?, notify_err = ? WHERE id = ?')
      .bind(mail.ok ? 1 : 0, mail.ok ? null : (mail.error || 'Unknown error'), row.id).run().catch(() => {});
  }
  if (!sheet.ok && sheetOn()) console.error('inquiry', row.ref, 'lead sheet:', sheet.note);
  if (!mail.ok) console.error('inquiry', row.ref, 'email:', mail.error);
  if (rm.tried && !rm.ok) console.error('inquiry', row.ref, 'Rent Manager:', rm.note);

  if (stored || sheet.ok || mail.ok) return reply(202, { ok: true, id: row.ref });
  return reply(502, { error: `Sorry, your message did not go through. Please call us on ${CONFIG.office_phone}.` });
};

module.exports.rowFrom = rowFrom;
