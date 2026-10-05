/**
 * Evolution24 Properties: the one way into Rent Manager for every Google script.
 *
 * Signs in to Rent Manager's Web API, keeps the token between runs, follows long
 * lists page by page, keeps within the company's hourly request limit, and tries
 * again when Rent Manager is briefly unavailable. Every Rent Manager script goes
 * through these functions, so this is the only code that ever handles the
 * password, and nothing here returns it or writes it to a log.
 *
 * It only reads. It sends GET requests, and a POST only to sign in, so even a
 * mistake in a script built on it cannot change anything in Rent Manager. The
 * Rent Manager user it signs in as should be read-only as well.
 *
 * SETTINGS: in the Apps Script editor, Project Settings (the gear) → Script
 * properties → Add script property, typed in by hand:
 *   RM_COMPANY   the company code: the "evolution" in evolution.api.rentmanager.com
 *   RM_USERNAME  the read-only Rent Manager user made for these scripts
 *   RM_PASSWORD  its password
 *   RM_LOCATION  optional: the Rent Manager location to sign in to (1 if not set)
 * It keeps RM_TOKEN there itself. Never put any of these in a sheet, a doc, an
 * email or the code. Keep this project shared with no one: anyone who can open
 * it can read Rent Manager through it.
 *
 * Rent Manager's rules this follows (its Web API overview):
 *   sign-in   POST /Authentication/AuthorizeUser {Username, Password, LocationID}
 *             answers with a token, sent as X-RM12Api-ApiToken. A changed
 *             password or permission cancels it, and tokens time out: on a 401
 *             this signs in again, once.
 *   lists     up to 1,000 records a page (pagenumber, pagesize); X-Total-Results
 *             gives the total. A 404 on a list means nothing matched; a 403
 *             means the user may not see that resource at all.
 *   limits    counted per company per hour; every reply carries X-RateLimit,
 *             X-RateRemaining and X-RateTimeLeft (seconds); past it, a 429.
 */

const RM_PAGE = 1000;        // Rent Manager's largest page
const RM_MAX_PAGES = 100;    // a list longer than 100,000 records is a mistake, not data
const RM_MAX_WAIT_S = 90;    // the longest a run waits for the hourly limit to reset
const RM_TRIES = 3;          // attempts when Rent Manager is briefly unavailable

const RM_STATE_ = { settings: null, token: null, requests: 0, limit: null, remaining: null, resetAt: null };

/**
 * Every record of a resource, all pages. Throws if the user may not see it;
 * an empty list when nothing matched.
 *   rmList('Units')
 *   rmList('Units', {filters: ['PropertyID,eq,8'], embeds: ['UnitType']})
 * Options: fields, embeds, filters (lists or comma/semicolon strings), orderBy,
 * and strict: true to throw on a 404 too, for a resource that should never be empty.
 */
function rmList(resource, options) {
  const opts = options || {};
  const records = [];
  let total = null;
  for (let page = 1; page <= RM_MAX_PAGES; page++) {
    const res = rmGet(resource, Object.assign({}, opts, { page: page, pageSize: RM_PAGE }));
    if (res.status === 404 && !opts.strict) return records;
    if (res.status !== 200 && res.status !== 206) throw rmError_(res.status, `${resource}: ${res.message}`);
    const batch = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
    batch.forEach((r) => records.push(r));
    if (res.total !== null) total = res.total;
    const done = total !== null ? records.length >= total : batch.length < RM_PAGE;
    if (done || !batch.length) return records;
  }
  throw rmError_(0, `${resource}: more than ${RM_MAX_PAGES} pages; narrow it with a filter.`);
}

/**
 * One GET. Never throws for what Rent Manager answers; the caller reads status.
 *   {status, data, total, message}
 * status 200 or 206 holds data; total is X-Total-Results when Rent Manager sends
 * it; message explains anything else in Rent Manager's own words.
 * Options as rmList, plus page and pageSize to ask for one page.
 */
function rmGet(path, options) {
  const res = rmFetch_('get', rmUrl_(path, rmQuery_(options || {})), null);
  let data = null;
  try { data = res.text ? JSON.parse(res.text) : null; } catch (e) { data = null; }
  const ok = res.status === 200 || res.status === 206;
  const total = res.headers['x-total-results'] !== undefined ? Number(res.headers['x-total-results']) : null;
  return {
    status: res.status,
    data: ok ? data : null,
    total: Number.isFinite(total) ? total : null,
    message: ok ? '' : rmMessage_(res.status, data, res.text),
  };
}

/** What this run has used, for a sync log: requests sent, and the hourly limit as last seen. */
function rmUsage() {
  return {
    requests: RM_STATE_.requests,
    limit: RM_STATE_.limit,
    remaining: RM_STATE_.remaining,
    resetSeconds: RM_STATE_.resetAt === null ? null : Math.max(0, Math.round((RM_STATE_.resetAt - Date.now()) / 1000)),
  };
}

/* ---- inside: settings, sign-in, requests ---------------------------------- */

function rmSettings_() {
  if (RM_STATE_.settings) return RM_STATE_.settings;
  const props = PropertiesService.getScriptProperties();
  const s = {
    company: String(props.getProperty('RM_COMPANY') || '').trim().toLowerCase(),
    username: props.getProperty('RM_USERNAME') || '',
    password: props.getProperty('RM_PASSWORD') || '',
    location: Number(props.getProperty('RM_LOCATION') || 1) || 1,
  };
  const missing = [['RM_COMPANY', s.company], ['RM_USERNAME', s.username], ['RM_PASSWORD', s.password]]
    .filter((p) => !p[1]).map((p) => p[0]);
  if (missing.length) {
    throw rmError_(0, `Add ${missing.join(', ')} in Project Settings → Script properties first. The comment at the top of RentManager.gs says what each one is.`);
  }
  if (!/^[a-z0-9-]+$/.test(s.company)) throw rmError_(0, 'RM_COMPANY should be just the company code, such as evolution.');
  return (RM_STATE_.settings = s);
}

function rmBase_() {
  return `https://${rmSettings_().company}.api.rentmanager.com`;
}

/** A path inside this company's API, never an outside address: the token goes nowhere else. */
function rmUrl_(path, query) {
  const clean = String(path || '').replace(/^\/+/, '');
  if (!/^[A-Za-z0-9/_-]+$/.test(clean)) throw rmError_(0, `Not a Rent Manager resource: ${String(path).slice(0, 80)}`);
  return `${rmBase_()}/${clean}${query ? `?${query}` : ''}`;
}

function rmQuery_(opts) {
  const list = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
  const parts = [];
  const add = (key, value) => { if (value !== '' && value !== null && value !== undefined) parts.push(`${key}=${encodeURIComponent(value)}`); };
  add('fields', list(opts.fields).join(','));
  add('embeds', list(opts.embeds).join(','));
  add('filters', list(opts.filters).join(';'));
  add('orderby', opts.orderBy);
  if (opts.page) { add('pagenumber', opts.page); add('pagesize', opts.pageSize || RM_PAGE); }
  return parts.join('&');
}

/** The token: the one kept from an earlier run, or a new one. */
function rmToken_(fresh) {
  const props = PropertiesService.getScriptProperties();
  if (!fresh) {
    if (RM_STATE_.token) return RM_STATE_.token;
    const kept = props.getProperty('RM_TOKEN');
    if (kept) return (RM_STATE_.token = kept);
  }
  const s = rmSettings_();
  const res = rmSend_('post', `${rmBase_()}/Authentication/AuthorizeUser`, null,
    JSON.stringify({ Username: s.username, Password: s.password, LocationID: s.location }));
  let token = '';
  try { token = String(JSON.parse(res.text) || ''); } catch (e) { token = String(res.text || ''); }
  token = token.replace(/^"+|"+$/g, '').trim();
  if (res.status !== 200 || !/^[^\s"'<>]{8,}$/.test(token)) {
    props.deleteProperty('RM_TOKEN');
    RM_STATE_.token = null;
    let data = null;
    try { data = JSON.parse(res.text); } catch (e) { data = null; }
    throw rmError_(res.status, `Rent Manager refused the sign-in (${res.status}): ${rmMessage_(res.status, data, res.text)} Check RM_COMPANY, RM_USERNAME, RM_PASSWORD and RM_LOCATION.`);
  }
  props.setProperty('RM_TOKEN', token);
  RM_STATE_.token = token;
  return token;
}

/** A request with the token, signing in again once if Rent Manager no longer takes it. */
function rmFetch_(method, url, payload) {
  let token = rmToken_(false);
  let res = rmSend_(method, url, token, payload);
  if (res.status === 401) {
    token = rmToken_(true);
    res = rmSend_(method, url, token, payload);
  }
  return res;
}

/** One request, within the hourly limit, tried again when Rent Manager is briefly down. */
function rmSend_(method, url, token, payload) {
  for (let attempt = 1; ; attempt++) {
    rmPace_();
    const params = { method: method, muteHttpExceptions: true, followRedirects: false, headers: { Accept: 'application/json' } };
    if (token) params.headers['X-RM12Api-ApiToken'] = token;
    if (payload !== null && payload !== undefined) { params.contentType = 'application/json'; params.payload = payload; }
    let res;
    try {
      res = UrlFetchApp.fetch(url, params);
    } catch (e) {
      if (attempt < RM_TRIES) { Utilities.sleep(2000 * attempt); continue; }
      throw rmError_(0, `Could not reach Rent Manager: ${rmScrub_(String(e && e.message || e)).slice(0, 200)}`);
    }
    RM_STATE_.requests++;
    const headers = {};
    const all = res.getAllHeaders() || {};
    Object.keys(all).forEach((k) => { headers[k.toLowerCase()] = Array.isArray(all[k]) ? all[k].join(', ') : String(all[k]); });
    rmNoteLimit_(headers);
    const status = res.getResponseCode();
    if (status === 429 && attempt < RM_TRIES) {
      const wait = Number(headers['x-ratetimeleft']);
      if (Number.isFinite(wait) && wait <= RM_MAX_WAIT_S) { Utilities.sleep((wait + 1) * 1000); continue; }
      throw rmError_(429, `Rent Manager's hourly request limit is used up; it resets in about ${rmMinutes_(wait)}. The next run carries on.`);
    }
    if ((status >= 500 || status === 0) && attempt < RM_TRIES) { Utilities.sleep(2000 * attempt); continue; }
    return { status: status, text: res.getContentText(), headers: headers };
  }
}

function rmNoteLimit_(h) {
  const n = (k) => (h[k] === undefined || h[k] === '' ? null : Number(h[k]));
  if (Number.isFinite(n('x-ratelimit'))) RM_STATE_.limit = n('x-ratelimit');
  if (Number.isFinite(n('x-rateremaining'))) RM_STATE_.remaining = n('x-rateremaining');
  if (Number.isFinite(n('x-ratetimeleft'))) RM_STATE_.resetAt = Date.now() + n('x-ratetimeleft') * 1000;
}

/** Before a request: if the hour's requests are gone, wait a little for the reset, or stop. */
function rmPace_() {
  if (RM_STATE_.remaining === null || RM_STATE_.remaining > 0) return;
  const left = RM_STATE_.resetAt === null ? null : Math.ceil((RM_STATE_.resetAt - Date.now()) / 1000);
  if (left !== null && left <= RM_MAX_WAIT_S) {
    if (left > 0) Utilities.sleep((left + 1) * 1000);
    RM_STATE_.remaining = null;
    return;
  }
  throw rmError_(429, `Rent Manager's hourly request limit is used up; it resets in about ${rmMinutes_(left)}. The next run carries on.`);
}

function rmMinutes_(seconds) {
  if (!Number.isFinite(seconds)) return 'an hour';
  const m = Math.max(1, Math.round(seconds / 60));
  return m === 1 ? 'a minute' : `${m} minutes`;
}

/** Rent Manager's own explanation of a failed request, without anything secret. */
function rmMessage_(status, data, text) {
  const said = data && typeof data === 'object'
    ? (data.UserMessage || data.DeveloperMessage || data.Message || data.message || '') : '';
  const meaning = {
    400: 'The request was not understood (a field, filter or embed it does not know?).',
    401: 'Not signed in.',
    403: 'This user may not see it.',
    404: 'Nothing found.',
    405: 'Not available this way.',
    410: 'Rent Manager has retired it.',
    429: 'The hourly request limit is used up.',
  }[status] || (status >= 500 ? 'Rent Manager had a problem; try again later.' : `Rent Manager answered ${status}.`);
  const words = rmScrub_(String(said || '')).replace(/\s+/g, ' ').trim().slice(0, 300);
  return words ? `${meaning} Rent Manager said: ${words}` : meaning;
}

/** Takes the password and token out of any text that is about to be shown or logged. */
function rmScrub_(text) {
  let out = String(text);
  const secrets = [RM_STATE_.token];
  try {
    const props = PropertiesService.getScriptProperties();
    secrets.push(props.getProperty('RM_PASSWORD'), props.getProperty('RM_TOKEN'));
  } catch (e) { /* no settings yet */ }
  secrets.filter((s) => s && String(s).length >= 4).forEach((s) => { out = out.split(String(s)).join('•••'); });
  return out;
}

function rmError_(status, message) {
  const err = new Error(rmScrub_(message));
  err.name = 'RentManagerError';
  err.status = status;
  return err;
}
