/* =============================================================================
   The database: Postgres at Supabase, through its connection pooler.

   Charlotte Square keeps its enquiries and statistics in Cloudflare D1, and the
   code that reads them came from there, so this file gives Postgres D1's shape:

     const db = database();
     await db.prepare('SELECT … WHERE day = ?').bind(day).all()   → { results: [rows] }
     await db.prepare(…).bind(…).first()                          → row or null
     await db.prepare(…).bind(…).run()                            → { meta: { changes } }
     await db.batch([stmt, stmt])                                 → [{ results }, …], in one transaction

   Placeholders are written ?, as in D1, and numbered here ($1, $2, …). The
   driver is postgres.js, kept in ./postgres/ (see its README) so the site has
   no install step.

   Environment variables (Vercel → Settings → Environment Variables):
     DATABASE_URL   Supabase → the project → Connect → Transaction pooler: the
                    postgres://…pooler.supabase.com:6543/postgres address, with
                    the database password in it. POSTGRES_URL, which Vercel's
                    Supabase integration sets, works the same.
     DB_CA_CERT     optional: Supabase's CA certificate (Database Settings → SSL
                    Configuration → Download certificate), pasted whole. With it
                    the server's certificate is checked as well; without it the
                    connection is encrypted, as Supabase's sslmode=require is.
   With neither address set, database() returns null and every caller carries on
   without it: the enquiry still reaches the lead sheet and the inbox.
   ============================================================================= */
'use strict';

const postgres = require('./postgres/index.js');
const SCHEMA = require('./schema.js');

const dbUrl = () => String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();

class DbError extends Error {}

/* How to connect, from the address. Only its parts are used: anything after
   the ? (Vercel's integration adds supa=…) would otherwise go to the server as
   a setting. One connection per server instance; Supabase's transaction pooler
   shares its connections between requests, so it keeps no prepared statements. */
function options(address = dbUrl()) {
  const u = new URL(address);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  const ca = String(process.env.DB_CA_CERT || '').trim().replace(/\\n/g, '\n');
  return {
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: Number(u.port || 5432),
    database: decodeURIComponent(u.pathname.slice(1)) || 'postgres',
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: local ? false : ca ? { ca, rejectUnauthorized: true, servername: u.hostname } : 'require',
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    // Counts and sums arrive as int8 and numeric, which the driver leaves as
    // strings; every number here is far inside what a JavaScript number holds.
    types: { count: { to: 20, from: [20, 1700], serialize: String, parse: Number } },
    onnotice: () => {},                  // "already exists, skipping", from the schema
  };
}

let sql = null;
function client() {
  if (!sql) sql = postgres(options());
  return sql;
}

/* ? → $1, $2 …, leaving any ? inside quotes alone. */
const numbered = new Map();
function toPostgres(text) {
  let out = numbered.get(text);
  if (out) return out;
  let n = 0;
  let quote = null;
  out = '';
  for (const ch of text) {
    if (quote) { if (ch === quote) quote = null; out += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    out += ch === '?' ? `$${++n}` : ch;
  }
  numbered.set(text, out);
  return out;
}

// D1 stores true as 1; so do these tables (INTEGER, not BOOLEAN).
const value = (v) => (v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? null
  : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'bigint' ? v.toString() : v);

function explain(err) {
  const code = err && err.code;
  const m = String(err && err.message || err).slice(0, 160);
  if (code === '28P01' || code === '28000') return 'The database refused the password: check DATABASE_URL.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|CONNECT_TIMEOUT|ECONNRESET/.test(`${code} ${m}`)) return `The database could not be reached (${m}).`;
  return m;
}

const run = (s, stmt) => s.unsafe(toPostgres(stmt.sql), stmt.args.map(value))
  .then((rows) => ({ results: [...rows], meta: { changes: rows.count || 0 } }));

class Statement {
  constructor(db, text, args = []) { this.db = db; this.sql = text; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async all() { return (await this.db.batch([this]))[0]; }
  async first() { const r = await this.all(); return r.results[0] || null; }
  async run() { return this.all(); }
}

/* The tables are made on first use, once per server instance: a new database
   needs no setup step, and a deploy that adds a table adds it by itself. The
   lock keeps two instances starting at once from making the same table twice. */
let ready = null;

class Database {
  prepare(text) { return new Statement(this, text); }
  async batch(stmts) {
    await this.ready();
    try {
      if (stmts.length === 1) return [await run(client(), stmts[0])];
      return await client().begin(async (tx) => {
        const out = [];
        for (const stmt of stmts) out.push(await run(tx, stmt));
        return out;
      });
    } catch (err) {
      throw new DbError(explain(err));
    }
  }
  ready() {
    if (!ready) {
      // Inside the promise, so an address that is not one fails like any other connection.
      ready = Promise.resolve().then(() => client().begin(async (tx) => {
        await tx.unsafe('SELECT pg_advisory_xact_lock(2424)');
        for (const statement of SCHEMA) await tx.unsafe(statement);
      })).catch((err) => { ready = null; throw new DbError(explain(err)); });
    }
    return ready;
  }
}

/** The database, or null when none is configured. */
function database() {
  return dbUrl() ? new Database() : null;
}

/** For the tests: forget that the tables were made, and let go of the connection. */
async function forget() {
  ready = null;
  if (sql) { const s = sql; sql = null; await s.end({ timeout: 1 }); }
}

module.exports = { database, DbError, forget, toPostgres, options };
