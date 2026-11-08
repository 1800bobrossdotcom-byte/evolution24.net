/* GET /api/form-token/ — the token an enquiry form sends with its post: when the
   page loaded, signed (api/_lib/spam.js). Never cached: each page gets its own. */
'use strict';

const { serve, json } = require('./_lib/web.js');
const { issueToken } = require('./_lib/spam.js');

module.exports = serve({
  GET: async ({ env }) => json({ token: await issueToken(env.SESSION_SECRET || '') }, 200,
    { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }),
});
