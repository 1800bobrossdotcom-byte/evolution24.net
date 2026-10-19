/* =============================================================================
   /api/reports/ — make, list and switch off shared reports. Charlotte Square's.

   GET                      the most recent reports, newest first
   POST   {period, day}     make one for the day, week or month containing day
   DELETE ?token=…          stop sharing one; its link answers 404 from then on

   Session-gated. What they make is public to anyone holding the link, which
   is why a report is built from totals only (api/_lib/report.js).
   ============================================================================= */
'use strict';

const { serve, json } = require('./_lib/web.js');
const { requireSession } = require('./_lib/auth.js');
const { isoDay, addDays } = require('./_lib/stats.js');
const { PERIODS, periodRange, buildReport } = require('./_lib/report.js');

const OLDEST_DAYS = 400;
// 128 random bits: nobody finds a report by guessing its address.
const newToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
const linkFor = (request, token) => `${new URL(request.url).origin}/r/${token}/`;

async function GET({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database is connected (DB_URL and DB_TOKEN).' }, 503);
  try {
    const { results } = await env.DB.prepare('SELECT token, period, from_day, to_day, partial, label, ts FROM reports ORDER BY ts DESC LIMIT 20').all();
    return json({ reports: results.map((r) => ({ ...r, url: linkFor(request, r.token) })) });
  } catch {
    return json({ reports: [] });
  }
}

async function POST({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database is connected (DB_URL and DB_TOKEN).' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }
  const period = PERIODS.includes(body && body.period) ? body.period : null;
  const today = isoDay(new Date());
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
  if (!period || !day || Number.isNaN(Date.parse(day))) return json({ error: 'Which period?' }, 400);
  if (day > today || day < addDays(today, -OLDEST_DAYS)) return json({ error: 'That period is out of range.' }, 400);

  // A finished period does not change: asking twice returns the link already made.
  const range = periodRange(period, day, today);
  if (!range.partial) {
    const had = await env.DB.prepare(
      'SELECT token, label FROM reports WHERE period = ? AND from_day = ? AND to_day = ? AND partial = 0 ORDER BY ts DESC LIMIT 1',
    ).bind(period, range.from, range.to).first().catch(() => null);
    if (had) return json({ token: had.token, url: linkFor(request, had.token), label: had.label, existing: true });
  }
  const report = await buildReport(env, period, day);
  const token = newToken();
  try {
    await env.DB.prepare('INSERT INTO reports (token, period, from_day, to_day, partial, label, ts, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(token, period, report.from, report.to, report.partial ? 1 : 0, `${report.kind} · ${report.label}`, report.created, JSON.stringify(report)).run();
  } catch {
    return json({ error: 'Could not save the report.' }, 500);
  }
  return json({ token, url: linkFor(request, token), label: `${report.kind} · ${report.label}`, summaryNote: report.summaryNote });
}

async function DELETE({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database is connected (DB_URL and DB_TOKEN).' }, 503);
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return json({ error: 'Which report?' }, 400);
  try {
    await env.DB.prepare('DELETE FROM reports WHERE token = ?').bind(token).run();
  } catch {
    return json({ error: 'Could not remove it.' }, 500);
  }
  return json({ ok: true });
}

module.exports = serve({ GET, POST, DELETE });
