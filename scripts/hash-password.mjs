#!/usr/bin/env node
/* The dashboard's three secrets, made once and pasted into Vercel.
 *
 *   node scripts/hash-password.mjs                  makes a passphrase for you
 *   node scripts/hash-password.mjs 'your own one'   or hashes yours (16+ characters)
 *
 * Prints ADMIN_PASSWORD_HASH, SESSION_SECRET and VISITOR_SALT. Paste each into
 * Vercel → Settings → Environment Variables (Production), then redeploy. The
 * password itself is never stored anywhere, including here.
 *
 * 600,000 rounds of PBKDF2-SHA-256, OWASP's figure: Vercel's functions have no
 * 10 ms limit like Charlotte Square's Cloudflare plan, so sign-in can afford
 * it (about half a second). The count travels inside the hash, so a later
 * change leaves this one working.
 */
const ITERATIONS = 600000;
const MIN_OWN = 16;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no 0/o, 1/l/i: it gets read off one screen and typed on another

function makePassphrase(groups = 4, size = 4) {
  const out = [];
  while (out.length < groups * size) {
    const [b] = crypto.getRandomValues(new Uint8Array(1));
    if (b < 256 - (256 % ALPHABET.length)) out.push(ALPHABET[b % ALPHABET.length]);   // every character equally likely
  }
  return out.join('').match(new RegExp(`.{${size}}`, 'g')).join('-');
}

const given = process.argv[2];
if (given && given.length < MIN_OWN) {
  console.error(`Refusing: ${given.length} characters. Use at least ${MIN_OWN}, or run with no argument and one will be made for you.`);
  process.exit(1);
}
const password = given || makePassphrase();
const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

if (!given) {
  console.log('Your dashboard password (save it in a password manager now; it is not kept anywhere):');
  console.log(`  ${password}\n`);
}
console.log('ADMIN_PASSWORD_HASH:');
console.log(`  pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`);
console.log('\nSESSION_SECRET:');
console.log(`  ${b64(crypto.getRandomValues(new Uint8Array(32)))}`);
console.log('\nVISITOR_SALT:');
console.log(`  ${b64(crypto.getRandomValues(new Uint8Array(32)))}`);
