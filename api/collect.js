/* =============================================================================
   POST /api/collect/ — one pageview or named event from assets/js/analytics.js.
   Charlotte Square's collector, with the building each event is about.

   Open by design: it is how the site reports itself. What keeps it honest is
   that it stores nothing personal, writes a fixed set of columns, caps
   everything it is handed, and takes at most MAX_PER_WINDOW events from one
   connection in ten minutes (far more than a person browsing sends), so a
   script cannot pad the statistics or fill the database. Past that, and on a
   failed write, it still answers 202: a metric is never worth a broken page.
   ============================================================================= */
'use strict';

const { serve, json, clientIp, country } = require('./_lib/web.js');
const { visitorHash, today } = require('./_lib/auth.js');
const CONFIG = require('./leads-config.json');

const KINDS = new Set(['pageview', 'phone_click', 'email_click', 'apply_click', 'portal_click', 'map_click',
  'gallery_open', 'outbound', 'form_start', 'filter', 'deal_open', 'deal_click', 'share']);
const DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|curl|wget|python-requests/i;
const MAX_PER_WINDOW = 150;
const WINDOW_S = 10 * 60;

/** True when this connection has sent its share for now. One round trip: the
 *  row's count goes up, or starts again when its window has passed. Windows
 *  long gone are cleared now and then. A throttle that cannot be read lets the
 *  event through. */
async function overLimit(db, ip, now) {
  try {
    const row = await db.prepare(
      `INSERT INTO collect_attempts (ip, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(ip) DO UPDATE SET
         count = CASE WHEN collect_attempts.window_start <= ? THEN 1 ELSE collect_attempts.count + 1 END,
         window_start = CASE WHEN collect_attempts.window_start <= ? THEN excluded.window_start ELSE collect_attempts.window_start END
       RETURNING count`,
    ).bind(ip, now, now - WINDOW_S, now - WINDOW_S).first();
    if (Math.random() < 0.01) await db.prepare('DELETE FROM collect_attempts WHERE window_start < ?').bind(now - WINDOW_S).run();
    return Boolean(row && row.count > MAX_PER_WINDOW);
  } catch {
    return false;
  }
}

/** A campaign tag, folded to one spelling ("Facebook " and "facebook" are one row). */
const tag = (v) => {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').slice(0, 60);
  return s || null;
};

/** The referrer as a host only: a full address can carry search terms and tokens. */
function refHost(ref, selfHost) {
  if (!ref || typeof ref !== 'string') return null;
  try {
    const host = new URL(ref).hostname.replace(/^(www|m|l|lm|mobile)\./, '');
    return host === String(selfHost).replace(/^www\./, '') ? null : host.slice(0, 120);
  } catch { return null; }
}

/** The building: the one named by the link, else the one whose page this is. */
function propertyOf(claimed, path) {
  if (typeof claimed === 'string' && CONFIG.properties[claimed]) return claimed;
  const m = /^\/properties\/([a-z0-9-]+)\//.exec(path);
  return m && (CONFIG.properties[m[1]] || CONFIG.external[m[1]]) ? m[1] : null;
}

async function POST({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'No database.' }, 202);
  const ua = request.headers.get('User-Agent') || '';
  if (BOTS.test(ua)) return json({ ok: true }, 202);

  if (await overLimit(env.DB, clientIp(request), Math.floor(Date.now() / 1000))) return json({ ok: true }, 202);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'Bad JSON.' }, 400);

  const kind = KINDS.has(body.kind) ? body.kind : 'pageview';
  // The path is the browser's claim: keep the pathname, drop query and hash,
  // which is where campaign junk and personal details turn up.
  let path = '/';
  try { path = new URL(String(body.path || '/'), 'https://x.invalid').pathname.slice(0, 255); } catch { /* keep '/' */ }

  let meta = null;
  if (body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) {
    const s = JSON.stringify(body.meta);
    if (s.length <= 300) meta = s;
  }
  const utm = kind === 'pageview' && body.utm && typeof body.utm === 'object' ? body.utm : {};
  const now = new Date();
  const day = today(now);
  const visitor = await visitorHash(clientIp(request), ua, env.VISITOR_SALT || 'unset', day);

  try {
    await env.DB.prepare(
      `INSERT INTO events (ts, day, kind, path, property, ref, country, device, meta, visitor, utm_source, utm_medium, utm_campaign)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      Math.floor(now.getTime() / 1000), day, kind, path,
      propertyOf(body.property, path),
      refHost(body.ref, new URL(request.url).hostname),
      country(request),
      DEVICES.has(body.device) ? body.device : null,
      meta, visitor, tag(utm.source), tag(utm.medium), tag(utm.campaign),
    ).run();
  } catch (err) {
    console.error('collect:', err.message);
    return json({ ok: false }, 202);
  }
  return json({ ok: true }, 202);
}

module.exports = serve({ POST });
module.exports.MAX_PER_WINDOW = MAX_PER_WINDOW;
