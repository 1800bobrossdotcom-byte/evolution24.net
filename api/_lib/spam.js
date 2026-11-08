/* =============================================================================
   Keeping form spam out of the leasing inbox. The same file, word for word
   but for the last line, serves Charlotte Square (functions/_lib/spam.js).

   Three things, each cheap, each catching a different kind of sender:

   1. A form token. The page asks /api/form-token/ for one when it loads: the
      time, signed with SESSION_SECRET. A post without a valid one did not come
      from the page (most spam scripts post straight to the address), and one
      sent under three seconds after the page loaded was not typed by a person.
      Neither is accepted; the page's own script, which always has a token,
      quietly gets a new one and sends again, so a person never sees it.
   2. The enquiry's own words, scored (spamCheck): links, SEO and marketing
      pitches, crypto and the rest, text in scripts other than ours, names
      that are random letters, throwaway email domains. HOLD_AT or more and it
      is held: saved, but not emailed to the team, not put in the lead sheet or
      Rent Manager, and no confirmation goes out. The dashboard lists what was
      held, with why, for a month, so a real person caught by mistake can be
      sent on with one press.
   3. The honeypot field and the per-connection limit, in the endpoint itself.

   The scoring is deliberately blunt and errs towards letting a message
   through: a link, a sales word ("I work in digital marketing") or "your
   website" alone never holds an enquiry; it takes two of them, or one of the
   things people never do (link markup, a name of random letters).
   ============================================================================= */

const TOKEN_MIN_S = 3;                 // faster than this is not a person
const TOKEN_MAX_S = 24 * 3600;         // the page fetches a new one after six hours away
const HOLD_AT = 5;
const HOLD_DAYS = 30;                  // held enquiries are deleted after this

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(secret, t) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`form-token|${t}`)));
}

/** "<unix seconds>.<signature>", or '' when no secret is set (then nothing is checked). */
async function issueToken(secret, now = Date.now()) {
  if (!secret) return '';
  const t = Math.floor(now / 1000);
  return `${t}.${await sign(secret, t)}`;
}

/** {ok} or {ok: false, reason: missing | forged | fast | stale}. With no secret
 *  set the form keeps working, unchecked, rather than turning everyone away. */
async function checkToken(token, secret, now = Date.now()) {
  if (!secret) return { ok: true, reason: 'unchecked' };
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!m) return { ok: false, reason: 'missing' };
  const want = await sign(secret, m[1]);
  let diff = want.length ^ m[2].length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  if (diff) return { ok: false, reason: 'forged' };
  const age = Math.floor(now / 1000) - Number(m[1]);
  if (age < TOKEN_MIN_S) return { ok: false, reason: 'fast', age };
  if (age > TOKEN_MAX_S) return { ok: false, reason: 'stale', age };
  return { ok: true, age };
}

/* ---- The words. Each pattern is a whole word or phrase, case-insensitive. ---- */
const STRONG = [
  /\bseo\b/, /search engine optimi[sz]/, /\bback ?links?\b/, /\blink ?building\b/, /\bguest ?posts?\b/,
  /\bsponsored (post|article|content)/, /\bdigital marketing\b/, /\bmarketing (agency|services|campaign|solutions)\b/,
  /\bweb ?(site)? ?(design(er|ers|ing)?|redesign|develop(ment|ers?))\b/, /\b(website|organic|web) traffic\b/,
  /\blead generation\b/, /\bgenerate (more )?leads\b/, /\b(first|1st|top) page (of|on) google\b/,
  /\brank(ing)? (higher|#?1|first|on google)\b/, /\bgoogle (ranking|first page)\b/, /\bcrypto(currency)?\b/, /\bbitcoin\b/,
  /\bforex\b/, /\bbinary options?\b/, /\bcasino\b/, /\bviagra\b/, /\bcialis\b/, /\bporn\b/, /\bescorts?\b/,
  /\b(business|personal) loans?\b/, /\bloan offer\b/, /\bfunding (offer|approval)\b/, /\boutsourc/, /\bvirtual assistants?\b/,
  /\b(app|software|mobile app) development\b/, /\bbookkeeping services\b/, /\bpress release\b/,
  /\b(whatsapp|telegram) (me|us)\b/, /\bsocial media (management|marketing)\b/, /\bai (chat ?bot|agent|automation)s?\b/,
];
const SOFT = [
  /\byour (website|site|business|company|brand|online presence)\b/, /\bdear (sir|madam|owner|business owner|website owner|team)\b/,
  /\bwe('re| are) an? (team|company|agency)\b/, /\bour (agency|services|team of experts)\b/,
  /\bfree (quote|audit|consultation|trial|report)\b/, /\b(special|limited) offer\b/,
  /\bincrease (your )?(sales|revenue|traffic|bookings)\b/, /\bboost (your )?(sales|revenue|traffic|business|ranking)\b/,
  /\breply (with )?"?yes"?\b/, /\bunsubscribe\b/, /\bopt[- ]out\b/, /\bnot spam\b/,
];
const URLS = /(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9][a-z0-9-]{0,62}\.(?:com|net|org|info|biz|io|co|ru|su|cn|top|xyz|site|online|shop|store|click|link|live|pro|app|dev|me|us|uk|in|tk|ua|pl|de|br|ly|gl|gd|to)\b(?:\/[^\s]*)?/gi;
const MARKUP = /<a\s|href\s*=|\[url|\[link/i;
const OTHER_SCRIPTS = /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Armenian}\p{Script=Georgian}]/gu;
const DISPOSABLE = new Set(('mailinator.com guerrillamail.com guerrillamail.info guerrillamailblock.com sharklasers.com grr.la '
  + '10minutemail.com 10minutemail.net temp-mail.org temp-mail.io tempmail.com tempmail.net tempmailo.com tempr.email '
  + 'yopmail.com yopmail.net yopmail.fr trashmail.com trashmail.de getnada.com nada.email dispostable.com maildrop.cc '
  + 'mintemail.com throwawaymail.com fakeinbox.com mohmal.com emailondeck.com discard.email spamgourmet.com '
  + 'mailnesia.com moakt.com tmail.ws 1secmail.com 1secmail.org 1secmail.net burnermail.io mytemp.email emailfake.com '
  + 'inboxkitten.com mail.tm tmpmail.org tmpmail.net mailpoof.com spambox.us dropmail.me').split(' '));

/** A name that is random letters: "uHnrVYbPdKzc", "Kjhsdfkjh". */
function gibberish(word) {
  const s = word.replace(/[^A-Za-z]/g, '');
  if (s.length < 6) return false;
  const inner = (s.slice(1).match(/[A-Z]/g) || []).length;
  const flips = (s.match(/[a-z][A-Z]/g) || []).length;
  return (inner >= 3 && flips >= 2) || /[bcdfghjklmnpqrstvwxz]{6,}/i.test(s);
}

const share = (text, re) => {
  const letters = (text.match(/\p{L}/gu) || []).length;
  return letters ? (text.match(re) || []).length / letters : 0;
};

/** {score, reasons[]} for one enquiry ({first_name, last_name, email, phone, message}). */
function spamCheck(row) {
  const reasons = [];
  let score = 0;
  const add = (n, why) => { score += n; reasons.push(why); };
  const first = String(row.first_name || ''), last = String(row.last_name || '');
  const name = `${first} ${last}`.trim();
  const msg = String(row.message || '');
  const all = `${name}\n${msg}`;
  const lower = all.toLowerCase();

  // Links, not counting email addresses ("write to me at jo@gmail.com").
  const links = new Set((msg.replace(/\S+@\S+/g, ' ').match(URLS) || []).map((u) => u.toLowerCase()));
  if (links.size >= 2) add(4, `${links.size} links`);
  else if (links.size === 1) add(2, 'a link');
  if (MARKUP.test(msg)) add(5, 'link markup');

  const strong = STRONG.filter((re) => re.test(lower)).map((re) => (lower.match(re) || [''])[0]);
  if (strong.length) add(Math.min(6, 3 * strong.length), `sales words: ${strong.slice(0, 3).join(', ')}`);
  const soft = SOFT.filter((re) => re.test(lower)).map((re) => (lower.match(re) || [''])[0]);
  if (soft.length) add(Math.min(3, soft.length), `pitch words: ${soft.slice(0, 3).join(', ')}`);

  if (msg.length >= 20 && share(msg, OTHER_SCRIPTS) > 0.3) add(3, 'message not in English');
  if (/^\S{10,}$/.test(msg.trim()) && !links.size && gibberish(msg.trim())) add(3, 'message is random letters');
  if (share(name, OTHER_SCRIPTS) > 0.5) add(2, 'name not in Latin letters');

  if (/\d|@|https?:|www\./i.test(name)) add(3, 'digits or a link in the name');
  const junk = name.split(/[\s'’-]+/).filter(gibberish);
  if (junk.length) add(Math.min(6, 3 * junk.length), 'name is random letters');
  if (first.length > 1 && first.toLowerCase() === last.toLowerCase()) add(1, 'first and last name the same');
  if (name.split(/\s+/).length > 5) add(3, 'name is a sentence');

  const domain = String(row.email || '').split('@')[1] || '';
  if (DISPOSABLE.has(domain.toLowerCase())) add(2, 'throwaway email address');
  const digits = String(row.phone || '').replace(/\D/g, '');
  if (row.phone && (digits.length < 7 || digits.length > 15)) add(1, 'phone number is not one');

  return { score, reasons, hold: score >= HOLD_AT };
}

module.exports = { issueToken, checkToken, spamCheck, HOLD_AT, HOLD_DAYS, TOKEN_MIN_S };
