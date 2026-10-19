/* =============================================================================
   POST /api/login/ {password} — the dashboard password for a signed session
   cookie. Charlotte Square's, throttled the same way: six wrong tries from one
   address lock it out for fifteen minutes. The password is checked against a
   PBKDF2 hash in ADMIN_PASSWORD_HASH, so the repository holds nothing that
   grants access.
   ============================================================================= */
'use strict';

const { serve, json, clientIp } = require('./_lib/web.js');
const { verifyPassword, issueSession, sessionCookie } = require('./_lib/auth.js');

const MAX_FAILS = 6;
const LOCK_SECONDS = 15 * 60;

async function POST({ request, env }) {
  if (!env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) {
    return json({ error: 'Admin access is not configured on this deployment.' }, 503);
  }
  const ip = clientIp(request);
  const now = Math.floor(Date.now() / 1000);

  // Throttle first, so a locked-out client never reaches the hashing work.
  let row = null;
  if (env.DB) {
    try {
      row = await env.DB.prepare('SELECT fails, until FROM login_attempts WHERE ip = ?').bind(ip).first();
    } catch { row = null; }
    if (row && row.until > now) {
      return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429, { 'Retry-After': String(row.until - now) });
    }
  }

  let password = '';
  try { password = String((await request.json()).password || ''); } catch { /* empty */ }
  const ok = password ? await verifyPassword(password, env.ADMIN_PASSWORD_HASH) : false;

  if (!ok) {
    if (env.DB) {
      const fails = (row ? row.fails : 0) + 1;
      await env.DB.prepare(
        `INSERT INTO login_attempts (ip, fails, until) VALUES (?, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET fails = excluded.fails, until = excluded.until`,
      ).bind(ip, fails, fails >= MAX_FAILS ? now + LOCK_SECONDS : 0).run().catch(() => {});
    }
    return json({ error: 'That password is not right.' }, 401);   // one message for every failure
  }
  if (env.DB) await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run().catch(() => {});
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(await issueSession(env.SESSION_SECRET), 12 * 3600) });
}

module.exports = serve({ POST });
