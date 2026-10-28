/* =============================================================================
   /api/inquiries/ — the leads themselves, for the dashboard. Charlotte
   Square's, with the building each one is about.

   GET  ?limit=50&all=1&property=<slug>   newest first; without all, only the
                                          ones not yet marked handled
   POST {id, handled}                     tick one off, or put it back
   POST {id, notify: true}                send the team's email now (never twice)
   POST {id, confirm: true}               send the visitor's confirmation now
   POST {id, sheet: true}                 add it to the lead sheet now
   POST {id, rentmanager: true}           add it to Rent Manager now

   Session-gated. No CSRF token: the session cookie is SameSite=Strict, so it
   never rides a request that started on another site. Everything here is the
   visitor's own words, and the dashboard renders it with textContent.
   ============================================================================= */
'use strict';

const { serve, json } = require('./_lib/web.js');
const { requireSession } = require('./_lib/auth.js');
const { aiEnabled } = require('./_lib/ai.js');
const { CONFIG, sheetOn, leadFor, notify, logEmail, sheetAndRecord } = require('./_lib/leads.js');
const { confirmAndRecord } = require('./_lib/confirm.js');
const { rmOn, prospectAndRecord } = require('./_lib/rentmanager.js');
const { labels } = require('./_lib/stats.js');

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

async function GET({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database is connected (DATABASE_URL).' }, 503);

  const url = new URL(request.url);
  const asked = Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(Number.isFinite(asked) ? asked : DEFAULT_LIMIT, 1), MAX_LIMIT);
  const all = url.searchParams.get('all') === '1';
  const slug = url.searchParams.get('property') || '';
  const property = CONFIG.properties[slug] ? slug : '';

  const where = [all ? '' : 'handled = 0', property ? 'property = ?' : ''].filter(Boolean);
  const binds = property ? [property, limit] : [limit];
  try {
    const rows = await env.DB.prepare(
      `SELECT id, ref, ts, property, COALESCE(property_name, 'General') AS property_name, first_name, last_name, email, phone,
              interest, bedrooms, unit, move_in, source, message, country, notified, handled, form, page,
              utm_source, utm_medium, utm_campaign, referrer, landing, rm_ok, rm_id, rm_note, ai, ai_err,
              (SELECT unsubscribed_at FROM email_prefs p WHERE p.email = lower(inquiries.email)) AS unsubscribed_at,
              (SELECT sent FROM emails m WHERE m.inquiry_id = inquiries.id AND m.kind = 'confirmation' ORDER BY m.id DESC LIMIT 1) AS confirm_ok,
              (SELECT COALESCE(note, reason) FROM emails m WHERE m.inquiry_id = inquiries.id AND m.kind = 'confirmation' ORDER BY m.id DESC LIMIT 1) AS confirm_note,
              (SELECT CASE WHEN complained_at IS NOT NULL THEN 'marked as spam' WHEN bounced_at IS NOT NULL THEN 'bounced'
                           WHEN delivered_at IS NOT NULL THEN 'delivered' END
                 FROM emails m WHERE m.inquiry_id = inquiries.id AND m.kind = 'confirmation' ORDER BY m.id DESC LIMIT 1) AS confirm_status,
              (SELECT ok FROM lead_sync s WHERE s.inquiry_id = inquiries.id) AS sheet_ok,
              (SELECT note FROM lead_sync s WHERE s.inquiry_id = inquiries.id) AS sheet_note
         FROM inquiries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ts DESC, id DESC LIMIT ?`,
    ).bind(...binds).all();
    const c = (await env.DB.prepare(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE handled = 0) AS open, COUNT(*) FILTER (WHERE notified = 0 AND handled = 0) AS unnotified,
              (SELECT notify_err FROM inquiries WHERE notified = 0 AND handled = 0 AND notify_err IS NOT NULL
                ORDER BY ts DESC LIMIT 1) AS last_error
         FROM inquiries`,
    ).first()) || {};
    return json({
      inquiries: rows.results.map((r) => {
        const out = { ...r, rm_ok: r.rm_ok === null ? null : r.rm_ok, property: r.property || '' };
        if (typeof r.ai === 'string') { try { out.ai = JSON.parse(r.ai); } catch { out.ai = null; } }
        return out;
      }),
      total: c.total || 0,
      open: c.open || 0,
      // Open leads whose notification never left: the dashboard's banner, and the
      // only place a misconfigured email shows, since the visitor's side looks the same.
      unnotified: c.unnotified || 0,
      lastError: c.last_error || null,
      ai: aiEnabled(env),
      sheet: sheetOn(env),
      rm: rmOn(env),
      labels: labels(),
      properties: Object.fromEntries(Object.entries(CONFIG.properties).map(([s, p]) => [s, p.name])),
    });
  } catch (err) {
    console.error('inquiries:', err.message);
    return json({ error: 'Could not read the enquiries.' }, 500);
  }
}

async function POST({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database is connected (DATABASE_URL).' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }
  const id = Number.parseInt(body && body.id, 10);
  if (!Number.isInteger(id) || id < 1) return json({ error: 'Which enquiry?' }, 400);
  const origin = CONFIG.site;   // links in emails point at the live site

  const load = async () => {
    const row = await env.DB.prepare('SELECT * FROM inquiries WHERE id = ?').bind(id).first();
    return row ? { ...row, site: new URL(request.url).host } : null;
  };

  if (body.notify || body.confirm || body.sheet || body.rentmanager) {
    let row;
    try { row = await load(); } catch { return json({ error: 'Could not read it.' }, 500); }
    if (!row) return json({ error: 'No such enquiry.' }, 404);

    if (body.notify) {
      if (row.notified) return json({ ok: true, id, already: true });
      const sent = await notify(env, leadFor(row), { origin });
      await logEmail(env, 'notification', id, sent);
      await env.DB.prepare('UPDATE inquiries SET notified = ?, notify_err = ? WHERE id = ?')
        .bind(sent.ok ? 1 : 0, sent.ok ? null : (sent.error || 'Unknown error'), id).run().catch(() => {});
      return sent.ok ? json({ ok: true, id }) : json({ ok: false, id, error: sent.error || 'Unknown error' }, 502);
    }
    if (body.confirm) {
      const sent = await confirmAndRecord(env, row, origin, { force: true });
      return sent.ok ? json({ ok: true, id }) : json({ ok: false, id, error: sent.note || 'Not sent.' }, 502);
    }
    if (body.sheet) {
      if (!sheetOn(env)) return json({ error: 'The lead sheet is not connected.' }, 503);
      const sent = await sheetAndRecord(env, row);
      return sent.ok ? json({ ok: true, id }) : json({ ok: false, id, error: sent.note }, 502);
    }
    if (!rmOn(env)) return json({ error: 'Sending leads to Rent Manager is not switched on (RM_PROSPECTS).' }, 503);
    const sent = await prospectAndRecord(env, row);
    return sent.ok ? json({ ok: true, id, rm_id: sent.id || null }) : json({ ok: false, id, error: sent.note }, sent.tried ? 502 : 400);
  }

  const handled = body.handled ? 1 : 0;
  try {
    const res = await env.DB.prepare('UPDATE inquiries SET handled = ? WHERE id = ?').bind(handled, id).run();
    if (!res.meta || res.meta.changes === 0) return json({ error: 'No such enquiry.' }, 404);
  } catch {
    return json({ error: 'Could not update it.' }, 500);
  }
  return json({ ok: true, id, handled });
}

module.exports = serve({ GET, POST });
