/* =============================================================================
   Vercel's Node functions hand over (req, res); Charlotte Square's handlers
   take a web Request and return a web Response. serve() joins the two, so the
   ported handlers keep their shape:

     module.exports = serve({ GET: async ({ request, env }) => json({ … }) });

   env is process.env with the database attached as env.DB, as on Cloudflare,
   so env.DB.prepare(…) reads the same in both. A method with no handler gets
   405; an exception gets a plain 500, never its message.
   ============================================================================= */
'use strict';

const { database } = require('./db.js');

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

const html = (body, status = 200, headers = {}) => new Response(body, {
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

/* The body exactly as sent (a webhook's signature is over these bytes). Read
   from the stream; Vercel parses req.body only when it is touched, so it is
   touched only if something read the stream first. */
async function rawBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.readableEnded) {
    const b = req.body;
    if (Buffer.isBuffer(b)) return b;
    if (typeof b === 'string') return Buffer.from(b);
    if (b && typeof b === 'object') return Buffer.from(JSON.stringify(b));
    return undefined;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function toRequest(req, body) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const url = `${proto}://${req.headers.host || 'localhost'}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }
  return new Request(url, { method: req.method, headers, body: body && body.length ? body : undefined });
}

function serve(handlers) {
  return async function handler(req, res) {
    const fn = handlers[req.method];
    if (!fn) {
      res.statusCode = 405;
      res.setHeader('Allow', Object.keys(handlers).join(', '));
      res.end();
      return;
    }
    let response;
    try {
      const request = toRequest(req, await rawBody(req));
      response = await fn({ request, env: { ...process.env, DB: database() } });
    } catch (err) {
      console.error(req.url, err);
      response = json({ error: 'Something went wrong.' }, 500);
    }
    res.statusCode = response.status;
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
    const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

/** The visitor's address, as Vercel passes it on. */
const clientIp = (request) => String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  || request.headers.get('x-real-ip') || '0.0.0.0';

/** Two letters, from Vercel's own lookup; null where it gives none. */
const country = (request) => {
  const c = String(request.headers.get('x-vercel-ip-country') || '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
};

module.exports = { serve, json, html, clientIp, country };
