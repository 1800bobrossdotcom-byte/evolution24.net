/* =============================================================================
   POST /api/inquiry/ — one enquiry from the contact form, on Vercel.

   Built on the Charlotte Square intake, adapted for a site with no database:
   the lead sheet in Google Workspace is the record, and the leasing team's
   email is the alert.

     1. The enquiry goes to the lead sheet (tools/lead-sheet/Code.gs), onto the
        tab for the property it is about, or General when none was picked.
     2. Then an email to everyone in LEAD_TO, saying whether step 1 worked.
        Reply-To is the prospect, so replying in Gmail answers them.

   The visitor is told it worked if either one landed. Only when both fail are
   they asked to call instead, because only then is nothing written down.

   Environment variables (Vercel → Settings → Environment Variables):
     LEAD_TO            the leasing inboxes, separated by commas; each gets every enquiry
     LEAD_FROM          the From: line, on a domain verified in Resend
     RESEND_API_KEY     Resend's API key
     LEADS_SHEET_URL    the lead sheet's web-app address (…/exec)
     LEADS_SHEET_TOKEN  the token the sheet's setup printed
     LEADS_SHEET_LINK   optional: the sheet's own address, linked from each email
     RESEND_API_URL     only ever set by the local tests, to point at a stub

   The allowed choices and the property list come from leads-config.json,
   which scripts/build.py writes from the same data as the contact form and
   the lead sheet, so the three cannot drift apart. Charlotte Square is not
   in it: it has its own site, form and lead sheet.
   ============================================================================= */
'use strict';

const crypto = require('crypto');
const CONFIG = require('./leads-config.json');

/* Submissions per address per window. High enough that a couple sent in
   earnest, or a shared office connection, never trips it; low enough to be
   useless to a script. Kept in memory, so it is per server instance: a speed
   bump, not a wall. The honeypot and the same-origin check do the rest. */
const MAX_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map();

const LIMITS = { first_name: 80, last_name: 80, email: 160, phone: 40, message: 2000, attribution: 120 };
const SHEET_TIMEOUT_MS = 15000;
const EMAIL_TIMEOUT_MS = 10000;

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
/* Deliberately permissive: this catches a typo, it does not adjudicate RFC 5322.
   A real address that a clever pattern rejects is a lost lead. */
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const pick = (list, v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(list, v) ? v : '');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const leadTo = () => String(process.env.LEAD_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
const sheetOn = () => Boolean(process.env.LEADS_SHEET_URL && process.env.LEADS_SHEET_TOKEN);
const emailOn = () => Boolean(process.env.RESEND_API_KEY && leadTo().length);

/* What was pasted into the two sheet variables, forgivingly: the token is 64
   hex characters, so a whole log line, quotes or a trailing space still work;
   likewise any text around the web-app address. */
function sheetToken() {
  const s = String(process.env.LEADS_SHEET_TOKEN || '');
  const m = /[0-9a-f]{64}/i.exec(s);
  return m ? m[0] : s.trim();
}
function sheetUrl() {
  const s = String(process.env.LEADS_SHEET_URL || '');
  const m = /https:\/\/[^\s"'<>]+/.exec(s);
  return m ? m[0] : s.trim();
}

/** A reference the team can quote: the date, then four characters that are
 *  hard to misread. Also what keeps a retried post from becoming two rows. */
function makeId(now) {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let tail = '';
  const bytes = crypto.randomBytes(4);
  for (const b of bytes) tail += alphabet[b % alphabet.length];
  const ymd = now.toISOString().slice(2, 10).replace(/-/g, '');
  return `E24-${ymd}-${tail}`;
}

/** Which site or campaign brought them, in words, from what the page noted
 *  on arrival: a campaign tag if there was one, otherwise the site they came
 *  from, and the first page they saw if it was not this one. */
function cameVia(f) {
  const a = (k) => clean(f[k], LIMITS.attribution);
  const parts = [];
  if (a('utm_source')) {
    parts.push([a('utm_source'), a('utm_medium')].filter(Boolean).join(' / '));
    if (a('utm_campaign')) parts.push(a('utm_campaign'));
  } else if (a('ref')) {
    parts.push(a('ref').replace(/^www\./, ''));
  }
  const landing = a('landing');
  if (landing && landing !== '/contact-us/' && /^\/[\w\-./]*$/.test(landing)) parts.push(landing === '/' ? 'landed on the home page' : `landed on ${landing}`);
  return parts.join(' · ');
}

function throttled(ip, now) {
  const hit = attempts.get(ip);
  if (!hit || now - hit.start >= WINDOW_MS) {
    attempts.set(ip, { start: now, count: 1 });
    if (attempts.size > 5000) { // forget the oldest half rather than grow without end
      const keys = [...attempts.keys()].slice(0, 2500);
      keys.forEach((k) => attempts.delete(k));
    }
    return false;
  }
  hit.count += 1;
  return hit.count > MAX_PER_WINDOW;
}

async function readBody(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  let raw = req.body;
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return { type, data: raw };
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
  if (type === 'application/json') return { type, data: JSON.parse(raw || '{}') };
  return { type, data: Object.fromEntries(new URLSearchParams(raw || '')) };
}

/** Post the enquiry to the lead sheet. {ok, tab} or {ok:false, note}. */
async function toSheet(lead) {
  if (!sheetOn()) return { ok: false, note: 'The lead sheet is not connected (LEADS_SHEET_URL and LEADS_SHEET_TOKEN).' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SHEET_TIMEOUT_MS);
  try {
    // Apps Script answers a POST with a redirect to the result; fetch follows it.
    const res = await fetch(sheetUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sheetToken(), lead }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    let answer = null;
    try { answer = JSON.parse(text); } catch { /* an HTML page: see below */ }
    if (answer && answer.ok) return { ok: true, tab: answer.tab || lead.property || CONFIG.general_tab };
    if (answer && answer.error === 'Wrong token.') {
      return { ok: false, note: 'The sheet said: Wrong token. Copy it again from the sheet’s Evolution24 menu → Show the connection token, into LEADS_SHEET_TOKEN.' };
    }
    if (answer && answer.error) return { ok: false, note: `The sheet said: ${String(answer.error).slice(0, 200)}` };
    if (/accounts\.google\.com|ServiceLogin|<html/i.test(`${res.url} ${text.slice(0, 500)}`)) {
      return { ok: false, note: 'Google asked for a sign-in. Deploy the script as a web app with “Who has access: Anyone”.' };
    }
    return { ok: false, note: `The sheet answered ${res.status}.` };
  } catch (err) {
    return { ok: false, note: err && err.name === 'AbortError' ? 'The sheet took too long to answer.' : `Could not reach the sheet: ${String(err).slice(0, 150)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** The leasing team's email. {ok} or {ok:false, error}, the error in the
 *  provider's own words so the logs say why, not just that it failed. */
async function notify(lead, sheet) {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY is not set on this deployment.' };
  const to = leadTo();
  if (!to.length) return { ok: false, error: 'LEAD_TO is not set on this deployment.' };

  const where = lead.property || 'No property picked';
  const rows = [
    ['Name', lead.name],
    ['Email', lead.email, `mailto:${lead.email}`],
    ['Phone', lead.phone || '—', lead.phone ? `tel:${lead.phone.replace(/[^\d+]/g, '')}` : ''],
    ['Property', where],
    ['Interested in', lead.interest || '—'],
    ['Bedrooms', lead.bedrooms || '—'],
    ['Moving in', lead.move_in || '—'],
    ['Heard about us', lead.source || '—'],
  ];
  if (lead.came_via) rows.push(['Came via', lead.came_via]);
  const cell = (v, href) => (href ? `<a href="${esc(href)}" style="color:#8a6232">${esc(v)}</a>` : esc(v));
  const table = rows.map(([k, v, href]) => `<tr><td style="padding:5px 16px 5px 0;color:#5c5d55;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:5px 0"><strong>${cell(v, href)}</strong></td></tr>`).join('');
  const sheetLine = sheet.ok
    ? `Added to the lead sheet, on the <strong>${esc(sheet.tab)}</strong> tab.`
    : `<span style="color:#b42318">Not added to the lead sheet: ${esc(sheet.note)}</span>`;
  const link = process.env.LEADS_SHEET_LINK && /^https:\/\//.test(process.env.LEADS_SHEET_LINK)
    ? ` <a href="${esc(process.env.LEADS_SHEET_LINK.trim())}" style="color:#8a6232">Open the lead sheet</a>` : '';

  const html = `<div style="font:15px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#151613;max-width:600px">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a6232"><strong>Evolution24 Properties · New enquiry</strong></p>
<p style="margin:0 0 4px;font:28px/1.15 Georgia,'Times New Roman',serif">${esc(where)}</p>
<p style="margin:0 0 18px;color:#5c5d55">From ${esc(lead.name)}. Reply to this email to answer them directly.</p>
<table style="border-collapse:collapse;font-size:15px">${table}</table>
${lead.message ? `<p style="margin:18px 0 4px;color:#5c5d55">Message</p><div style="margin:0;padding:12px 14px;background:#f4f1ea;border-radius:4px;white-space:pre-wrap">${esc(lead.message)}</div>` : ''}
<p style="margin:20px 0 0;font-size:13px;color:#5c5d55">${sheetLine}${link}</p>
<p style="margin:6px 0 0;font-size:12px;color:#8c8a80">Enquiry ${esc(lead.id)} · sent from the contact form on ${esc(lead.site)}</p>
</div>`;
  const text = [
    `New enquiry: ${where}`, `From ${lead.name}. Reply to this email to answer them directly.`, '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(lead.message ? ['', 'Message:', lead.message] : []),
    '', sheet.ok ? `Added to the lead sheet, on the ${sheet.tab} tab.` : `Not added to the lead sheet: ${sheet.note}`,
    `Enquiry ${lead.id}`,
  ].join('\n');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: (process.env.LEAD_FROM || '').trim() || 'Evolution24 Properties <onboarding@resend.dev>',
        to,
        reply_to: lead.email,
        subject: `New enquiry · ${where} · ${lead.name}`,
        html,
        text,
      }),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true };
    let detail = '';
    try { const body = await res.json(); detail = (body && (body.message || body.error || body.name)) || ''; } catch { /* the status will do */ }
    return { ok: false, error: `${res.status}: ${String(detail || res.statusText).slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'The email provider took too long to answer.' : `Could not reach the email provider: ${String(err).slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  const wantsJson = /application\/json/i.test(`${req.headers['content-type'] || ''} ${req.headers.accept || ''}`);
  const reply = (status, body) => {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'no-store');
    if (wantsJson) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    } else {
      // The form without JavaScript: back to the contact page, where the
      // fragment shows the matching notice with CSS alone.
      res.setHeader('Location', `/contact-us/#${body.ok ? 'sent' : 'not-sent'}`);
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
    form = (await readBody(req)).data || {};
  } catch {
    return reply(400, { error: 'Please send the form again.' });
  }

  // The honeypot: a field people never see. Anything that fills it in is not a person.
  if (clean(form.website, 200)) return reply(202, { ok: true });

  const now = new Date();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (throttled(ip, now.getTime())) {
    return reply(429, { error: `Too many messages from this connection. Please call us on ${CONFIG.office_phone}.` });
  }

  const first = clean(form.first_name, LIMITS.first_name);
  const last = clean(form.last_name, LIMITS.last_name);
  const email = clean(form.email, LIMITS.email);
  if (!first || !last || !looksLikeEmail(email)) return reply(400, { error: 'Please check your name and email address.' });

  const slug = pick(CONFIG.properties, form.property);
  const lead = {
    id: makeId(now),
    received: now.toISOString(),
    property: slug ? CONFIG.properties[slug].name : '',
    name: `${first} ${last}`,
    email,
    phone: clean(form.phone, LIMITS.phone),
    interest: CONFIG.interest[pick(CONFIG.interest, form.interest)] || '',
    bedrooms: CONFIG.bedrooms[pick(CONFIG.bedrooms, form.bedrooms)] || '',
    move_in: CONFIG.move_in[pick(CONFIG.move_in, form.move_in)] || '',
    source: CONFIG.source[pick(CONFIG.source, form.source)] || '',
    came_via: cameVia(form),
    message: cleanMessage(form.message, LIMITS.message),
    site: String(req.headers.host || '').slice(0, 100),
  };

  if (!sheetOn() && !emailOn()) {
    console.error('inquiry: neither the lead sheet nor email is configured; nothing was recorded for', lead.id);
    return reply(503, { error: `Our form is not connected yet. Please call us on ${CONFIG.office_phone}.` });
  }

  // Sheet first, so the email can say whether it got there.
  const sheet = await toSheet(lead);
  const mail = await notify(lead, sheet);
  if (!sheet.ok) console.error('inquiry', lead.id, 'lead sheet:', sheet.note);
  if (!mail.ok) console.error('inquiry', lead.id, 'email:', mail.error);

  if (sheet.ok || mail.ok) return reply(202, { ok: true, id: lead.id });
  return reply(502, { error: `Sorry, your message did not go through. Please call us on ${CONFIG.office_phone}.` });
};
