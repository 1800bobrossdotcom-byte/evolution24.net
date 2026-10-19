/* =============================================================================
   The dashboard's numbers, in one place: Charlotte Square's _lib/stats.js, for
   eleven buildings instead of one.

   /api/stats/ shows them; a shared report snapshots them. One function means a
   report can never describe numbers the dashboard does not show.

   What is new here: `properties` (each building's views, visitors, phone taps,
   Apply clicks and enquiries), `units` (the homes whose Apply link was used
   most) and `availability` (what Rent Manager last said was open). What is gone:
   the style switcher and the /tour/ test, which this site does not have.

   Every query is parameterised; the only inputs are two dates the callers make.
   ============================================================================= */
'use strict';

const CONFIG = require('../leads-config.json');

const LIMIT = 12;
const SIZE = { studio: 'Studio', b1: '1 bedroom', b2: '2 bedroom', b3: '3 bedroom', 1: '1 bedroom', 2: '2 bedroom', 3: '3 bedroom' };

const rate = (leads, visits) => (visits ? Math.round((leads / visits) * 1000) / 10 : 0);

/* Days are UTC calendar days, 'YYYY-MM-DD', the same as the day column. */
const isoDay = (d) => d.toISOString().slice(0, 10);
const addDays = (day, n) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000));
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

/** The last `days` days, today included: what the dashboard's buttons mean. */
function rangeForDays(days) {
  const to = isoDay(new Date());
  return { from: addDays(to, -(days - 1)), to };
}

/** The words for the forms' coded answers, for the dashboard and reports. */
function labels() {
  return { interest: CONFIG.interest, bedrooms: CONFIG.bedrooms, move_in: CONFIG.move_in, source: CONFIG.source };
}

/** Headline counts only, for comparing a report with the period before it. */
async function loadTotals(env, { from, to }) {
  const q = (sql) => env.DB.prepare(sql).bind(from, to);
  const [ev, ld] = await env.DB.batch([
    q(`SELECT SUM(kind = 'pageview')         AS pageviews,
              COUNT(DISTINCT day || visitor) AS visits,
              SUM(kind = 'phone_click')      AS phone_clicks,
              SUM(kind = 'apply_click')      AS apply_clicks,
              COUNT(DISTINCT CASE WHEN kind = 'form_start' THEN day || visitor END) AS starts
         FROM events WHERE day BETWEEN ? AND ?`),
    q('SELECT COUNT(*) AS leads FROM inquiries WHERE day BETWEEN ? AND ?'),
  ]);
  const e = ev.results[0] || {};
  return {
    pageviews: e.pageviews || 0, visits: e.visits || 0, phone_clicks: e.phone_clicks || 0,
    apply_clicks: e.apply_clicks || 0, starts: e.starts || 0, leads: (ld.results[0] && ld.results[0].leads) || 0,
  };
}

async function loadStats(env, { from, to }) {
  const days = daysBetween(from, to);
  const q = (sql, ...bind) => env.DB.prepare(sql).bind(...bind);

  const [totals, daily, pages, referrers, countries, devices, events, sizes, buildings, units] = await env.DB.batch([
    q(`SELECT SUM(kind = 'pageview')         AS pageviews,
              COUNT(DISTINCT day || visitor) AS visits,
              SUM(kind = 'phone_click')      AS phone_clicks,
              SUM(kind = 'portal_click')     AS portal_clicks,
              SUM(kind = 'apply_click')      AS apply_clicks,
              SUM(kind = 'email_click')      AS email_clicks
         FROM events WHERE day BETWEEN ? AND ?`, from, to),
    q(`SELECT day, SUM(kind = 'pageview') AS pageviews, COUNT(DISTINCT visitor) AS visits
         FROM events WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`, from, to),
    q(`SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visits
         FROM events WHERE day BETWEEN ? AND ? AND kind = 'pageview'
        GROUP BY path ORDER BY views DESC LIMIT ?`, from, to, LIMIT),
    // A null ref is someone who typed the address or used a bookmark: its own row.
    q(`SELECT COALESCE(ref, 'direct') AS ref, COUNT(*) AS views
         FROM events WHERE day BETWEEN ? AND ? AND kind = 'pageview'
        GROUP BY ref ORDER BY views DESC LIMIT ?`, from, to, LIMIT),
    q(`SELECT COALESCE(country, '—') AS country, COUNT(*) AS views
         FROM events WHERE day BETWEEN ? AND ? AND kind = 'pageview'
        GROUP BY country ORDER BY views DESC LIMIT ?`, from, to, LIMIT),
    q(`SELECT COALESCE(device, '—') AS device, COUNT(*) AS views
         FROM events WHERE day BETWEEN ? AND ? AND kind = 'pageview'
        GROUP BY device ORDER BY views DESC`, from, to),
    q(`SELECT kind, COUNT(*) AS count
         FROM events WHERE day BETWEEN ? AND ? AND kind <> 'pageview'
        GROUP BY kind ORDER BY count DESC`, from, to),
    // Which size of home people filter to: the leasing-relevant number.
    q(`SELECT json_extract(meta, '$.value') AS size, COUNT(*) AS count
         FROM events WHERE day BETWEEN ? AND ? AND kind = 'filter' AND meta IS NOT NULL
        GROUP BY size`, from, to),
    // Each building's page: views and visitors; its phone taps and Apply clicks
    // wherever they happened (an Apply link names its building).
    q(`SELECT property,
              SUM(kind = 'pageview')                                                AS views,
              COUNT(DISTINCT CASE WHEN kind = 'pageview' THEN day || visitor END)   AS visits,
              SUM(kind = 'phone_click')                                             AS phone_clicks,
              SUM(kind = 'apply_click')                                             AS apply_clicks
         FROM events WHERE day BETWEEN ? AND ? AND property IS NOT NULL
        GROUP BY property`, from, to),
    q(`SELECT property, json_extract(meta, '$.unit') AS unit, COUNT(*) AS clicks
         FROM events WHERE day BETWEEN ? AND ? AND kind = 'apply_click' AND json_extract(meta, '$.unit') IS NOT NULL
        GROUP BY property, unit ORDER BY clicks DESC LIMIT ?`, from, to, LIMIT),
  ]);

  /* ---- Enquiries come from the inquiries table, not from browser events: the
     table is the record, and nothing a browser blocks can drop a row from it. */
  let leadTotal = 0;
  const leadByDay = new Map();
  const leadByProperty = new Map();
  const leadSizes = [];
  const asked = { interests: [], topics: [] };
  try {
    const [lt, ld, lb, lp, li] = await env.DB.batch([
      q('SELECT COUNT(*) AS n FROM inquiries WHERE day BETWEEN ? AND ?', from, to),
      q('SELECT day, COUNT(*) AS leads FROM inquiries WHERE day BETWEEN ? AND ? GROUP BY day', from, to),
      q(`SELECT COALESCE(property, '') AS property, COUNT(*) AS leads
           FROM inquiries WHERE day BETWEEN ? AND ? GROUP BY property`, from, to),
      q(`SELECT bedrooms AS size, COUNT(*) AS count
           FROM inquiries WHERE day BETWEEN ? AND ? AND bedrooms IS NOT NULL AND bedrooms <> 'any' GROUP BY bedrooms`, from, to),
      q(`SELECT interest, COUNT(*) AS count
           FROM inquiries WHERE day BETWEEN ? AND ? AND interest IS NOT NULL
          GROUP BY interest ORDER BY count DESC`, from, to),
    ]);
    leadTotal = (lt.results[0] && lt.results[0].n) || 0;
    for (const r of ld.results) leadByDay.set(r.day, r.leads);
    for (const r of lb.results) leadByProperty.set(r.property, r.leads);
    leadSizes.push(...lp.results);
    asked.interests = li.results;
  } catch { /* no inquiries yet */ }
  try {
    const { results } = await q(
      `SELECT t.value AS topic, COUNT(*) AS count
         FROM inquiries, json_each(json_extract(inquiries.ai, '$.topics')) AS t
        WHERE inquiries.day BETWEEN ? AND ? AND inquiries.ai IS NOT NULL
        GROUP BY t.value ORDER BY count DESC`, from, to).all();
    asked.topics = results;
  } catch { /* no summaries */ }

  // Every day in the range, zeros included, so a quiet day is a dip, not a gap.
  const traffic = new Map(daily.results.map((r) => [r.day, r]));
  const dailyOut = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const r = traffic.get(day) || {};
    dailyOut.push({ day, pageviews: r.pageviews || 0, visits: r.visits || 0, leads: leadByDay.get(day) || 0 });
  }

  // Size interest: the filter chips and the enquiries' bedroom choice, added together.
  const sizeCount = new Map();
  for (const r of [...sizes.results, ...leadSizes]) {
    const name = SIZE[r.size];
    if (name) sizeCount.set(name, (sizeCount.get(name) || 0) + r.count);
  }
  const plans = [...sizeCount.entries()].map(([plan, count]) => ({ plan, count }))
    .sort((a, b) => b.count - a.count);

  // Every building on the site, with nothing for the quiet ones, so a building
  // nobody looked at shows as a zero instead of disappearing.
  const seen = new Map(buildings.results.map((r) => [r.property, r]));
  const properties = Object.entries({ ...CONFIG.properties, ...CONFIG.external }).map(([slug, p]) => {
    const r = seen.get(slug) || {};
    const leads = leadByProperty.get(slug) || 0;
    return {
      slug, name: p.name, city: p.city, views: r.views || 0, visits: r.visits || 0,
      phone_clicks: r.phone_clicks || 0, apply_clicks: r.apply_clicks || 0, leads, rate: rate(leads, r.visits || 0),
    };
  }).sort((a, b) => b.leads - a.leads || b.views - a.views || a.name.localeCompare(b.name));
  const nameOf = (slug) => (CONFIG.properties[slug] || CONFIG.external[slug] || { name: slug || '—' }).name;
  const unitsOut = units.results.map((r) => ({ property: nameOf(r.property), slug: r.property, unit: String(r.unit), clicks: r.clicks }));

  const t = totals.results[0] || {};
  const pv = t.pageviews || 0;
  const leads = leadTotal;

  /* ---- Where enquiries come from. A visitor's channel is their first pageview
     of the day carrying a campaign tag or an outside referrer, else their first:
     the same rule /api/inquiry/ uses to label an enquiry. */
  let sources = [];
  let campaigns = [];
  let starts = 0;
  try {
    const src = (ref) => `COALESCE(utm_source || ' / ' || utm_medium, utm_source, ${ref}, 'direct')`;
    const [sv, sl, cv, cl, fs] = await env.DB.batch([
      q(`SELECT channel, COUNT(*) AS visits FROM (
           SELECT ${src('ref')} AS channel,
                  ROW_NUMBER() OVER (PARTITION BY day, visitor ORDER BY (utm_source IS NULL AND ref IS NULL), ts) AS n
             FROM events WHERE day BETWEEN ? AND ? AND kind = 'pageview')
          WHERE n = 1 GROUP BY channel`, from, to),
      q(`SELECT ${src('referrer')} AS channel, COUNT(*) AS leads
           FROM inquiries WHERE day BETWEEN ? AND ? GROUP BY channel`, from, to),
      q(`SELECT utm_campaign AS campaign, COUNT(DISTINCT day || visitor) AS visits
           FROM events WHERE day BETWEEN ? AND ? AND kind = 'pageview' AND utm_campaign IS NOT NULL
          GROUP BY utm_campaign`, from, to),
      q(`SELECT utm_campaign AS campaign, COUNT(*) AS leads
           FROM inquiries WHERE day BETWEEN ? AND ? AND utm_campaign IS NOT NULL GROUP BY utm_campaign`, from, to),
      q(`SELECT COUNT(DISTINCT day || visitor) AS n
           FROM events WHERE day BETWEEN ? AND ? AND kind = 'form_start'`, from, to),
    ]);
    const join = (visitRows, leadRows, key) => {
      const m = new Map();
      for (const r of visitRows) m.set(r[key], { [key]: r[key], visits: r.visits, leads: 0 });
      for (const r of leadRows) {
        if (!m.has(r[key])) m.set(r[key], { [key]: r[key], visits: 0, leads: 0 });
        m.get(r[key]).leads = r.leads;
      }
      return [...m.values()].map((r) => ({ ...r, rate: rate(r.leads, r.visits) }))
        .sort((a, b) => b.leads - a.leads || b.visits - a.visits).slice(0, LIMIT);
    };
    sources = join(sv.results, sl.results, 'channel');
    campaigns = join(cv.results, cl.results, 'campaign');
    starts = (fs.results[0] && fs.results[0].n) || 0;
  } catch { /* nothing tagged yet */ }

  return {
    range: { from, to, days },
    totals: {
      pageviews: pv,
      visits: t.visits || 0,
      leads,
      phone_clicks: t.phone_clicks || 0,
      portal_clicks: t.portal_clicks || 0,
      apply_clicks: t.apply_clicks || 0,
      email_clicks: t.email_clicks || 0,
      lead_rate: pv ? Math.round((leads / pv) * 1000) / 10 : 0,   // per hundred pageviews
    },
    funnel: { visitors: t.visits || 0, starts, leads },
    daily: dailyOut,
    pages: pages.results,
    referrers: referrers.results,
    sources,
    campaigns,
    asked,
    countries: countries.results,
    devices: devices.results,
    events: events.results,
    plans,
    properties,
    units: unitsOut,
    availability: { as_of: CONFIG.units_as_of, open: CONFIG.open_units },
    emails: await loadEmails(env, { from, to }),
    labels: labels(),
  };
}

/* What the site emailed in the range and what Resend reported back: totals
   only, never a person, so they can go in a shared report. */
async function loadEmails(env, { from, to }) {
  const q = (sql, ...bind) => env.DB.prepare(sql).bind(...bind);
  const fromTs = Date.parse(`${from}T00:00:00Z`) / 1000;
  const toTs = Date.parse(`${to}T00:00:00Z`) / 1000 + 86400;
  try {
    const [c, n, u] = await env.DB.batch([
      q(`SELECT SUM(sent = 1)                               AS sent,
                SUM(sent = 1 AND delivered_at IS NOT NULL)  AS delivered,
                SUM(sent = 1 AND bounced_at IS NOT NULL)    AS bounced,
                SUM(sent = 1 AND complained_at IS NOT NULL) AS complained,
                SUM(sent = 1 AND opened_at IS NOT NULL)     AS opened,
                SUM(sent = 1 AND clicked_at IS NOT NULL)    AS clicked,
                SUM(sent = 0 AND reason = 'unsubscribed')   AS held_unsubscribed,
                SUM(sent = 0 AND reason = 'recent')         AS held_recent,
                SUM(sent = 0 AND reason = 'error')          AS failed
           FROM emails WHERE kind = 'confirmation' AND day BETWEEN ? AND ?`, from, to),
      q(`SELECT COUNT(*) AS leads, SUM(notified = 1) AS reached,
                (SELECT COUNT(*) FROM emails
                  WHERE kind = 'notification' AND sent = 1 AND bounced_at IS NOT NULL AND day BETWEEN ? AND ?) AS bounced
           FROM inquiries WHERE day BETWEEN ? AND ?`, from, to, from, to),
      q('SELECT COUNT(*) AS n FROM email_prefs WHERE unsubscribed_at >= ? AND unsubscribed_at < ?', fromTs, toTs),
    ]);
    const r = c.results[0] || {};
    const l = n.results[0] || {};
    return {
      confirmations: {
        sent: r.sent || 0, delivered: r.delivered || 0, bounced: r.bounced || 0, complained: r.complained || 0,
        opened: r.opened || 0, clicked: r.clicked || 0, held_unsubscribed: r.held_unsubscribed || 0,
        held_recent: r.held_recent || 0, failed: r.failed || 0,
      },
      notifications: { enquiries: l.leads || 0, reached: l.reached || 0, bounced: l.bounced || 0 },
      unsubscribes: (u.results[0] && u.results[0].n) || 0,
      tracking: Boolean(env.RESEND_WEBHOOK_SECRET),
    };
  } catch {
    return null;
  }
}

module.exports = { isoDay, addDays, daysBetween, rangeForDays, loadTotals, loadStats, loadEmails, labels };
