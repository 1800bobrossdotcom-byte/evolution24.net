/* =============================================================================
   The database's tables. Charlotte Square's schema.sql, for a site with eleven
   buildings: events and enquiries carry the building they are about.

   Every statement is idempotent; db.js runs them all once per server instance,
   so a new table here is created on the first request after the deploy. A new
   column on an existing table needs an ALTER TABLE added below, guarded the
   same way.
   ============================================================================= */
'use strict';

module.exports = [
  // One pageview or named event. Nothing personal: the visitor column is a hash
  // of the day, a secret salt, the address and the browser, which changes at
  // midnight, so it counts visits without recognising anyone from one day to
  // the next (api/_lib/auth.js visitorHash).
  `CREATE TABLE IF NOT EXISTS events (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     ts           INTEGER NOT NULL,          -- unix seconds, UTC
     day          TEXT    NOT NULL,          -- YYYY-MM-DD, UTC
     kind         TEXT    NOT NULL DEFAULT 'pageview',
     path         TEXT    NOT NULL,
     property     TEXT,                      -- building slug, from the page or the link
     ref          TEXT,                      -- referrer host only
     country      TEXT,
     device       TEXT,                      -- mobile | tablet | desktop
     meta         TEXT,                      -- small JSON: which unit, which filter
     visitor      TEXT    NOT NULL,
     utm_source   TEXT,
     utm_medium   TEXT,
     utm_campaign TEXT
   )`,
  'CREATE INDEX IF NOT EXISTS idx_events_day      ON events(day)',
  'CREATE INDEX IF NOT EXISTS idx_events_day_kind ON events(day, kind)',
  'CREATE INDEX IF NOT EXISTS idx_events_day_path ON events(day, path)',
  'CREATE INDEX IF NOT EXISTS idx_events_visitor  ON events(day, visitor)',
  'CREATE INDEX IF NOT EXISTS idx_events_property ON events(day, property)',

  `CREATE TABLE IF NOT EXISTS login_attempts (
     ip    TEXT    PRIMARY KEY,
     fails INTEGER NOT NULL DEFAULT 0,
     until INTEGER NOT NULL DEFAULT 0
   )`,

  // One enquiry. The visitor's own words, so the dashboard shows every field
  // with textContent and nothing here is ever built into HTML unescaped.
  `CREATE TABLE IF NOT EXISTS inquiries (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     ref           TEXT,                     -- E24-YYMMDD-XXXX, the number the team quotes
     ts            INTEGER NOT NULL,
     day           TEXT    NOT NULL,
     property      TEXT,                     -- building slug, '' for none
     property_name TEXT,
     first_name    TEXT    NOT NULL,
     last_name     TEXT    NOT NULL,
     email         TEXT    NOT NULL,
     phone         TEXT,
     interest      TEXT,                     -- tour | availability | apply | waitlist | question
     bedrooms      TEXT,                     -- studio | 1 | 2 | 3 | any
     unit          TEXT,                     -- the home asked about, as the site names it
     unit_id       INTEGER,                  -- its Rent Manager UnitID
     move_in       TEXT,                     -- asap | later | YYYY-MM
     source        TEXT,                     -- how they heard about us
     message       TEXT,
     country       TEXT,
     form          TEXT,                     -- property | contact
     page          TEXT,                     -- the page it was sent from
     notified      INTEGER NOT NULL DEFAULT 0,
     notify_err    TEXT,
     handled       INTEGER NOT NULL DEFAULT 0,
     utm_source    TEXT,
     utm_medium    TEXT,
     utm_campaign  TEXT,
     referrer      TEXT,
     landing       TEXT,
     rm_ok         INTEGER,                  -- 1 added to Rent Manager as a prospect, 0 tried and failed
     rm_id         TEXT,                     -- the prospect's ID there
     rm_note       TEXT,
     ai            TEXT,
     ai_err        TEXT
   )`,
  'CREATE INDEX IF NOT EXISTS idx_inquiries_ts       ON inquiries(ts DESC)',
  'CREATE INDEX IF NOT EXISTS idx_inquiries_day      ON inquiries(day)',
  'CREATE INDEX IF NOT EXISTS idx_inquiries_handled  ON inquiries(handled, ts DESC)',
  'CREATE INDEX IF NOT EXISTS idx_inquiries_property ON inquiries(property, ts DESC)',
  'CREATE INDEX IF NOT EXISTS idx_inquiries_ref      ON inquiries(ref)',

  `CREATE TABLE IF NOT EXISTS inquiry_attempts (
     ip     TEXT    PRIMARY KEY,
     count  INTEGER NOT NULL DEFAULT 0,
     window INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE IF NOT EXISTS insights (
     key  TEXT    PRIMARY KEY,
     ts   INTEGER NOT NULL,
     body TEXT    NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS reports (
     token    TEXT    PRIMARY KEY,
     period   TEXT    NOT NULL,              -- day | week | month
     from_day TEXT    NOT NULL,
     to_day   TEXT    NOT NULL,
     partial  INTEGER NOT NULL DEFAULT 0,
     label    TEXT    NOT NULL,
     ts       INTEGER NOT NULL,
     body     TEXT    NOT NULL               -- JSON snapshot, totals only
   )`,
  'CREATE INDEX IF NOT EXISTS idx_reports_ts ON reports(ts DESC)',

  `CREATE TABLE IF NOT EXISTS email_prefs (
     email           TEXT    PRIMARY KEY,    -- lower-cased
     token           TEXT    NOT NULL UNIQUE,
     created_at      INTEGER NOT NULL,
     last_sent_at    INTEGER,
     unsubscribed_at INTEGER
   )`,

  `CREATE TABLE IF NOT EXISTS emails (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     ts            INTEGER NOT NULL,
     day           TEXT    NOT NULL,
     kind          TEXT    NOT NULL,         -- confirmation | notification
     inquiry_id    INTEGER,
     sent          INTEGER NOT NULL,
     reason        TEXT,                     -- unsubscribed | recent | off | error
     note          TEXT,
     resend_id     TEXT,
     delivered_at  INTEGER,
     delayed_at    INTEGER,
     bounced_at    INTEGER,
     complained_at INTEGER,
     opened_at     INTEGER,
     clicked_at    INTEGER
   )`,
  'CREATE INDEX IF NOT EXISTS idx_emails_day     ON emails(day, kind)',
  'CREATE INDEX IF NOT EXISTS idx_emails_resend  ON emails(resend_id)',
  'CREATE INDEX IF NOT EXISTS idx_emails_inquiry ON emails(inquiry_id, kind)',

  `CREATE TABLE IF NOT EXISTS lead_sync (
     inquiry_id INTEGER PRIMARY KEY,
     ok         INTEGER NOT NULL,
     note       TEXT,
     ts         INTEGER NOT NULL
   )`,
];
