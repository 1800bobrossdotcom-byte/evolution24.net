/* =============================================================================
   POST /api/collect/ — one pageview or named event from assets/js/analytics.js.
   Charlotte Square's collector, with the building each event is about.

   Open by design: it is how the site reports itself. What keeps it honest is
   that it stores nothing personal, writes a fixed set of columns, and caps
   everything it is handed. A failed write still answers 202: a metric is never
   worth a broken page.
   ============================================================================= */
'use strict';

const { serve, json, clientIp, country } = require('./_lib/web.js');
const { visitorHash, today } = require('./_lib/auth.js');
const CONFIG = require('./leads-config.json');

const KINDS = new Set(['pageview', 'phone_click', 'email_click', 'apply_click', 'portal_click', 'map_click',
  'gallery_open', 'outbound', 'form_start', 'filter']);
const DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|curl|wget|python-requests/i;

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
