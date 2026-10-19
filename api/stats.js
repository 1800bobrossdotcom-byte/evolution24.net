/* =============================================================================
   GET /api/stats/?days=30 — the whole dashboard payload in one round trip.
   Session-gated; days is coerced to 1–365 before it goes anywhere near SQL.
   ============================================================================= */
'use strict';

const { serve, json } = require('./_lib/web.js');
const { requireSession } = require('./_lib/auth.js');
const { loadStats, rangeForDays } = require('./_lib/stats.js');
const { aiEnabled } = require('./_lib/ai.js');

async function GET({ request, env }) {
  const denied = await requireSession(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database is connected (DB_URL and DB_TOKEN).' }, 503);
  const asked = Number.parseInt(new URL(request.url).searchParams.get('days') || '30', 10);
  const days = Math.min(Math.max(Number.isFinite(asked) ? asked : 30, 1), 365);
  return json({ ...(await loadStats(env, rangeForDays(days))), ai: aiEnabled(env) });
}

module.exports = serve({ GET });
