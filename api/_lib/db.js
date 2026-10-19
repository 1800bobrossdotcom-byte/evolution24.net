/* =============================================================================
   The database: one SQLite database at Turso, reached over HTTPS.

   Charlotte Square keeps its enquiries and statistics in Cloudflare D1. On
   Vercel the nearest thing is a hosted SQLite database, so the same tables and
   the same SQL serve both sites. This file gives it D1's shape:

     const db = database();
     await db.prepare('SELECT … WHERE day = ?').bind(day).all()   → { results: [rows] }
     await db.prepare(…).bind(…).first()                          → row or null
     await db.prepare(…).bind(…).run()                            → { meta: { changes, last_row_id } }
     await db.batch([stmt, stmt])                                 → [{ results }, …], one round trip

   so the code that reads it can be Charlotte Square's, nearly line for line.
   No dependencies: it speaks libSQL's HTTP protocol (Hrana over HTTP,
   POST /v2/pipeline) with fetch.

   Environment variables (Vercel → Settings → Environment Variables; the Turso
   integration in Vercel's Marketplace sets the second pair itself):
     DB_URL     or TURSO_DATABASE_URL   libsql://<name>-<org>.turso.io
     DB_TOKEN   or TURSO_AUTH_TOKEN     a token for that database
   With neither set, database() returns null and every caller carries on
   without it: the enquiry still reaches the lead sheet and the inbox.
   ============================================================================= */
'use strict';

const SCHEMA = require('./schema.js');

const TIMEOUT_MS = 10000;

function dbUrl() {
  const raw = String(process.env.DB_URL || process.env.TURSO_DATABASE_URL || '').trim();
  if (!raw) return '';
  return raw.replace(/^libsql:\/\//i, 'https://').replace(/\/+$/, '');
}
const dbToken = () => String(process.env.DB_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();

const encode = (v) => {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { type: 'null' };
    return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  }
  return { type: 'text', value: String(v) };
};
const decode = (c) => {
  if (!c || c.type === 'null') return null;
  if (c.type === 'integer') { const n = Number(c.value); return Number.isSafeInteger(n) ? n : c.value; }
  if (c.type === 'float') return Number(c.value);
  if (c.type === 'blob') return Buffer.from(c.base64 || '', 'base64');
  return c.value;
};

class DbError extends Error {}

/** Run statements in order, in one request. Each result as D1 gives it. */
async function pipeline(stmts) {
  const url = dbUrl();
  const headers = { 'Content-Type': 'application/json' };
  if (dbToken()) headers.Authorization = `Bearer ${dbToken()}`;
  let res;
  try {
    res = await fetch(`${url}/v2/pipeline`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requests: [...stmts.map((s) => ({ type: 'execute', stmt: { sql: s.sql, args: s.args.map(encode) } })), { type: 'close' }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new DbError(`The database could not be reached (${String(err && err.message || err).slice(0, 120)}).`);
  }
  if (!res.ok) {
    throw new DbError(res.status === 401 || res.status === 403
      ? 'The database refused the token: check DB_TOKEN.'
      : `The database answered ${res.status}.`);
  }
  const out = await res.json();
  return (out.results || []).slice(0, stmts.length).map((r) => {
    if (!r || r.type !== 'ok') throw new DbError((r && r.error && r.error.message) || 'The database could not run that.');
    const x = r.response.result;
    const cols = x.cols.map((c) => c.name);
    return {
      results: x.rows.map((row) => Object.fromEntries(row.map((c, i) => [cols[i], decode(c)]))),
      meta: { changes: x.affected_row_count || 0, last_row_id: x.last_insert_rowid == null ? null : Number(x.last_insert_rowid) },
    };
  });
}

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async all() { return (await this.db.batch([this]))[0]; }
  async first() { const r = await this.all(); return r.results[0] || null; }
  async run() { return this.all(); }
}

/* The tables are made on first use, once per server instance: a new database
   needs no setup step, and a deploy that adds a table adds it by itself. */
let ready = null;

class Database {
  prepare(sql) { return new Statement(this, sql); }
  async batch(stmts) {
    await this.ready();
    return pipeline(stmts);
  }
  ready() {
    if (!ready) {
      ready = pipeline(SCHEMA.map((sql) => ({ sql, args: [] }))).catch((err) => { ready = null; throw err; });
    }
    return ready;
  }
}

/** The database, or null when none is configured. */
function database() {
  return dbUrl() ? new Database() : null;
}

/** For the tests: forget that the tables were made. */
function forget() { ready = null; }

module.exports = { database, DbError, forget };
