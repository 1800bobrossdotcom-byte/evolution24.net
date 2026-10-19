/* =============================================================================
   Sign-in for the dashboard, and the visitor hash for the statistics.
   Charlotte Square's _lib/auth.js; WebCrypto only, no dependencies.

   Environment variables (Vercel → Settings → Environment Variables), all three
   made by `node scripts/hash-password.mjs` and kept nowhere else:
     ADMIN_PASSWORD_HASH   pbkdf2$<iterations>$<salt b64>$<hash b64>
     SESSION_SECRET        signs the session cookie
     VISITOR_SALT          makes the daily visitor hash unguessable
   ============================================================================= */
'use strict';

const { json } = require('./web.js');

const enc = new TextEncoder();
const COOKIE = 'e24_admin';
const SESSION_HOURS = 12;

const b64urlFromBytes = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bytesFromB64 = (s) => new Uint8Array(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

/* Constant time, so a wrong password cannot be found one byte at a time. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* Stored as pbkdf2$<iterations>$<salt>$<hash>: the count travels with the hash,
   so it can be raised later without invalidating what exists. */
async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, iterStr, saltB64, hashB64] = stored.trim().split('$');
  if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;
  const iterations = Number.parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  const expected = bytesFromB64(hashB64);
  if (!expected.length) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytesFromB64(saltB64), iterations, hash: 'SHA-256' }, key, expected.length * 8);
  return timingSafeEqual(new Uint8Array(bits), expected);
}

/* The cookie is "<expiry>.<hmac>": nothing kept on the server, the signature
   makes it unforgeable, and the expiry is signed so it cannot be extended. */
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

async function issueSession(secret) {
  const payload = String(Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600);
  return `${payload}.${b64urlFromBytes(await hmac(payload, secret))}`;
}

async function verifySession(token, secret) {
  if (!token || !secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const exp = Number.parseInt(payload, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  let given;
  try { given = bytesFromB64(token.slice(dot + 1)); } catch { return false; }
  return timingSafeEqual(given, await hmac(payload, secret));
}

function readCookie(request, name) {
  for (const part of String(request.headers.get('Cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) { try { return decodeURIComponent(v.join('=')); } catch { return null; } }
  }
  return null;
}

/* HttpOnly: no script can read it. Strict: it never rides a request that
   started on another site, which is what a CSRF token would defend against. */
const sessionCookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function requireSession(request, env) {
  const ok = await verifySession(readCookie(request, COOKIE), env.SESSION_SECRET || '');
  return ok ? null : json({ error: 'Not signed in.' }, 401);
}

/* Groups one person's hits within one day, then becomes a different value at
   midnight: a counting aid, not an identifier. Not reversible to an address. */
async function visitorHash(ip, ua, salt, day) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${day}|${salt}|${ip}|${ua}`));
  return b64urlFromBytes(new Uint8Array(digest)).slice(0, 22);
}

const today = (d = new Date()) => d.toISOString().slice(0, 10);

module.exports = { COOKIE, verifyPassword, issueSession, verifySession, readCookie, sessionCookie, requireSession, visitorHash, today };
