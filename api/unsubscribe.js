/* =============================================================================
   /unsubscribe/<token>/ — the link at the foot of every confirmation email
   (vercel.json rewrites it here as /api/unsubscribe/?token=…). Charlotte
   Square's.

   GET shows a page with one button; it never unsubscribes on its own, because
   mail scanners open every link in an email to check it, and a scanner must
   not be able to unsubscribe anyone. POST does it: from that button, or from a
   mail app's one-click unsubscribe (RFC 8058). The token is random and belongs
   to one address in email_prefs; the address is never in the link.
   ============================================================================= */
'use strict';

const { serve, html } = require('./_lib/web.js');
const { CONFIG, esc } = require('./_lib/leads.js');

const PHONE = CONFIG.office_phone;
const PHONE_TEL = `+1${PHONE.replace(/[^\d]/g, '')}`;
const HEADERS = { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };

/** "p•••@gmail.com": enough to recognise, not enough to harvest. */
const masked = (email) => {
  const [user, domain] = String(email).split('@');
  return domain ? `${user.slice(0, 1)}•••@${domain}` : 'your address';
};

function page(status, title, body) {
  return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Evolution24 Properties</title>
<link rel="stylesheet" href="/assets/css/report.css">
</head>
<body class="plain">
<main class="unsub">
  <a class="unsub__brand" href="/"><img src="/assets/img/mark.svg" width="40" height="30" alt=""><span>Evolution24 <small>Properties</small></span></a>
  ${body}
</main>
</body>
</html>`, status, HEADERS);
}

const unknown = () => page(404, 'Link not recognised', `
  <h1>This link doesn’t work.</h1>
  <p>It may have been copied incompletely. To stop emails from us anyway, call <a href="tel:${PHONE_TEL}">${esc(PHONE)}</a> and we’ll take care of it.</p>`);
const done = (email) => page(200, 'Unsubscribed', `
  <h1>You’re unsubscribed.</h1>
  <p>We won’t send any more emails to ${esc(masked(email))} from this website.</p>
  <p>If you still want to hear about a home, call <a href="tel:${PHONE_TEL}">${esc(PHONE)}</a>.</p>
  <p class="unsub__back"><a href="/">Back to evolution24.net</a></p>`);

async function lookup(env, token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || !env.DB) return null;
  try { return await env.DB.prepare('SELECT email, unsubscribed_at FROM email_prefs WHERE token = ?').bind(token).first(); } catch { return null; }
}
const tokenOf = (request) => new URL(request.url).searchParams.get('token') || '';

async function GET({ request, env }) {
  const token = tokenOf(request);
  const row = await lookup(env, token);
  if (!row) return unknown();
  if (row.unsubscribed_at) return done(row.email);
  return page(200, 'Unsubscribe', `
  <h1>Stop emails from Evolution24?</h1>
  <p>We’ll stop sending emails to ${esc(masked(row.email))} from this website.</p>
  <form method="post" action="/unsubscribe/${esc(token)}/"><button type="submit">Unsubscribe</button></form>
  <p class="unsub__small">Changed your mind? Just close this page.</p>`);
}

async function POST({ request, env }) {
  const token = tokenOf(request);
  const row = await lookup(env, token);
  if (!row) return unknown();
  if (!row.unsubscribed_at) {
    try {
      await env.DB.prepare('UPDATE email_prefs SET unsubscribed_at = ? WHERE token = ? AND unsubscribed_at IS NULL')
        .bind(Math.floor(Date.now() / 1000), token).run();
    } catch {
      return page(503, 'Try again', `
  <h1>That didn’t go through.</h1>
  <p>Please try again in a minute, or call <a href="tel:${PHONE_TEL}">${esc(PHONE)}</a> and we’ll take care of it.</p>`);
    }
  }
  return done(row.email);
}

module.exports = serve({ GET, POST });
