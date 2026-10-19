/* POST /api/logout/ — clear the session cookie. */
'use strict';

const { serve, json } = require('./_lib/web.js');
const { sessionCookie } = require('./_lib/auth.js');

module.exports = serve({ POST: async () => json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) }) });
