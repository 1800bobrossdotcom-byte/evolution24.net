# postgres.js 3.4.9

The Postgres driver db.js uses, copied here unchanged from the npm package
`postgres@3.4.9` (its `cjs/src/` folder), so the site has no package.json and
Vercel no install step. By Rasmus Porsager, <https://github.com/porsager/postgres>.
Licence: The Unlicense (public domain). Package integrity: `sha512-GD3qdB0x1z9xgFI6cdRD6xu2Sp2WCOEoe3mtnyB5Ee0XrrL5Pe+e4CCnJrRMnL1zYtRDZmQQVbvOttLnKDLnaw==`.

To update: `npm pack postgres@<version>`, unpack it, and copy `package/cjs/src/*.js`
over these files; then run `node scripts/test-analytics.cjs`.
