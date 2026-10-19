/* =============================================================================
   /r/<token>/ — a shared report, readable by anyone with the link (vercel.json
   rewrites it here as /api/r/?token=…). No session: the unguessable token is
   the permission, and the page holds totals only. Stop sharing it from the
   dashboard and the row is deleted, so this answers 404 from then on.
   ============================================================================= */
'use strict';

const { serve, html } = require('./_lib/web.js');
const { renderReport, GONE, REPORT_HEADERS } = require('./_lib/report.js');

async function GET({ request, env }) {
  const gone = () => html(GONE, 404, REPORT_HEADERS);
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || !env.DB) return gone();
  let row = null;
  try { row = await env.DB.prepare('SELECT body FROM reports WHERE token = ?').bind(token).first(); } catch { /* none */ }
  if (!row) return gone();
  let report;
  try { report = JSON.parse(row.body); } catch { return gone(); }
  return html(renderReport(report), 200, REPORT_HEADERS);
}

module.exports = serve({ GET });
