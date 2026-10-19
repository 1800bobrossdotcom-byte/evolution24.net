/* =============================================================================
   The email a visitor gets after sending a form: a short "we've got it" from
   the leasing team, naming the building, with Privacy and an unsubscribe
   link. Charlotte Square's confirm.js, in Evolution24's colours.

   Written as a letter, not a newsletter (the logo, a serif greeting, a few
   lines and a signature; no hero photo, button or bulk-mail header), so Gmail
   files it with personal mail, not Promotions.

   The form is public, so anything this email carries can be aimed at a
   stranger's inbox by whoever fills it in. So it carries nothing they typed
   but a first name that looks like one, and only choices from the form's own
   lists. At most one per address every 12 hours; never to an address that has
   unsubscribed. Unsubscribing is a row in email_prefs; the link carries a
   random token for the address, never the address.
   ============================================================================= */
'use strict';

const { CONFIG, esc, sendEmail, replyTo, logEmail, labelOf, moveInLabel } = require('./leads.js');

const QUIET = 12 * 3600;
const PHONE = CONFIG.office_phone;
const PHONE_TEL = `+1${PHONE.replace(/[^\d]/g, '')}`;
const STREET = CONFIG.office_address;

/** A first name to greet, or '' when what was typed does not look like one. */
function greetName(first) {
  const s = String(first || '').trim().split(/\s+/)[0] || '';
  return /^\p{L}[\p{L}\p{M}'’-]{0,29}\.?$/u.test(s) ? s : '';
}

const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url');

/** Subject, HTML and text. Pure: it takes its links, so it can be previewed. */
function confirmationEmail(row, links) {
  const name = greetName(row.first_name);
  const building = row.property_name || '';
  const tour = row.interest === 'tour';
  const hello = name ? `Thanks, ${name}.` : 'Thank you.';
  const about = building ? ` about ${building}` : '';
  const got = tour
    ? `We’ve got your tour request${building ? ` for ${building}` : ''}. A member of our leasing team will be in touch soon to set a time that suits you.`
    : `We’ve got your message${about}. A member of our leasing team will reply soon.`;
  const subject = `${tour ? 'We’ve got your tour request' : 'We’ve got your message'} · ${building || 'Evolution24 Properties'}`;
  const preheader = tour ? 'We’ll be in touch soon to set a time.' : 'A member of our leasing team will reply soon.';
  const told = [
    ['Building', building],
    ['Home', row.unit],
    ['Interested in', labelOf('interest', row.interest)],
    ['Moving in', moveInLabel(row.move_in)],
  ].filter(([, v]) => v);
  const see = building && links.building ? [links.building, `See ${building}`] : [links.available, 'See what’s available'];

  const serif = "'Instrument Serif', Georgia, 'Times New Roman', serif";
  const sans = "Manrope, 'Helvetica Neue', Helvetica, Arial, sans-serif";
  const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
  const cell = (css) => `font-family:${sans};${css}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
  body { margin: 0; padding: 0; }
  a { color: #8a6232; }
  @media (max-width: 620px) { .px { padding-left: 22px !important; padding-right: 22px !important; } .h1 { font-size: 30px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:#FFFFFF;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table ${T} width="100%" style="background:#FFFFFF;">
  <tr>
    <td class="px" style="padding:36px 32px 40px;">
      <table ${T} width="560" style="width:100%;max-width:560px;">
        <tr><td style="padding:0 0 30px;"><img src="${esc(links.img)}/logo.png" width="220" height="54" alt="Evolution24 Properties" style="display:block;border:0;width:220px;height:54px;"></td></tr>
        <tr><td style="padding:0 0 22px;"><table ${T}><tr><td width="40" height="3" style="width:40px;height:3px;background:#b88d5a;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
        <tr>
          <td>
            <h1 class="h1" style="margin:0 0 14px;font-family:${serif};font-weight:400;font-size:36px;line-height:1.12;color:#151613;">${esc(hello)}</h1>
            <p style="margin:0 0 14px;${cell('font-size:16px;line-height:1.6;color:#3b3c36;')}">${esc(got)}</p>
            <p style="margin:0 0 18px;${cell('font-size:16px;line-height:1.6;color:#3b3c36;')}">If it can’t wait, call the office at <a href="tel:${PHONE_TEL}" style="color:#8a6232;font-weight:600;text-decoration:underline;white-space:nowrap;">${esc(PHONE)}</a>.</p>${told.length ? `
            <p style="margin:0 0 18px;${cell('font-size:14px;line-height:1.75;color:#5c5d55;')}">${told.map(([k, v]) => `${esc(k)}: <strong style="color:#151613;font-weight:600;">${esc(v)}</strong>`).join('<br>')}</p>` : ''}
            <p style="margin:0 0 28px;${cell('font-size:16px;line-height:1.6;')}"><a href="${esc(see[0])}" style="color:#8a6232;font-weight:600;text-decoration:underline;">${esc(see[1])}</a></p>
            <p style="margin:0;${cell('font-size:16px;line-height:1.5;color:#151613;')}">The Evolution24 Properties leasing team</p>
            <p style="margin:2px 0 0;${cell('font-size:14px;line-height:1.5;color:#5c5d55;')}">${esc(STREET)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:34px 0 0;">
            <table ${T} width="100%" style="border-top:1px solid #e4ded2;">
              <tr>
                <td style="padding-top:16px;${cell('font-size:12px;line-height:1.75;color:#8c8a80;')}">
                  Family-owned apartments in Rochester, Syracuse and Geneva · Equal Housing Opportunity<br>
                  <a href="${esc(links.privacy)}" style="color:#5c5d55;text-decoration:underline;">Privacy</a> &nbsp;·&nbsp; <a href="${esc(links.unsubscribe)}" style="color:#5c5d55;text-decoration:underline;">Unsubscribe</a><br>
                  You’re getting this email because you sent us a message through our website. It isn’t a mailing list, and we never sell your information.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
  const text = [
    hello, '', got, '', `If it can’t wait, call the office at ${PHONE}.`,
    ...(told.length ? ['', ...told.map(([k, v]) => `${k}: ${v}`)] : []),
    '', `${see[1]}: ${see[0]}`, '', 'The Evolution24 Properties leasing team', STREET, '', '--',
    'Family-owned apartments in Rochester, Syracuse and Geneva · Equal Housing Opportunity',
    `Privacy: ${links.privacy}`, `Unsubscribe: ${links.unsubscribe}`, '',
    'You’re getting this email because you sent us a message through our website. It isn’t a mailing list, and we never sell your information.',
  ].join('\n');
  return { subject, html, text };
}

/** The address's row in email_prefs, made the first time the site writes. */
async function prefsFor(env, email, now) {
  await env.DB.prepare('INSERT INTO email_prefs (email, token, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(email, token(), now).run();
  return env.DB.prepare('SELECT token, last_sent_at, unsubscribed_at FROM email_prefs WHERE email = ?').bind(email).first();
}

/** Send the visitor their confirmation. {ok, id} or {ok:false, reason, note}:
 *  reason is unsubscribed, recent, off or error. force is the dashboard's
 *  button: it skips the 12-hour gap, never an unsubscribe. */
async function sendConfirmation(env, row, origin, { force = false } = {}) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: 'off', note: 'Email is not set up yet.' };
  if (!env.DB) return { ok: false, reason: 'off', note: 'No database, so no unsubscribe link: not sent.' };
  const email = String(row.email || '').trim().toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  let prefs;
  try { prefs = await prefsFor(env, email, now); } catch { prefs = null; }
  if (!prefs) return { ok: false, reason: 'error', note: 'Could not check their email preferences: not sent.' };
  if (prefs.unsubscribed_at) return { ok: false, reason: 'unsubscribed', note: 'They have unsubscribed.' };
  if (!force && prefs.last_sent_at && now - prefs.last_sent_at < QUIET) return { ok: false, reason: 'recent', note: 'They already got one in the last 12 hours.' };

  const links = {
    building: row.property ? `${origin}/properties/${row.property}/` : '',
    available: `${origin}/properties/#available`,
    privacy: `${origin}/privacy/`,
    unsubscribe: `${origin}/unsubscribe/${prefs.token}/`,
    img: `${origin}/assets/img/email`,
  };
  const mail = confirmationEmail(row, links);
  const sent = await sendEmail(env, { to: [String(row.email).trim()], subject: mail.subject, html: mail.html, text: mail.text, reply: replyTo(env) });
  if (!sent.ok) return { ok: false, reason: 'error', note: sent.error };
  await env.DB.prepare('UPDATE email_prefs SET last_sent_at = ? WHERE email = ?').bind(now, email).run().catch(() => {});
  return { ok: true, id: sent.id };
}

/** Send it, and log how it went, for the enquiry's card and the reports. */
async function confirmAndRecord(env, row, origin, opts) {
  const result = await sendConfirmation(env, row, origin, opts);
  await logEmail(env, 'confirmation', row.id, result);
  return result;
}

module.exports = { greetName, confirmationEmail, sendConfirmation, confirmAndRecord };
