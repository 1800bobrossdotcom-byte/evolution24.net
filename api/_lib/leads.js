/* =============================================================================
   An enquiry's journey after the form: the lead sheet, the leasing team's
   email, and the log the dashboard reads. Shared by /api/inquiry/ (a new
   enquiry) and /api/inquiries/ (the dashboard's "send again" buttons).

   Environment variables (Vercel → Settings → Environment Variables):
     LEAD_TO            the leasing inboxes, separated by commas
     LEAD_FROM          the From: line, on a domain verified in Resend
     REPLY_TO           optional: where replies to a prospect's confirmation go
                        (the first LEAD_TO address if not set)
     RESEND_API_KEY     Resend's API key
     LEADS_SHEET_URL    the lead sheet's web-app address (…/exec)
     LEADS_SHEET_TOKEN  the token the sheet's setup printed
     LEADS_SHEET_LINK   optional: the sheet's own address, linked from each email
     RESEND_API_URL     only ever set by the local tests, to point at a stub
   ============================================================================= */
'use strict';

const CONFIG = require('../leads-config.json');

const SHEET_TIMEOUT_MS = 15000;
const EMAIL_TIMEOUT_MS = 10000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const leadTo = (env = process.env) => String(env.LEAD_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
const replyTo = (env = process.env) => String(env.REPLY_TO || '').trim() || leadTo(env)[0] || null;
const sheetOn = (env = process.env) => Boolean(env.LEADS_SHEET_URL && env.LEADS_SHEET_TOKEN);
const emailOn = (env = process.env) => Boolean(env.RESEND_API_KEY && leadTo(env).length);

/* What was pasted into the two sheet variables, forgivingly: the token is 64
   hex characters, so a whole log line, quotes or a trailing space still work. */
function sheetToken(env = process.env) {
  const s = String(env.LEADS_SHEET_TOKEN || '');
  const m = /[0-9a-f]{64}/i.exec(s);
  return m ? m[0] : s.trim();
}
function sheetUrl(env = process.env) {
  const s = String(env.LEADS_SHEET_URL || '');
  const m = /https?:\/\/[^\s"'<>]+/.exec(s);
  return m ? m[0] : s.trim();
}

/* ---- Words for codes -------------------------------------------------------- */
/** A move-in: a month the form offered ("2026-11"), "asap" or "later"; or one
 *  of the older contact form's choices. Anything else is dropped. */
function moveInValue(v) {
  if (typeof v !== 'string') return '';
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  return Object.prototype.hasOwnProperty.call(CONFIG.move_in, v) ? v : '';
}
/** "November 2026", or the choice in the forms' words ("As soon as possible"), or ''. */
function moveInLabel(v) {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return CONFIG.move_in[v] || v;
}
const labelOf = (list, v) => (v && CONFIG[list][v]) || '';

/** Which site or campaign brought them, in words: a campaign tag if there was
 *  one, otherwise the site they came from, and the first page they saw. */
function cameVia(row) {
  const parts = [];
  if (row.utm_source) {
    parts.push([row.utm_source, row.utm_medium].filter(Boolean).join(' / '));
    if (row.utm_campaign) parts.push(row.utm_campaign);
  } else if (row.referrer) {
    parts.push(String(row.referrer).replace(/^www\./, ''));
  }
  const landing = row.landing;
  if (landing && landing !== row.page && /^\/[\w\-./]*$/.test(landing)) parts.push(landing === '/' ? 'landed on the home page' : `landed on ${landing}`);
  return parts.join(' · ');
}

/** The enquiry as the lead sheet and the email show it: every code in words. */
function leadFor(row) {
  return {
    id: row.ref,
    received: new Date((row.ts || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    property: row.property_name || '',
    name: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email,
    phone: row.phone || '',
    interest: labelOf('interest', row.interest),
    bedrooms: labelOf('bedrooms', row.bedrooms),
    move_in: moveInLabel(row.move_in),
    source: labelOf('source', row.source),
    came_via: cameVia(row),
    message: row.message || '',
    unit: row.unit || '',
    form: row.form === 'property' ? 'Building page' : 'Contact page',
    site: row.site || '',
  };
}

/* ---- The lead sheet --------------------------------------------------------- */
/** Post the enquiry to the lead sheet. {ok, tab} or {ok:false, note}. */
async function toSheet(lead, env = process.env) {
  if (!sheetOn(env)) return { ok: false, note: 'The lead sheet is not connected (LEADS_SHEET_URL and LEADS_SHEET_TOKEN).' };
  try {
    // Apps Script answers a POST with a redirect to the result; fetch follows it.
    const res = await fetch(sheetUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sheetToken(env), lead }),
      redirect: 'follow',
      signal: AbortSignal.timeout(SHEET_TIMEOUT_MS),
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
    return { ok: false, note: err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'The sheet took too long to answer.' : `Could not reach the sheet: ${String(err).slice(0, 150)}` };
  }
}

/* ---- Email ------------------------------------------------------------------ */
/** One email through Resend. {ok, id} or {ok:false, error}, in Resend's words. */
async function sendEmail(env, { to, subject, html, text, reply }) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY is not set on this deployment.' };
  try {
    const res = await fetch(env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: String(env.LEAD_FROM || '').trim() || 'Evolution24 Properties <onboarding@resend.dev>',
        to, subject, html, ...(text ? { text } : {}), ...(reply ? { reply_to: reply } : {}),
      }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
    if (res.ok) {
      let id = null;
      try { id = (await res.json()).id || null; } catch { /* sent; no id to match reports to */ }
      return { ok: true, id };
    }
    let detail = '';
    try { const body = await res.json(); detail = (body && (body.message || body.error || body.name)) || ''; } catch { /* the status will do */ }
    return { ok: false, error: `${res.status}: ${String(detail || res.statusText).slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'The email provider took too long to answer.' : `Could not reach the email provider: ${String(err).slice(0, 200)}` };
  }
}

/** One row in the emails log, for the dashboard and the reports. Never throws. */
async function logEmail(env, kind, inquiryId, result) {
  if (!env.DB || !inquiryId) return;
  const now = new Date();
  try {
    await env.DB.prepare(
      `INSERT INTO emails (ts, day, kind, inquiry_id, sent, reason, note, resend_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(Math.floor(now.getTime() / 1000), now.toISOString().slice(0, 10), kind, inquiryId, result.ok ? 1 : 0,
      result.ok ? null : (result.reason || 'error'),
      result.ok ? null : String(result.note || result.error || '').slice(0, 300) || null,
      result.ok ? (result.id || null) : null).run();
  } catch { /* bookkeeping only */ }
}

/** The leasing team's email: the building as the headline, every answer in
 *  words, and whether the lead reached the sheet and Rent Manager. */
async function notify(env, lead, { sheet, rm, origin } = {}) {
  const to = leadTo(env);
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY is not set on this deployment.' };
  if (!to.length) return { ok: false, error: 'LEAD_TO is not set on this deployment.' };

  const where = lead.property || 'No property picked';
  const rows = [
    ['Name', lead.name],
    ['Email', lead.email, `mailto:${lead.email}`],
    ['Phone', lead.phone || '—', lead.phone ? `tel:${lead.phone.replace(/[^\d+]/g, '')}` : ''],
    ['Property', where],
  ];
  if (lead.unit) rows.push(['Home', lead.unit]);
  rows.push(['Interested in', lead.interest || '—'], ['Bedrooms', lead.bedrooms || '—'],
    ['Moving in', lead.move_in || '—'], ['Heard about us', lead.source || '—']);
  if (lead.came_via) rows.push(['Came via', lead.came_via]);
  const cell = (v, href) => (href ? `<a href="${esc(href)}" style="color:#8a6232">${esc(v)}</a>` : esc(v));
  const table = rows.map(([k, v, href]) => `<tr><td style="padding:5px 16px 5px 0;color:#5c5d55;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:5px 0"><strong>${cell(v, href)}</strong></td></tr>`).join('');
  const status = [];
  if (sheet) {
    status.push(sheet.ok ? `Added to the lead sheet, on the <strong>${esc(sheet.tab)}</strong> tab.`
      : `<span style="color:#b42318">Not added to the lead sheet: ${esc(sheet.note)}</span>`);
  }
  if (rm && rm.tried) {
    status.push(rm.ok ? `Added to Rent Manager as a prospect${rm.id ? ` (#${esc(rm.id)})` : ''}.`
      : `<span style="color:#b42318">Not added to Rent Manager: ${esc(rm.note)}</span>`);
  }
  const link = env.LEADS_SHEET_LINK && /^https:\/\//.test(String(env.LEADS_SHEET_LINK).trim())
    ? ` <a href="${esc(String(env.LEADS_SHEET_LINK).trim())}" style="color:#8a6232">Open the lead sheet</a>` : '';
  const dash = origin && env.DB ? ` · <a href="${esc(origin)}/admin/" style="color:#8a6232">Dashboard</a>` : '';
  const from = lead.form === 'Building page' ? `the ${lead.property || 'building'} page` : 'the contact page';

  const html = `<div style="font:15px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#151613;max-width:600px">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a6232"><strong>Evolution24 Properties · New enquiry</strong></p>
<p style="margin:0 0 4px;font:28px/1.15 Georgia,'Times New Roman',serif">${esc(where)}</p>
<p style="margin:0 0 18px;color:#5c5d55">From ${esc(lead.name)}. Reply to this email to answer them directly.</p>
<table style="border-collapse:collapse;font-size:15px">${table}</table>
${lead.message ? `<p style="margin:18px 0 4px;color:#5c5d55">Message</p><div style="margin:0;padding:12px 14px;background:#f4f1ea;border-radius:4px;white-space:pre-wrap">${esc(lead.message)}</div>` : ''}
<p style="margin:20px 0 0;font-size:13px;color:#5c5d55">${status.join('<br>')}${link}${dash}</p>
<p style="margin:6px 0 0;font-size:12px;color:#8c8a80">Enquiry ${esc(lead.id)} · sent from ${esc(from)} on ${esc(lead.site)}</p>
</div>`;
  const text = [
    `New enquiry: ${where}`, `From ${lead.name}. Reply to this email to answer them directly.`, '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(lead.message ? ['', 'Message:', lead.message] : []),
    '', ...status.map((s) => s.replace(/<[^>]+>/g, '')),
    `Enquiry ${lead.id}, sent from ${from}`,
  ].join('\n');

  return sendEmail(env, { to, reply: lead.email, subject: `New enquiry · ${where} · ${lead.name}`, html, text });
}

/** The sheet, and a note of how it went for the dashboard. */
async function sheetAndRecord(env, row) {
  const result = await toSheet(leadFor(row), env);
  if (env.DB && row.id) {
    await env.DB.prepare(
      `INSERT INTO lead_sync (inquiry_id, ok, note, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT(inquiry_id) DO UPDATE SET ok = excluded.ok, note = excluded.note, ts = excluded.ts`,
    ).bind(row.id, result.ok ? 1 : 0, result.ok ? `On the ${result.tab} tab` : result.note, Math.floor(Date.now() / 1000)).run().catch(() => {});
  }
  return result;
}

module.exports = {
  CONFIG, esc, leadTo, replyTo, sheetOn, emailOn, moveInValue, moveInLabel, labelOf, cameVia, leadFor,
  toSheet, sendEmail, logEmail, notify, sheetAndRecord,
};
