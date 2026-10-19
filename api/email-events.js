/* =============================================================================
   POST /api/email-events/ — Resend's delivery reports, by webhook. Charlotte
   Square's.

   Resend posts one event per change (delivered, delayed, bounced, marked as
   spam, and opened or clicked if tracking is on), naming the email by the id
   it gave when it was sent, which the emails log kept; the event stamps that
   row. A spam complaint also unsubscribes the address.

   Resend signs every event (the Svix scheme): HMAC-SHA256 of
   "<svix-id>.<svix-timestamp>.<body>" with the endpoint's signing secret, in
   RESEND_WEBHOOK_SECRET ("whsec_…"). Anything unsigned, wrongly signed or more
   than five minutes old is refused; without the secret nothing is taken.
   ============================================================================= */
'use strict';

const { serve, json } = require('./_lib/web.js');

const STAMP = {
  'email.delivered': 'delivered_at',
  'email.delivery_delayed': 'delayed_at',
  'email.bounced': 'bounced_at',
  'email.complained': 'complained_at',
  'email.opened': 'opened_at',
  'email.clicked': 'clicked_at',
};
const TOLERANCE = 5 * 60;

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(secret, id, timestamp, body, header, now = Math.floor(Date.now() / 1000)) {
  if (!secret || !id || !timestamp || !header) return false;
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > TOLERANCE) return false;
  const raw = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  if (!raw.length) return false;
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))).toString('base64');
  // "v1,<sig> v1,<sig>": more than one while a secret is being rotated.
  return String(header).split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && same(sig, mac);
  });
}

async function POST({ request, env }) {
  if (!env.RESEND_WEBHOOK_SECRET) return json({ error: 'Not configured.' }, 503);
  const body = await request.text();
  const ok = await verify(env.RESEND_WEBHOOK_SECRET, request.headers.get('svix-id'), request.headers.get('svix-timestamp'),
    body, request.headers.get('svix-signature'));
  if (!ok) return json({ error: 'Bad signature.' }, 401);
  let event;
  try { event = JSON.parse(body); } catch { return json({ error: 'Bad JSON.' }, 400); }
  const column = STAMP[event && event.type];
  const emailId = event && event.data && event.data.email_id;
  if (!column || !emailId || !env.DB) return json({ ok: true, ignored: true });
  const when = Math.floor((Date.parse(event.created_at) || Date.now()) / 1000);
  try {
    await env.DB.prepare(`UPDATE emails SET ${column} = COALESCE(${column}, ?) WHERE resend_id = ?`).bind(when, String(emailId)).run();
    if (event.type === 'email.complained') {
      const to = Array.isArray(event.data.to) ? event.data.to : [event.data.to];
      for (const address of to.filter(Boolean)) {
        await env.DB.prepare('UPDATE email_prefs SET unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE email = ?')
          .bind(when, String(address).trim().toLowerCase()).run();
      }
    }
  } catch {
    return json({ error: 'Could not record it.' }, 500);   // Resend tries again later
  }
  return json({ ok: true });
}

module.exports = serve({ POST });
module.exports.verify = verify;
