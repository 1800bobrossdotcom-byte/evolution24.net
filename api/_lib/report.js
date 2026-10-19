/* =============================================================================
   Reports: one day, one week or one month of the dashboard, frozen into a
   snapshot that can be shared by link and saved as a PDF. Charlotte Square's
   _lib/report.js, with a section per building.

   A snapshot holds aggregate numbers only, the same ones the dashboard shows.
   Never a name, an email address, a phone number or a message: a report link
   is made to be passed around, so nothing on it may identify anyone.

   Days are UTC calendar days, like everything else in the analytics. Weeks
   run Monday to Sunday.
   ============================================================================= */
'use strict';

const { loadStats, loadTotals, addDays, daysBetween, isoDay } = require('./stats.js');
const CONFIG = require('../leads-config.json');

const PERIODS = ['day', 'week', 'month'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const utc = (day) => new Date(`${day}T00:00:00Z`);

/** The period that contains `day`, cut off at today; partial while it runs. */
function periodRange(period, day, today = isoDay(new Date())) {
  const d = utc(day);
  let from;
  let end;
  if (period === 'day') {
    from = day; end = day;
  } else if (period === 'week') {
    from = addDays(day, -((d.getUTCDay() + 6) % 7));     // back to Monday
    end = addDays(from, 6);
  } else {
    from = `${day.slice(0, 7)}-01`;
    end = isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  }
  return { from, to: end > today ? today : end, partial: end >= today };
}

/** The stretch before it, for the "vs" figures. A period still running is
 *  compared with the same number of days of the one before. */
function previousRange(period, { from, to }) {
  if (period === 'day') return { from: addDays(from, -1), to: addDays(to, -1) };
  if (period === 'week') return { from: addDays(from, -7), to: addDays(to, -7) };
  const f = utc(from);
  const pFrom = isoDay(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, 1)));
  const pEnd = addDays(from, -1);
  const pTo = addDays(pFrom, daysBetween(from, to) - 1);
  return { from: pFrom, to: pTo < pEnd ? pTo : pEnd };
}

const md = (day) => `${MONTHS[utc(day).getUTCMonth()]} ${utc(day).getUTCDate()}`;

/** "September 15–21, 2026", "September 28 – October 4, 2026" */
function spanLabel(from, to) {
  const f = utc(from);
  const t = utc(to);
  if (from === to) return `${md(from)}, ${t.getUTCFullYear()}`;
  if (f.getUTCFullYear() !== t.getUTCFullYear()) return `${md(from)}, ${f.getUTCFullYear()} – ${md(to)}, ${t.getUTCFullYear()}`;
  if (f.getUTCMonth() !== t.getUTCMonth()) return `${md(from)} – ${md(to)}, ${t.getUTCFullYear()}`;
  return `${md(from)}–${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

function periodLabel(period, { from, to, partial }) {
  const so = partial ? ' (so far)' : '';
  if (period === 'day') return `${WEEKDAYS[utc(from).getUTCDay()]}, ${spanLabel(from, to)}${so}`;
  if (period === 'month') {
    const t = utc(to);
    return `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}${partial ? `, through ${md(to)}` : ''}`;
  }
  return `${spanLabel(from, to)}${so}`;
}

const NOUN = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
const BEFORE = { day: 'the day before', week: 'the week before', month: 'the month before' };

/** Everything the report page shows, computed once and kept. */
async function buildReport(env, period, day) {
  const range = periodRange(period, day);
  const prev = previousRange(period, range);
  const [stats, before] = await Promise.all([loadStats(env, range), loadTotals(env, prev)]);
  return {
    v: 1,
    period,
    kind: NOUN[period],
    from: range.from,
    to: range.to,
    partial: range.partial,
    label: periodLabel(period, range),
    previous: { ...prev, label: spanLabel(prev.from, prev.to), what: range.partial ? `the same days of ${BEFORE[period]}` : BEFORE[period], totals: before },
    totals: {
      visits: stats.totals.visits, pageviews: stats.totals.pageviews, leads: stats.totals.leads,
      phone_clicks: stats.totals.phone_clicks, apply_clicks: stats.totals.apply_clicks, starts: stats.funnel.starts,
    },
    daily: stats.daily.map(({ day: d, visits, leads }) => ({ day: d, visits, leads })),
    sources: stats.sources,
    campaigns: stats.campaigns,
    properties: stats.properties.map(({ name, visits, apply_clicks, phone_clicks, leads }) => ({ name, visits, apply_clicks, phone_clicks, leads })),
    units: stats.units,
    asked: stats.asked,
    plans: stats.plans,
    pages: stats.pages.slice(0, 8).map(({ path, views }) => ({ path, views })),
    devices: stats.devices,
    emails: stats.emails,
    summary: null,
    summaryNote: null,
    created: Math.floor(Date.now() / 1000),
  };
}

/* ---- The page ----------------------------------------------------------------
   Rendered on the server so a colleague needs nothing but the link: no login,
   no script for the content, and the browser's print dialog makes the PDF.
   Every string from the data goes through esc(). */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (part, whole) => (!whole || part > whole ? '—' : `${Math.round((part / whole) * 1000) / 10}%`);
const shortDay = (day) => `${MONTHS[utc(day).getUTCMonth()].slice(0, 3)} ${utc(day).getUTCDate()}`;
const channelName = (c) => (c === 'direct' ? 'Typed in or bookmarked' : String(c).replace(/_/g, ' '));

/** "▲ 18%" against the period before. Up is good for every figure here. */
function delta(cur, prev) {
  if (!prev) return cur ? { text: 'new this period', dir: 'up' } : { text: 'no change', dir: 'flat' };
  const change = Math.round(((cur - prev) / prev) * 100);
  if (change === 0) return { text: 'no change', dir: 'flat' };
  return { text: `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}%`, dir: change > 0 ? 'up' : 'down' };
}
function pointsDelta(cur, prev) {
  const diff = Math.round((cur - prev) * 10) / 10;
  if (!diff) return { text: 'no change', dir: 'flat' };
  return { text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} pts`, dir: diff > 0 ? 'up' : 'down' };
}
const conversion = (t) => (t.visits ? (t.leads / t.visits) * 100 : 0);

function tile(label, value, d) {
  return `<div class="kpi"><p class="kpi__k">${esc(label)}</p><p class="kpi__v">${esc(value)}</p><p class="kpi__d kpi__d--${d.dir}">${esc(d.text)}</p></div>`;
}

/** A round number at or just above the tallest bar, whose half is whole too. */
function niceMax(v) {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const c of [1, 1.2, 1.4, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) {
    const m = Math.round(c * mag);
    if (m >= v && m % 2 === 0) return m;
  }
  return 10 * mag;
}

/** Columns for one series: one axis, one colour, the tallest labelled, every bar titled. */
function columns(rows, key, cls, unit) {
  const W = 640;
  const H = 150;
  const P = { l: 34, r: 6, t: 16, b: 22 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const max = niceMax(Math.max(0, ...rows.map((r) => r[key])));
  const slot = iw / rows.length;
  const bw = Math.min(24, Math.max(2, slot - 2));
  const y = (v) => P.t + ih - (v / max) * ih;
  const out = [];
  for (const v of [0, max / 2, max]) {
    out.push(`<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>`);
    out.push(`<text class="ax" x="${P.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${num(v)}</text>`);
  }
  let peak = 0;
  rows.forEach((r, i) => { if (r[key] > rows[peak][key]) peak = i; });
  rows.forEach((r, i) => {
    const v = r[key];
    const x = P.l + i * slot + (slot - bw) / 2;
    const h = (v / max) * ih;
    const tip = `<title>${esc(shortDay(r.day))}: ${num(v)} ${esc(v === 1 ? unit[0] : unit[1])}</title>`;
    if (v > 0) {
      const rad = Math.min(4, h, bw / 2);
      const top = P.t + ih - h;
      const base = P.t + ih;
      out.push(`<path class="${cls}" d="M${x} ${base}V${top + rad}Q${x} ${top} ${x + rad} ${top}H${x + bw - rad}Q${x + bw} ${top} ${x + bw} ${top + rad}V${base}Z">${tip}</path>`);
    } else {
      out.push(`<rect class="hit" x="${x}" y="${P.t}" width="${bw}" height="${ih}">${tip}</rect>`);
    }
  });
  if (rows[peak] && rows[peak][key] > 0) {
    out.push(`<text class="val" x="${P.l + peak * slot + slot / 2}" y="${y(rows[peak][key]) - 5}" text-anchor="middle">${num(rows[peak][key])}</text>`);
  }
  const ticks = rows.length <= 7 ? rows.map((_, i) => i) : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
  for (const i of ticks) out.push(`<text class="ax" x="${P.l + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(shortDay(rows[i].day))}</text>`);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit[1])} per day">${out.join('')}</svg>`;
}

function table(cols, rows, empty) {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** Confirmations to visitors, then the team's notifications. Delivery rows
 *  only once Resend's reports are connected, so a zero never means "unknown". */
function emailRows(e) {
  const c = e.confirmations;
  const rows = [['Confirmations sent to visitors', c.sent, '']];
  if (e.tracking) {
    rows.push(['Delivered', c.delivered, pct(c.delivered, c.sent)], ['Bounced', c.bounced, pct(c.bounced, c.sent)],
      ['Marked as spam', c.complained, pct(c.complained, c.sent)]);
    if (c.opened) rows.push(['Opened', c.opened, pct(c.opened, c.sent)]);
    if (c.clicked) rows.push(['Clicked a link', c.clicked, pct(c.clicked, c.sent)]);
  }
  rows.push(['Unsubscribed', e.unsubscribes, '']);
  if (c.held_unsubscribed) rows.push(['Not sent: had unsubscribed', c.held_unsubscribed, '']);
  if (c.held_recent) rows.push(['Not sent: had one in the last 12 hours', c.held_recent, '']);
  if (c.failed) rows.push(['Not sent: the email provider refused', c.failed, '']);
  rows.push(['Enquiries emailed to the leasing team', e.notifications.reached, pct(e.notifications.reached, e.notifications.enquiries)]);
  if (e.tracking && e.notifications.bounced) rows.push(['Leasing emails that bounced', e.notifications.bounced, '']);
  return rows;
}
function emailTable(e) {
  return `${table(['Email', 'Count', 'Share'], emailRows(e).map(([k, v, s]) => [k, num(v), s]), '')}${e.tracking ? ''
    : '<p class="verdict">Delivery, bounce and spam counts start once Resend’s delivery reports are connected.</p>'}`;
}

function renderReport(r) {
  const t = r.totals;
  const p = r.previous.totals;
  const created = new Date(r.created * 1000).toISOString().slice(0, 10);
  const kpis = [
    tile('Visitors', num(t.visits), delta(t.visits, p.visits)),
    tile('Enquiries', num(t.leads), delta(t.leads, p.leads)),
    tile('Visitors who enquired', pct(t.leads, t.visits), pointsDelta(conversion(t), conversion(p))),
    tile('Apply clicks', num(t.apply_clicks), delta(t.apply_clicks, p.apply_clicks || 0)),
    tile('Phone taps', num(t.phone_clicks), delta(t.phone_clicks, p.phone_clicks)),
  ].join('');
  const charts = r.daily.length > 1 ? `<section class="card" aria-labelledby="s-days">
  <h2 id="s-days">Day by day</h2>
  <div class="charts">
    <figure><figcaption><i class="sw sw--visits"></i>Visitors per day</figcaption>${columns(r.daily, 'visits', 'bar bar--visits', ['visitor', 'visitors'])}</figure>
    <figure><figcaption><i class="sw sw--leads"></i>Enquiries per day</figcaption>${columns(r.daily, 'leads', 'bar bar--leads', ['enquiry', 'enquiries'])}</figure>
  </div>
  <details class="days"><summary>Daily numbers</summary>${table(['Day', 'Visitors', 'Enquiries'], r.daily.map((d) => [shortDay(d.day), num(d.visits), num(d.leads)]), '')}</details>
</section>` : '';
  const buildings = (r.properties || []).filter((b) => b.visits || b.leads || b.apply_clicks || b.phone_clicks);
  const interests = (r.asked.interests || []).map((x) => [CONFIG.interest[x.interest] || x.interest, num(x.count)]);
  const sections = [
    ['By building', table(['Building', 'Visitors', 'Apply clicks', 'Phone taps', 'Enquiries', 'Rate'],
      buildings.map((b) => [b.name, num(b.visits), num(b.apply_clicks), num(b.phone_clicks), num(b.leads), pct(b.leads, b.visits)]), 'No visits to a building’s page in this period.')],
    ['Where enquiries came from', table(['Channel', 'Visitors', 'Enquiries', 'Rate'],
      r.sources.map((s) => [channelName(s.channel), num(s.visits), num(s.leads), pct(s.leads, s.visits)]), 'No visits in this period.')],
    ['Campaigns', table(['Campaign', 'Visitors', 'Enquiries', 'Rate'],
      r.campaigns.map((c) => [c.campaign, num(c.visits), num(c.leads), pct(c.leads, c.visits)]), 'No tagged campaigns in this period.')],
    ['From visit to enquiry', table(['Step', 'People', 'Of visitors'], [
      ['Visitors', num(t.visits), ''],
      ['Started an enquiry form', num(t.starts), pct(t.starts, t.visits)],
      ['Sent an enquiry', num(t.leads), pct(t.leads, t.visits)],
    ], '')],
    ['Units people applied for', table(['Building', 'Unit', 'Apply clicks'], (r.units || []).map((u) => [u.property, u.unit, num(u.clicks)]), 'No Apply clicks in this period.')],
    ['What people asked about', table(['Asked about', 'Enquiries'], interests, 'No enquiries in this period.')],
    ['Size interest', table(['Size', 'Times'], r.plans.map((x) => [x.plan, num(x.count)]), 'None in this period.')],
    ['Most viewed pages', table(['Page', 'Views'], r.pages.map((x) => [x.path, num(x.views)]), 'None in this period.')],
    ...(r.emails ? [['Emails', emailTable(r.emails)]] : []),
  ].map(([h, body], i) => `<section class="card" aria-labelledby="s-${i}"><h2 id="s-${i}">${esc(h)}</h2>${body}</section>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.kind)} report · ${esc(r.label)} · Evolution24 Properties</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/assets/img/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/report.css">
</head>
<body>
<main class="report">
  <header class="head">
    <p class="brand"><img class="mark" src="/assets/img/mark.svg" width="34" height="26" alt=""><span>Evolution24 Properties</span></p>
    <p class="kicker">${esc(r.kind)} report</p>
    <h1>${esc(r.label)}</h1>
    <p class="meta">Compared with ${esc(r.previous.what)} (${esc(r.previous.label)}) · created ${esc(spanLabel(created, created))}</p>
    <p class="actions"><button type="button" data-print>Save as PDF</button> <button type="button" data-copy>Copy link</button></p>
  </header>
  <section class="kpis" aria-label="Headline numbers">${kpis}</section>
  ${charts}
  <div class="grid">${sections}</div>
  <footer class="foot">Totals only: this report holds no names, contact details or messages. From the evolution24.net dashboard; days are counted in UTC.</footer>
</main>
<script src="/assets/js/report.js" defer></script>
</body>
</html>`;
}

const GONE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report not found · Evolution24 Properties</title>
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="/assets/css/report.css">
</head>
<body>
<main class="report report--gone">
  <h1>This report is not available.</h1>
  <p>The link may have been turned off, or copied incompletely. Ask whoever sent it for a new one.</p>
</main>
</body>
</html>`;

/* A report's headers: nothing keeps a copy (turning a link off works at once),
   and the address, which is the key, is never passed on. */
const REPORT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};

module.exports = { PERIODS, periodRange, previousRange, spanLabel, periodLabel, buildReport, renderReport, emailRows, GONE, REPORT_HEADERS };
