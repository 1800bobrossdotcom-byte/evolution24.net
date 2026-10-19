/* =============================================================================
   Evolution24 Properties — analytics dashboard.

   /admin/ is a static shell. The page asks /api/stats/ for the numbers; with
   no session that answers 401 and the sign-in form is shown instead, which
   posts to /api/login/ (the server sets an HttpOnly cookie) and then loads the
   dashboard. Every admin endpoint is gated on the server, so nothing here is
   the lock: the shell holds no data until a signed-in request returns some.

   No charting library: two chart shapes drawn as SVG, which keeps the page
   inside script-src 'self' with nothing to pin or update. No inline styles
   either (style-src 'self'): sizes set from script go through the CSSOM.

   Traffic and enquiries are two separate charts rather than one chart with two
   y-axes. Pageviews run in the hundreds and enquiries in single digits, and any
   shared scale would either flatten the enquiries to nothing or exaggerate them
   into a lie. They share an x-range instead.

   Everything a visitor typed reaches the page through textContent, never
   innerHTML.
   ============================================================================= */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };
  const num = (n) => Number(n || 0).toLocaleString('en-US');

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const isoDay = (d) => d.toISOString().slice(0, 10);
  const utcDay = (day) => new Date(`${day}T00:00:00Z`);
  const plusDays = (day, n) => isoDay(new Date(utcDay(day).getTime() + n * 86400000));
  const md = (day) => `${MON[utcDay(day).getUTCMonth()]} ${utcDay(day).getUTCDate()}`;
  /** "19 Oct" */
  const shortDay = (d) => {
    const [, m, day] = String(d).split('-');
    return `${Number(day)} ${MON[Number(m) - 1]}`;
  };
  /** "19 October", with the year only when it is not this one. */
  const longDay = (d) => {
    const [y, m, day] = String(d).split('-');
    const year = Number(y) !== new Date().getUTCFullYear() ? ` ${y}` : '';
    return `${Number(day)} ${MONTHS[Number(m) - 1]}${year}`;
  };

  /** A rate from counts, or a dash when it would mislead: no visitors, or more
   *  enquiries than visitors (people who block analytics still send forms). */
  const pct = (part, whole) => (!whole || part > whole ? '—' : `${Math.round((part / whole) * 1000) / 10}%`);

  // Tracking links always point at the real site, whichever address the
  // dashboard happens to be open on.
  const SITE = 'https://evolution24.net';

  /* ---- Shell: sign in, sign out, and every request -------------------------- */
  const bootEl = $('#boot');
  const signinEl = $('#signin');
  const appEl = $('#app');
  const signinForm = $('#signin-form');
  const signinMsg = $('#signin-msg');
  const statusEl = $('#status');
  const tilesEl = $('#tiles');
  const availEl = $('#avail');
  const panelsEl = $('#panels');

  let signedIn = false;
  let current = null;
  let days = 30;

  function setSigninMsg(text, bad = false) {
    signinMsg.textContent = text;
    signinMsg.className = 'signin__msg' + (bad ? ' is-bad' : '');
  }

  function showApp() {
    signedIn = true;
    bootEl.hidden = true;
    signinEl.hidden = true;
    appEl.hidden = false;
    document.title = 'Analytics · Evolution24 Properties';
  }

  /** Any 401: the session is missing or has run out. Show the form, and drop
   *  the people's details already on the page rather than leave them hidden. */
  function signedOut(note) {
    const wasIn = signedIn;
    signedIn = false;
    current = null;
    bootEl.hidden = true;
    appEl.hidden = true;
    signinEl.hidden = false;
    document.title = 'Sign in · Evolution24 Properties';
    $('#leads').replaceChildren();
    $('#lead-warn').hidden = true;
    $('#report-list').replaceChildren();
    if (note !== undefined) setSigninMsg(note);
    else if (wasIn) setSigninMsg('Your session has ended. Sign in again to carry on.');
    signinForm.elements.password.focus();
  }

  /** One request to the admin API. Resolves to {res, data}, or to null when
   *  the answer was 401 (the sign-in form is then already showing). Paths end
   *  in a slash: the site runs with trailingSlash, and a path without one is
   *  redirected, which a POST does not survive. */
  async function api(url, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) { signedOut(); return null; }
    const data = await res.json().catch(() => ({}));
    return { res, data: data || {} };
  }

  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = signinForm.querySelector('button[type="submit"]');
    const input = signinForm.elements.password;
    btn.disabled = true;
    setSigninMsg('');
    try {
      const res = await fetch('/api/login/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password: input.value }),
      });
      if (res.ok) {
        input.value = '';
        signinEl.hidden = true;
        bootEl.hidden = false;
        start();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setSigninMsg((data && data.error) || (res.status === 429
        ? 'Too many attempts. Try again in a few minutes.' : 'Sign-in failed.'), true);
      input.select();
    } catch {
      setSigninMsg('Could not reach the server. Check your connection.', true);
    } finally {
      btn.disabled = false;
    }
  });

  $('#signout').addEventListener('click', async () => {
    await fetch('/api/logout/', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    signedOut('Signed out.');
  });

  /* ---- Buildings, from whichever answer names them first --------------------- */
  const buildings = new Map();   // slug -> {name, city}
  const SLUG = /^[a-z0-9][a-z0-9-]*$/;

  function learnBuildings(list) {
    let changed = false;
    for (const b of list) {
      if (!b || !b.slug || !SLUG.test(b.slug)) continue;
      const had = buildings.get(b.slug);
      const next = { name: b.name || (had && had.name) || b.slug, city: b.city || (had && had.city) || '' };
      if (!had || had.name !== next.name || had.city !== next.city) { buildings.set(b.slug, next); changed = true; }
    }
    if (changed) { fillBuilderPages(); fillBuildingFilter(); }
  }
  const buildingName = (slug) => (slug && buildings.has(slug) ? buildings.get(slug).name : slug || 'General');
  /** The buildings by name, for the pickers: "121 Park Drive" before "Water Street". */
  const byName = () => [...buildings].sort((a, b) => a[1].name.localeCompare(b[1].name, 'en', { numeric: true }));

  /* ---- Load ------------------------------------------------------------------ */
  let loadSeq = 0;

  /** The numbers for the range on screen. Resolves false when signed out. */
  async function load() {
    const seq = ++loadSeq;
    const range = days;
    if (current) {
      // Hold the last render, dimmed, rather than blanking the page.
      tilesEl.classList.add('is-stale');
      panelsEl.classList.add('is-stale');
    } else {
      statusEl.hidden = false;
      statusEl.textContent = 'Loading…';
    }
    try {
      const r = await api(`/api/stats/?days=${range}`);
      if (!r) return false;
      if (seq !== loadSeq) return true;
      showApp();
      if (!r.res.ok) throw new Error(r.data.error || `Server returned ${r.res.status}`);
      current = r.data;
      statusEl.hidden = true;
      tilesEl.hidden = false;
      panelsEl.hidden = false;
      render();
      loadInsight();
      return true;
    } catch (err) {
      if (seq !== loadSeq) return true;
      showApp();
      statusEl.hidden = false;
      statusEl.textContent = `Could not load the numbers — ${err.message}. Reload to try again.`;
      // The enquiries come from their own request and may well be fine.
      panelsEl.hidden = false;
      return true;
    } finally {
      if (seq === loadSeq) {
        tilesEl.classList.remove('is-stale');
        panelsEl.classList.remove('is-stale');
      }
    }
  }

  /* ---- Tiles --------------------------------------------------------------- */
  function renderTiles(t) {
    const tiles = [
      { k: 'Pageviews', v: num(t.pageviews) },
      { k: 'Visitors', v: num(t.visits), n: 'counted once per day' },
      { k: 'Enquiries', v: num(t.leads), cls: 'tile--lead' },
      { k: 'Enquiry rate', v: `${Number(t.lead_rate || 0)}%`, n: 'per 100 pageviews' },
      { k: 'Phone taps', v: num(t.phone_clicks) },
      { k: 'Apply clicks', v: num(t.apply_clicks), n: 'opened an application' },
      { k: 'Resident portal', v: num(t.portal_clicks), n: 'visits from the site' },
    ];
    tilesEl.replaceChildren(...tiles.map((d) => {
      const div = make('div', 'tile' + (d.cls ? ' ' + d.cls : ''));
      div.append(make('div', 'tile__k', d.k), make('div', 'tile__v', d.v));
      if (d.n) div.append(make('div', 'tile__n', d.n));
      return div;
    }));
  }

  /* When Rent Manager last updated the website's list of open homes. Days
     without an update usually mean the sync has stopped, and the site is
     then showing homes that may have gone. */
  function renderAvail(a) {
    if (!a || !/^\d{4}-\d{2}-\d{2}$/.test(String(a.as_of || ''))) { availEl.hidden = true; return; }
    const open = Number(a.open || 0);
    const age = Math.floor((Date.parse(`${isoDay(new Date())}T00:00:00Z`) - Date.parse(`${a.as_of}T00:00:00Z`)) / 86400000);
    let text = `Availability from Rent Manager: ${num(open)} home${open === 1 ? '' : 's'} open, as of ${longDay(a.as_of)}.`;
    if (age >= 3) text += ` That is ${age} days ago: the list on the website may be out of date.`;
    availEl.textContent = text;
    availEl.classList.toggle('is-old', age >= 3);
    availEl.hidden = false;
  }

  /* ---- Shared chart frame -------------------------------------------------- */
  const PAD = { l: 42, r: 46, t: 14, b: 24 };

  function frame(host, height, label) {
    const width = Math.max(host.clientWidth || 640, 260);
    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label });
    return { svg, width, height, iw: width - PAD.l - PAD.r, ih: height - PAD.t - PAD.b };
  }

  /** A clean top for the y-axis: `ticks` whole-number steps of 1, 2, 5… */
  function niceTop(max, ticks) {
    const raw = Math.max(max, 1) / ticks;
    const mag = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
      const step = Math.ceil(m * mag);
      if (step >= raw) return step * ticks;
    }
    return Math.ceil(raw) * ticks;
  }
  const axisNum = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 || v % 1000 === 0 ? 0 : 1)}k` : String(v));

  // Grid lines and y labels. Recessive on purpose — the marks are the subject.
  function yAxis(f, top, ticks) {
    for (let i = 0; i <= ticks; i++) {
      const v = (top / ticks) * i;
      const y = PAD.t + f.ih - (v / top) * f.ih;
      f.svg.append(svgEl('line', { class: i ? 'grid-line' : 'base-line', x1: PAD.l, x2: PAD.l + f.iw, y1: y, y2: y }));
      const label = svgEl('text', { class: 'axis-text', x: PAD.l - 8, y: y + 3, 'text-anchor': 'end' });
      label.textContent = axisNum(v);
      f.svg.append(label);
    }
  }

  /** Dates along the bottom: as many as fit, always the last one. */
  function xLabels(f, rows, xAt) {
    const n = rows.length;
    if (!n) return;
    const fit = Math.max(2, Math.floor(f.iw / 64));
    const step = Math.max(1, Math.ceil(n / fit));
    const at = [];
    for (let i = 0; i < n; i += step) at.push(i);
    if (at[at.length - 1] !== n - 1) {
      if (n - 1 - at[at.length - 1] < step * 0.7) at[at.length - 1] = n - 1;
      else at.push(n - 1);
    }
    if (n === 1) at.splice(0, at.length, 0);
    for (const i of at) {
      const t = svgEl('text', { class: 'axis-text', x: xAt(i), y: f.height - 6, 'text-anchor': 'middle' });
      t.textContent = shortDay(rows[i].day);
      f.svg.append(t);
    }
  }

  /* ---- Tooltip ------------------------------------------------------------- */
  function tooltip(host) {
    const tip = make('div', 'tip');
    tip.hidden = true;
    tip.setAttribute('aria-hidden', 'true');
    host.append(tip);
    return {
      show(x, y, title, rows) {
        tip.replaceChildren(make('div', 'day', title));
        for (const r of rows) {
          const line = make('div', 'row');
          if (r.sw) line.append(make('i', r.sw));
          line.append(make('b', null, num(r.value)), document.createTextNode(' ' + r.label));
          tip.append(line);
        }
        tip.hidden = false;
        // Kept inside the chart, so it can never push the page sideways.
        const w = tip.offsetWidth;
        const left = Math.max(0, Math.min(host.clientWidth - w, x - w / 2));
        tip.style.left = `${left}px`;
        tip.style.top = `${y}px`;
      },
      hide() { tip.hidden = true; },
    };
  }

  const spanTitle = (r) => (r.end && r.end !== r.day ? `${shortDay(r.day)} – ${shortDay(r.end)}` : shortDay(r.day));

  /** Pointer and keyboard both move one readout along the x positions. */
  function bindNav(f, hit, n, indexAt, show, hide) {
    let idx = n - 1;
    const atPointer = (evt) => {
      const box = f.svg.getBoundingClientRect();
      const rel = ((evt.clientX - box.left) / box.width) * f.width;
      idx = Math.max(0, Math.min(n - 1, indexAt(rel)));
      show(idx);
    };
    hit.addEventListener('pointermove', atPointer);
    hit.addEventListener('pointerdown', atPointer);
    hit.addEventListener('pointerleave', () => { if (document.activeElement !== f.svg) hide(); });
    f.svg.setAttribute('tabindex', '0');
    f.svg.addEventListener('focus', () => show(idx));
    f.svg.addEventListener('blur', hide);
    f.svg.addEventListener('keydown', (e) => {
      const to = { ArrowLeft: idx - 1, ArrowRight: idx + 1, Home: 0, End: n - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      idx = Math.max(0, Math.min(n - 1, to));
      show(idx);
    });
  }

  /* Over a year, a point per day is a smear; a point per week (Monday to
     Sunday, like the reports) is a shape. Visitors are counted per day, so a
     week's visitors are the sum of its days, the same way the totals add up. */
  function bucket(rows) {
    if (rows.length <= 120) return { rows, weekly: false };
    const out = [];
    let cur = null;
    for (const r of rows) {
      if (!cur || (utcDay(r.day).getUTCDay() + 6) % 7 === 0) {
        cur = { day: r.day, end: r.day, pageviews: 0, visits: 0, leads: 0 };
        out.push(cur);
      }
      cur.end = r.day;
      cur.pageviews += r.pageviews || 0;
      cur.visits += r.visits || 0;
      cur.leads += r.leads || 0;
    }
    return { rows: out, weekly: true };
  }

  const emptyNote = (host, text) => { host.replaceChildren(make('p', 'empty', text)); };

  /* ---- Traffic: two lines on one scale ------------------------------------- */
  function renderTraffic({ rows, weekly }) {
    const host = $('#chart-traffic');
    host.replaceChildren();
    $('#traffic-note').textContent = weekly
      ? ' Over this range each point is a week, Monday to Sunday, and its visitors are the sum of its days.' : '';
    if (!rows.length) { emptyNote(host, 'Nothing recorded yet.'); return; }

    const f = frame(host, 220, `Pageviews and visitors per ${weekly ? 'week' : 'day'}`);
    const top = niceTop(Math.max(...rows.map((r) => Math.max(r.pageviews || 0, r.visits || 0))), 4);
    yAxis(f, top, 4);
    const xAt = (i) => PAD.l + (rows.length === 1 ? f.iw / 2 : (i / (rows.length - 1)) * f.iw);
    const yAt = (v) => PAD.t + f.ih - (v / top) * f.ih;
    xLabels(f, rows, xAt);

    const series = [
      { key: 'pageviews', colour: 'var(--s1)', sw: 'sw1', label: 'pageviews' },
      { key: 'visits', colour: 'var(--s2)', sw: 'sw2', label: 'visitors' },
    ];
    const last = rows.length - 1;
    const labelYs = [];
    for (const s of series) {
      const d = rows.map((r, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(r[s.key] || 0).toFixed(1)}`).join(' ');
      f.svg.append(svgEl('path', { class: 'series-line', d, stroke: s.colour }));
      const y = yAt(rows[last][s.key] || 0);
      f.svg.append(svgEl('circle', { class: 'series-dot', cx: xAt(last), cy: y, r: 4, fill: s.colour }));
      // A direct label on the final point, unless it would sit on the other
      // one: then the legend and the readout carry it.
      if (labelYs.every((o) => Math.abs(o - y) >= 12)) {
        const t = svgEl('text', { class: 'end-label', x: xAt(last) + 9, y: y + 4 });
        t.textContent = num(rows[last][s.key]);
        f.svg.append(t);
        labelYs.push(y);
      }
    }

    const cross = svgEl('line', { class: 'crosshair', y1: PAD.t, y2: PAD.t + f.ih, x1: 0, x2: 0, opacity: 0 });
    f.svg.append(cross);
    const hit = svgEl('rect', { class: 'hit', x: PAD.l - 6, y: PAD.t, width: f.iw + 12, height: f.ih });
    f.svg.append(hit);
    host.append(f.svg);
    const tip = tooltip(host);

    bindNav(f, hit, rows.length,
      (rel) => Math.round(((rel - PAD.l) / f.iw) * (rows.length - 1)),
      (i) => {
        const box = f.svg.getBoundingClientRect();
        const k = box.width / f.width;
        cross.setAttribute('x1', xAt(i)); cross.setAttribute('x2', xAt(i)); cross.setAttribute('opacity', 1);
        tip.show(xAt(i) * k, PAD.t * k + 4, spanTitle(rows[i]),
          series.map((s) => ({ sw: s.sw, label: s.label, value: rows[i][s.key] || 0 })));
      },
      () => { cross.setAttribute('opacity', 0); tip.hide(); });
  }

  /* ---- Enquiries: columns on their own scale ------------------------------- */
  const barPath = (x, w, top, base) => {
    const r = Math.min(4, w / 2, base - top);
    return `M${x} ${base}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + w - r}Q${x + w} ${top} ${x + w} ${top + r}V${base}Z`;
  };

  function renderLeads({ rows, weekly }) {
    const host = $('#chart-leads');
    host.replaceChildren();
    const total = rows.reduce((a, r) => a + (r.leads || 0), 0);
    $('#lead-note').textContent = total
      ? `${num(total)} in this period${weekly ? ', by week' : ''}`
      : 'none in this period';
    if (!rows.length) { emptyNote(host, 'Nothing recorded yet.'); return; }

    const f = frame(host, 160, `Enquiries per ${weekly ? 'week' : 'day'}`);
    const top = niceTop(Math.max(...rows.map((r) => r.leads || 0)), 2);
    yAxis(f, top, 2);
    // At most 24 wide, 2px of surface between neighbours.
    const slot = f.iw / rows.length;
    const w = slot >= 4 ? Math.min(24, slot - 2) : Math.max(1, slot - 1);
    const xAt = (i) => PAD.l + i * slot + slot / 2;
    xLabels(f, rows, xAt);

    const base = PAD.t + f.ih;
    const bars = rows.map((r, i) => {
      const v = r.leads || 0;
      if (!v) return null;
      const h = (v / top) * f.ih;
      const p = svgEl('path', { class: 'bar', d: barPath(xAt(i) - w / 2, w, base - h, base) });
      f.svg.append(p);
      return p;
    });
    // The busiest day gets its number on the cap; the rest are in the readout
    // and the table below.
    let peak = 0;
    rows.forEach((r, i) => { if ((r.leads || 0) > (rows[peak].leads || 0)) peak = i; });
    if (rows[peak].leads > 0) {
      const t = svgEl('text', { class: 'end-label', x: xAt(peak), y: base - (rows[peak].leads / top) * f.ih - 5, 'text-anchor': 'middle' });
      t.textContent = num(rows[peak].leads);
      f.svg.append(t);
    }

    const hit = svgEl('rect', { class: 'hit', x: PAD.l, y: PAD.t, width: f.iw, height: f.ih });
    f.svg.append(hit);
    host.append(f.svg);
    const tip = tooltip(host);
    let hot = null;

    bindNav(f, hit, rows.length,
      (rel) => Math.floor((rel - PAD.l) / slot),
      (i) => {
        if (hot) hot.classList.remove('is-hot');
        hot = bars[i];
        if (hot) hot.classList.add('is-hot');
        const v = rows[i].leads || 0;
        const box = f.svg.getBoundingClientRect();
        const k = box.width / f.width;
        tip.show(xAt(i) * k, (base - (v / top) * f.ih) * k - 2, spanTitle(rows[i]),
          [{ label: v === 1 ? 'enquiry' : 'enquiries', value: v }]);
      },
      () => { if (hot) hot.classList.remove('is-hot'); hot = null; tip.hide(); });
  }

  /* ---- Tables -------------------------------------------------------------- */
  /* rows are {k: label, v: value} — one shape for most tables on the page. */
  function table(hostSel, rows, cols, empty = 'Nothing yet.') {
    const host = $(hostSel);
    host.replaceChildren();
    if (!rows || !rows.length) { emptyNote(host, empty); return; }
    const max = Math.max(...rows.map((r) => r.v || 0)) || 1;
    const t = make('table', 'tbl');
    const hr = make('tr');
    cols.forEach((c) => hr.append(make('th', null, c)));
    const thead = make('thead');
    thead.append(hr);
    const tb = make('tbody');
    rows.forEach((r) => {
      const tr = make('tr');
      const td1 = make('td', 'meter');
      // CSSOM, not a style attribute — the CSP allows this and forbids that.
      td1.style.setProperty('--w', `${Math.round(((r.v || 0) / max) * 100)}%`);
      const label = String(r.k ?? '—');
      const span = make('span', 'name', label);
      span.title = label;
      td1.append(span);
      tr.append(td1, make('td', null, num(r.v)));
      tb.append(tr);
    });
    t.append(thead, tb);
    host.append(t);
  }

  /* Several number columns. rows are {k: label, w: 0..1 bar width, cells: []}. */
  function tableN(hostSel, cols, rows, empty = 'Nothing yet.') {
    const host = $(hostSel);
    host.replaceChildren();
    if (!rows.length) { emptyNote(host, empty); return; }
    const t = make('table', 'tbl tbl--n');
    const hr = make('tr');
    cols.forEach((c) => hr.append(make('th', null, c)));
    const thead = make('thead');
    thead.append(hr);
    const tb = make('tbody');
    rows.forEach((r) => {
      const tr = make('tr');
      const td1 = make('td', 'meter');
      td1.style.setProperty('--w', `${Math.round(Math.min(1, r.w || 0) * 100)}%`);
      const span = make('span', 'name', r.k);
      span.title = r.k;
      td1.append(span);
      tr.append(td1);
      r.cells.forEach((c) => tr.append(make('td', null, c)));
      tb.append(tr);
    });
    t.append(thead, tb);
    // Wide tables scroll inside their panel rather than widening the page.
    const wrap = make('div', 'tbl-wrap');
    wrap.append(t);
    host.append(wrap);
  }

  /* ---- By building ----------------------------------------------------------
     The panel this dashboard exists for: which buildings draw people, and which
     of them turn into enquiries. The bar is the share of visitors, so interest
     reads at a glance even where nobody has enquired yet. */
  function renderBuildings(rows) {
    const host = $('#t-buildings');
    host.replaceChildren();
    if (!rows.length) { emptyNote(host, 'Nothing yet.'); return; }
    const max = Math.max(1, ...rows.map((r) => r.visits || 0));
    const cols = ['Building', 'Visitors', 'Enquiries', 'Rate', 'Phone taps', 'Apply clicks', 'Pageviews'];
    const t = make('table', 'tbl tbl--n tbl--bldg');
    const hr = make('tr');
    cols.forEach((c) => hr.append(make('th', null, c)));
    const thead = make('thead');
    thead.append(hr);
    const tb = make('tbody');
    rows.forEach((r) => {
      const tr = make('tr', !r.views && !r.visits && !r.leads ? 'is-quiet' : '');
      const td1 = make('td', 'meter');
      td1.style.setProperty('--w', `${Math.round(((r.visits || 0) / max) * 100)}%`);
      const box = make('div');
      const name = String(r.name || r.slug || '—');
      let label;
      if (r.slug && SLUG.test(r.slug)) {
        label = make('a', 'name', name);
        label.href = `/properties/${r.slug}/`;
        label.target = '_blank';
        label.rel = 'noopener';
        label.title = `Open the ${name} page`;
      } else {
        label = make('span', 'name', name);
      }
      box.append(label);
      if (r.city) box.append(make('span', 'city', r.city));
      td1.append(box);
      tr.append(td1);
      const cells = [
        ['Visitors', num(r.visits)],
        ['Enquiries', num(r.leads), 'is-key'],
        ['Rate', pct(r.leads || 0, r.visits || 0)],
        ['Phone taps', num(r.phone_clicks)],
        ['Apply clicks', num(r.apply_clicks)],
        ['Pageviews', num(r.views)],
      ];
      for (const [k, v, cls] of cells) {
        const td = make('td', cls, v);
        td.dataset.label = k;
        tr.append(td);
      }
      tb.append(tr);
    });
    t.append(thead, tb);
    const wrap = make('div', 'tbl-wrap');
    wrap.append(t);
    host.append(wrap);
  }

  /** "Unit 4B" for a bare unit number; whatever Rent Manager calls it otherwise. */
  const unitText = (u) => {
    const s = String(u ?? '').trim();
    return /^[A-Za-z]?\d+[A-Za-z]?$/.test(s) ? `Unit ${s}` : s;
  };

  const channelName = (c) => (c === 'direct' ? 'Typed in or bookmarked' : String(c).replace(/_/g, ' '));

  function renderSources(rows) {
    const max = Math.max(1, ...rows.map((r) => r.visits || 0));
    tableN('#t-sources', ['Channel', 'Visitors', 'Enquiries', 'Rate'],
      rows.map((r) => ({ k: channelName(r.channel), w: (r.visits || 0) / max,
        cells: [num(r.visits), num(r.leads), pct(r.leads, r.visits)] })));
  }

  function renderCampaigns(rows) {
    const max = Math.max(1, ...rows.map((r) => r.visits || 0));
    tableN('#t-campaigns', ['Campaign', 'Visitors', 'Enquiries', 'Rate'],
      rows.map((r) => ({ k: String(r.campaign), w: (r.visits || 0) / max,
        cells: [num(r.visits), num(r.leads), pct(r.leads, r.visits)] })),
      'None yet. Make a tracking link below and use it in an ad, a listing or a post.');
  }

  function renderFunnel(f) {
    const steps = [
      ['Visitors', f.visitors || 0],
      ['Started the enquiry form', f.starts || 0],
      ['Sent an enquiry', f.leads || 0],
    ];
    const max = Math.max(1, ...steps.map((s) => s[1]));
    tableN('#t-funnel', ['Step', 'People', 'Of visitors'],
      steps.map(([k, v], i) => ({ k, w: v / max, cells: [num(v), i ? pct(v, f.visitors) : ''] })));
  }

  /* Same rows as the shared report's Emails section. Delivery counts only
     once Resend's reports are connected; before that they would read zero for
     "not told", which looks like "none arrived". */
  function renderEmails(e) {
    if (!e || !e.confirmations) { tableN('#t-emails', [], [], 'Nothing yet.'); return; }
    const c = e.confirmations;
    const n = e.notifications || { enquiries: 0, reached: 0, bounced: 0 };
    const rows = [['Confirmations sent', c.sent, '']];
    if (e.tracking) {
      rows.push(['Delivered', c.delivered, pct(c.delivered, c.sent)]);
      rows.push(['Bounced', c.bounced, pct(c.bounced, c.sent)]);
      rows.push(['Marked as spam', c.complained, pct(c.complained, c.sent)]);
      if (c.opened) rows.push(['Opened', c.opened, pct(c.opened, c.sent)]);
      if (c.clicked) rows.push(['Clicked a link', c.clicked, pct(c.clicked, c.sent)]);
    }
    rows.push(['Unsubscribed', e.unsubscribes, '']);
    if (c.held_unsubscribed) rows.push(['Held: unsubscribed', c.held_unsubscribed, '']);
    if (c.held_recent) rows.push(['Held: had one recently', c.held_recent, '']);
    if (c.failed) rows.push(['Refused by Resend', c.failed, '']);
    rows.push(['Enquiries to the team', n.reached, pct(n.reached, n.enquiries)]);
    if (e.tracking && n.bounced) rows.push(['Team emails bounced', n.bounced, '']);
    const max = Math.max(1, ...rows.map((r) => r[1] || 0));
    tableN('#t-emails', ['Email', 'Count', 'Share'], rows.map(([k, v, s]) => ({ k, w: (v || 0) / max, cells: [num(v), s] })));
    if (!e.tracking) {
      $('#t-emails').append(make('p', 'verdict',
        'Delivery, bounce and spam counts start once Resend’s delivery reports are connected (RESEND_WEBHOOK_SECRET).'));
    }
  }

  const EVENT_NAMES = {
    phone_click: 'Tapped a phone number', email_click: 'Tapped the email address',
    apply_click: 'Clicked Apply on a home', portal_click: 'Went to the resident portal',
    map_click: 'Opened a map', gallery_open: 'Opened a photo',
    outbound: 'Followed a link off the site', form_start: 'Started the enquiry form',
    filter: 'Filtered the homes',
  };

  const TOPIC = {
    tour: 'Tours', availability: 'Availability', pricing: 'Pricing', parking: 'Parking',
    pets: 'Pets', amenities: 'Amenities', 'lease-terms': 'Lease terms', application: 'Applying',
    accessibility: 'Accessibility', neighborhood: 'Neighborhood', utilities: 'Utilities',
    maintenance: 'Maintenance', other: 'Other',
  };

  /* What enquirers came about: Claude's topics when it has read them, which
     say more, and otherwise the reason they picked on the form. */
  function renderAsked() {
    if (!current) return;
    const a = current.asked || {};
    const topics = a.topics || [];
    if (topics.length) {
      $('#asked-note').textContent = 'what enquirers wrote about, as Claude read it';
      table('#t-asked', topics.map((r) => ({ k: TOPIC[r.topic] || r.topic, v: r.count })), ['Topic', 'Enquiries']);
    } else {
      $('#asked-note').textContent = 'the reason enquirers picked on the form';
      table('#t-asked', (a.interests || []).map((r) => ({ k: lab('interest', r.interest), v: r.count })),
        ['Reason', 'Enquiries'], 'No enquiries in this period.');
    }
  }

  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* codes then */ }
  const countryName = (c) => {
    if (!c || c === '—' || !/^[A-Z]{2}$/.test(c) || !regionNames) return c || '—';
    try { return regionNames.of(c) || c; } catch { return c; }
  };

  function renderDaily(rows) {
    const host = $('#t-daily');
    host.replaceChildren();
    if (!rows.length) { emptyNote(host, 'Nothing recorded yet.'); return; }
    const t = make('table', 'tbl tbl--n');
    const hr = make('tr');
    ['Day', 'Pageviews', 'Visitors', 'Enquiries'].forEach((c) => hr.append(make('th', null, c)));
    const thead = make('thead');
    thead.append(hr);
    const tb = make('tbody');
    rows.slice().reverse().forEach((r) => {
      const tr = make('tr');
      tr.append(make('td', null, `${DOW[utcDay(r.day).getUTCDay()]} ${shortDay(r.day)}`),
        make('td', null, num(r.pageviews)), make('td', null, num(r.visits)), make('td', null, num(r.leads)));
      tb.append(tr);
    });
    t.append(thead, tb);
    const wrap = make('div', 'tbl-wrap');
    wrap.append(t);
    host.append(wrap);
  }

  function render() {
    const d = current;
    if (!d) return;
    renderTiles(d.totals || {});
    renderAvail(d.availability);
    learnBuildings(d.properties || []);
    renderBuildings(d.properties || []);

    const daily = d.daily || [];
    const b = bucket(daily);
    renderTraffic(b);
    renderLeads(b);
    renderDaily(daily);

    table('#t-units', (d.units || []).map((u) => ({
      k: `${buildingName(u.property)} · ${unitText(u.unit)}`, v: u.clicks,
    })), ['Home', 'Apply clicks'], 'Nobody has clicked Apply in this period.');
    table('#t-plans', (d.plans || []).map((r) => ({ k: r.plan, v: r.count })), ['Size', 'Times']);
    renderSources(d.sources || []);
    renderCampaigns(d.campaigns || []);
    renderFunnel(d.funnel || { visitors: 0, starts: 0, leads: 0 });
    renderAsked();
    table('#t-pages', (d.pages || []).map((r) => ({ k: r.path, v: r.views })), ['Page', 'Views']);
    table('#t-referrers', (d.referrers || []).map((r) => ({ k: channelName(r.ref), v: r.views })), ['Site', 'Views']);
    table('#t-events', (d.events || []).map((r) => ({ k: EVENT_NAMES[r.kind] || r.kind, v: r.count })), ['Action', 'Count']);
    renderEmails(d.emails);
    table('#t-devices', (d.devices || []).map((r) => ({ k: r.device, v: r.views })), ['Device', 'Views']);
    table('#t-countries', (d.countries || []).map((r) => ({ k: countryName(r.country), v: r.views })), ['Country', 'Views']);
  }

  /* ---- Enquiries -----------------------------------------------------------
     Every value below is something a stranger typed into a form on the public
     internet, so it reaches the page through textContent and never innerHTML.
     The panel sits near the top because this is what a leasing team opens the
     dashboard to see. */
  let leadScope = 'open';
  let leadProperty = '';
  let leadSeq = 0;
  let leadAi = false;      // the server has an Anthropic key
  let leadSheet = false;   // a Google Sheet is connected
  let leadRm = false;      // enquiries go to Rent Manager as prospects

  // The words for the form's codes, from the server; the raw code otherwise.
  let labels = { interest: {}, bedrooms: {}, move_in: {}, source: {} };
  const lab = (kind, v) => (labels[kind] && Object.prototype.hasOwnProperty.call(labels[kind], v) ? labels[kind][v] : v);
  // "2026-11" -> "November 2026"; anything else through the labels.
  const moveInText = (v) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(v));
    return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : lab('move_in', v);
  };

  const button = (text, cls = 'ghost') => {
    const b = make('button', cls, text);
    b.type = 'button';
    return b;
  };

  /** "zillow / listing · fall-lease-2026" or the referring site. */
  const cameVia = (r) => [
    r.utm_source && [r.utm_source, r.utm_medium].filter(Boolean).join(' / ').replace(/_/g, ' '),
    r.utm_campaign,
    !r.utm_source && r.referrer,
  ].filter(Boolean).join(' · ');

  /** Seconds since 1970, whichever unit the server sent. */
  const secs = (ts) => (Number(ts) > 1e12 ? Math.floor(Number(ts) / 1000) : Number(ts));

  /** "3 minutes ago" down to the day, then a date. Leasing is a same-day game;
   *  "22 Sep" is no use when what matters is whether this came in over lunch. */
  function ago(ts) {
    const s = Math.floor(Date.now() / 1000) - secs(ts);
    if (s < 90) return 'just now';
    const mins = Math.round(s / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const d = Math.round(hrs / 24);
    if (d <= 6) return `${d} day${d === 1 ? '' : 's'} ago`;
    return new Date(secs(ts) * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  }

  /* Claude's read of one enquiry. Everything in it is model output about a
     stranger's text, so it goes in through textContent like the rest. The
     draft is a textarea because it is a starting point: nothing here sends. */
  function aiBlock(r) {
    const box = make('div', 'lead__ai');
    box.append(make('p', 'lead__sum', r.ai.summary || ''));

    const tags = (r.ai.topics || []).map((t) => TOPIC[t] || t);
    if (r.ai.spam || tags.length) {
      const row = make('p', 'lead__topics');
      if (r.ai.spam) row.append(make('span', 'lead__topic is-spam', 'Looks like spam'));
      tags.forEach((t) => row.append(make('span', 'lead__topic', t)));
      box.append(row);
    }

    const det = make('details', 'lead__draft');
    const ta = make('textarea');
    ta.value = r.ai.reply || '';
    ta.rows = 9;
    ta.setAttribute('aria-label', `Draft reply to ${r.first_name || 'them'}, editable`);

    const acts = make('div', 'lead__draft-actions');
    const mail = make('a', 'ghost', 'Open in email');
    const subject = `Your Evolution24 Properties enquiry${r.ref ? ` (${r.ref})` : ''}`;
    const setMail = () => {
      mail.href = `mailto:${encodeURIComponent(r.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(ta.value)}`;
    };
    setMail();
    ta.addEventListener('input', setMail);
    const copy = button('Copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ta.value); copy.textContent = 'Copied'; } catch { ta.select(); copy.textContent = 'Press Ctrl+C'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
    });
    acts.append(mail, copy, make('small', null, 'Written by Claude from their message. Check it before you send it.'));

    det.append(make('summary', null, 'Draft reply'), ta, acts);
    box.append(det);
    return box;
  }

  /** POST one change to an enquiry. Resolves to the answer, null when signed
   *  out, and throws the server's own sentence when it did not happen. */
  async function postLead(body) {
    const r = await api('/api/inquiries/', { method: 'POST', body });
    if (!r) return null;
    if (!r.res.ok || r.data.ok === false) throw new Error(r.data.error || `Server returned ${r.res.status}`);
    return r.data;
  }

  /** A button that does one thing to the enquiry, then reloads the list. */
  function actionButton(text, busy, body, onError) {
    const b = button(text);
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = busy;
      try {
        if (await postLead(body) === null) return;
        loadLeads();
      } catch (err) {
        b.disabled = false;
        onError(b, err);
      }
    });
    return b;
  }

  function leadCard(r) {
    const card = make('article', 'lead' + (r.handled ? ' lead--done' : ''));

    // Which building, and the number the team quotes back to them.
    const topRow = make('div', 'lead__top');
    const bldg = make('p', 'lead__bldg', r.property_name || buildingName(r.property) || 'General');
    if (r.unit) bldg.append(make('span', null, ` · ${unitText(r.unit)}`));
    topRow.append(bldg);
    if (r.ref) {
      const ref = make('span', 'lead__ref', r.ref);
      ref.title = 'Enquiry number';
      topRow.append(ref);
    }
    card.append(topRow);

    const head = make('div', 'lead__head');
    head.append(make('h3', 'lead__who', `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'No name given'));
    if (r.interest) head.append(make('span', 'lead__tag', lab('interest', r.interest)));
    // They used the link in the site's email. A personal reply is still fine;
    // anything automated or bulk is not.
    if (r.unsubscribed_at) {
      const off = make('span', 'lead__tag lead__tag--off', 'Unsubscribed');
      off.title = `Asked for no more emails from the website on ${new Date(secs(r.unsubscribed_at) * 1000).toLocaleDateString('en-US')}.`;
      head.append(off);
    }
    const when = make('time', 'lead__when', ago(r.ts));
    when.dateTime = new Date(secs(r.ts) * 1000).toISOString();
    when.title = new Date(secs(r.ts) * 1000).toLocaleString('en-US');
    head.append(when);
    card.append(head);

    // Tappable on a phone, which is where a leasing agent reads this.
    const contact = make('p', 'lead__contact');
    if (r.email) {
      const mail = make('a', null, r.email);
      mail.href = `mailto:${encodeURIComponent(r.email)}`;
      contact.append(mail);
    }
    if (r.phone) {
      if (r.email) contact.append(document.createTextNode(' · '));
      const tel = make('a', null, r.phone);
      tel.href = `tel:${String(r.phone).replace(/[^0-9+]/g, '')}`;
      contact.append(tel);
    }
    card.append(contact);

    const facts = [
      r.bedrooms && `Size: ${lab('bedrooms', r.bedrooms)}`,
      r.move_in && `Move-in: ${moveInText(r.move_in)}`,
      r.source && `Found us: ${lab('source', r.source)}`,
    ].filter(Boolean);
    if (facts.length) card.append(make('p', 'lead__meta', facts.join(' · ')));

    // Whether it reached the leasing team's Google Sheet, when one is connected.
    if (leadSheet) {
      card.append(make('p', 'lead__via' + (r.sheet_ok === 0 ? ' is-bad' : ''), r.sheet_ok === 1 ? 'In the lead sheet.'
        : r.sheet_ok === 0 ? `Not in the lead sheet: ${r.sheet_note || 'unknown'}` : 'Not in the lead sheet yet.'));
    }
    // Whether it went to Rent Manager as a prospect, when that is switched on.
    if (leadRm) {
      card.append(make('p', 'lead__via' + (r.rm_ok === 0 ? ' is-bad' : ''), r.rm_ok === 1
        ? `In Rent Manager${r.rm_note ? `: ${r.rm_note}` : '.'}`
        : r.rm_ok === 0 ? `Not in Rent Manager: ${r.rm_note || 'unknown'}` : 'Not in Rent Manager yet.'));
    }

    // The branded "we've got it" the visitor was sent, or why not.
    if (r.confirm_ok === 1 || r.confirm_ok === 0) {
      card.append(make('p', 'lead__via' + (r.confirm_ok === 0 ? ' is-bad' : ''), r.confirm_ok === 1
        ? `Confirmation email sent to them${r.confirm_status ? `, ${r.confirm_status}` : ''}.`
        : `No confirmation email: ${r.confirm_note || 'not sent'}`));
    }

    const via = cameVia(r);
    const from = r.page ? `Sent from ${r.page}` : r.form === 'contact' ? 'Sent from the contact form' : '';
    if (via || from) {
      card.append(make('p', 'lead__via', [from, via && `came via ${via}`].filter(Boolean).join(', ')
        .replace(/^came/, 'Came')));
    }

    if (r.ai && typeof r.ai === 'object') card.append(aiBlock(r));

    if (r.message) card.append(make('p', 'lead__msg', r.message));   // never innerHTML: this is their text

    const foot = make('div', 'lead__foot');
    // Why an email or a sync did not happen, when a retry says so.
    const sendWhy = make('p', 'lead__aierr');
    sendWhy.hidden = true;
    const why = (text) => { sendWhy.textContent = text; sendWhy.hidden = false; };

    foot.append(actionButton(r.handled ? 'Reopen' : 'Mark handled', 'Saving…',
      { id: r.id, handled: r.handled ? 0 : 1 },
      (b) => { b.textContent = 'Could not save — retry'; }));

    if (leadAi && !r.ai) {
      const ask = button(r.ai_err ? 'Try Claude again' : 'Summarise with Claude');
      ask.addEventListener('click', async () => {
        ask.disabled = true;
        ask.textContent = 'Reading…';
        try {
          const res = await api('/api/triage/', { method: 'POST', body: { id: r.id } });
          if (!res) return;
          if (!res.res.ok) throw new Error(res.data.error || `Server returned ${res.res.status}`);
          loadLeads();
        } catch (err) {
          ask.disabled = false;
          ask.textContent = 'Try Claude again';
          ask.title = err.message;
        }
      });
      foot.append(ask);
    }

    // The visitor's confirmation, when they have not had one: an enquiry from
    // before it existed, a refusal, or someone who says it never came.
    if (r.confirm_ok !== 1 && !r.unsubscribed_at && r.email) {
      const again = actionButton('Send confirmation', 'Sending…', { id: r.id, confirm: true }, (b, err) => {
        b.textContent = 'Send confirmation';
        const hint = emailHint(err.message);
        why(`Confirmation not sent. ${err.message}${hint ? ' ' + hint : ''}`);
      });
      again.title = 'Email this person the branded “we’ve got your message” confirmation now.';
      foot.append(again);
    }

    if (leadSheet && r.sheet_ok !== 1) {
      foot.append(actionButton(r.sheet_ok === 0 ? 'Try the sheet again' : 'Add to lead sheet', 'Adding…',
        { id: r.id, sheet: true }, (b, err) => {
          b.textContent = 'Try the sheet again';
          why(`Not added to the sheet. ${err.message}`);
        }));
    }

    if (leadRm && r.rm_ok !== 1) {
      foot.append(actionButton(r.rm_ok === 0 ? 'Try Rent Manager again' : 'Add to Rent Manager', 'Adding…',
        { id: r.id, rentmanager: true }, (b, err) => {
          b.textContent = 'Try Rent Manager again';
          why(`Not added to Rent Manager. ${err.message}`);
        }));
    }

    if (!r.notified) {
      const flag = make('span', 'lead__flag', 'No email sent');
      flag.title = 'Saved here, but the notification email to the leasing team did not go out.';
      foot.append(flag);
      // Once email is set up, this sends the one that was missed. It is also
      // the quickest test that email works at all.
      foot.append(actionButton('Send email', 'Sending…', { id: r.id, notify: true }, (b, err) => {
        b.textContent = 'Send again';
        const hint = emailHint(err.message);
        why(`Not sent. ${err.message}${hint ? ' ' + hint : ''}`);
      }));
    }
    card.append(foot, sendWhy);

    // Why there is no summary, in Claude's or the SDK's words.
    if (leadAi && !r.ai && r.ai_err) card.append(make('p', 'lead__aierr', r.ai_err));
    return card;
  }

  /* What to change, in plain words, for the email failures that actually
     happen. The provider's own sentence is shown as well; this is the fix. */
  function emailHint(error) {
    const e = String(error || '');
    if (/(RESEND_API_KEY|LEAD_TO|LEAD_FROM) is not set/.test(e)) {
      return 'In Vercel, open the project, then Settings → Environment Variables, add it for Production, and redeploy.';
    }
    if (/own email address|verify a domain/i.test(e)) {
      return 'Resend only sends to other people from a verified domain. Set LEAD_FROM to an address on that domain, e.g. Evolution24 Properties <leasing@your-domain>.';
    }
    if (/domain is not verified/i.test(e)) return 'LEAD_FROM has to use the domain that is verified in Resend.';
    if (/^401\b/.test(e)) return 'Resend did not accept the key. Make a new one in Resend → API Keys and replace RESEND_API_KEY in Vercel.';
    if (/^422\b/.test(e)) return 'Check LEAD_FROM: it should look like Evolution24 Properties <leasing@your-domain>, with no quotes.';
    return '';
  }

  /* ---- Building filter ------------------------------------------------------ */
  const propertySelect = $('#lead-property');

  function fillBuildingFilter() {
    const keep = propertySelect.value;
    const opts = [['', 'All buildings'], ...byName().map(([slug, b]) => [slug, b.name])];
    propertySelect.replaceChildren(...opts.map(([value, text]) => {
      const o = make('option', null, text);
      o.value = value;
      return o;
    }));
    propertySelect.value = buildings.has(keep) ? keep : '';
  }

  propertySelect.addEventListener('change', () => {
    leadProperty = propertySelect.value;
    loadLeads();
  });

  async function loadLeads() {
    const seq = ++leadSeq;
    const host = $('#leads');
    const warn = $('#lead-warn');
    const count = $('#lead-count');
    if (host.firstChild) host.classList.add('is-stale');
    const qs = new URLSearchParams({ limit: '200' });
    if (leadScope === 'all') qs.set('all', '1');
    if (leadProperty) qs.set('property', leadProperty);
    try {
      const r = await api(`/api/inquiries/?${qs}`);
      if (!r) return;
      if (seq !== leadSeq) return;
      if (!r.res.ok) throw new Error(r.data.error || `Server returned ${r.res.status}`);
      const d = r.data;
      leadAi = Boolean(d.ai);
      leadSheet = Boolean(d.sheet);
      leadRm = Boolean(d.rm);
      if (d.labels && typeof d.labels === 'object') {
        labels = { interest: {}, bedrooms: {}, move_in: {}, source: {}, ...d.labels };
        renderAsked();
      }
      if (d.properties && typeof d.properties === 'object') {
        // {slug: name} as documented; {slug: {name, city}} works too.
        learnBuildings(Object.entries(d.properties).map(([slug, v]) => (v && typeof v === 'object'
          ? { slug, name: String(v.name || slug), city: v.city ? String(v.city) : '' } : { slug, name: String(v) })));
      }

      const list = Array.isArray(d.inquiries) ? d.inquiries : [];
      const where = leadProperty ? ` for ${buildingName(leadProperty)}` : '';
      host.replaceChildren();
      if (!list.length) {
        host.append(make('p', 'empty', leadScope === 'all'
          ? `No enquiries${where} yet.`
          : `Nothing waiting${where} — every enquiry has been handled.`));
      } else {
        const wrap = make('div', 'leads');
        list.forEach((x) => wrap.append(leadCard(x)));
        host.append(wrap);
      }
      count.textContent = leadProperty
        ? `Showing ${num(list.length)} ${leadScope === 'all' ? '' : 'open '}${list.length === 1 ? 'enquiry' : 'enquiries'}${where}.`
        : `${num(d.open)} open of ${num(d.total)} in all.`;

      // The only place anyone learns that email delivery is broken: to the
      // visitor a lead that was stored but not emailed looks like success.
      if (d.unnotified > 0) {
        warn.hidden = false;
        warn.replaceChildren(make('strong', null,
          `${d.unnotified} enquir${d.unnotified === 1 ? 'y was' : 'ies were'} saved without a notification email going out.`));
        warn.append(document.createTextNode(' The leads are safe here. '));
        if (d.lastError) {
          warn.append(document.createTextNode('The email provider said: '));
          warn.append(make('code', null, d.lastError));      // provider text, so textContent
          const hint = emailHint(d.lastError);
          if (hint) warn.append(document.createTextNode(' ' + hint));
        } else {
          warn.append(document.createTextNode('Check RESEND_API_KEY and LEAD_TO in the project’s Environment Variables in Vercel.'));
        }
        warn.append(document.createTextNode(' Once it is fixed, press Send email on each one.'));
      } else {
        warn.hidden = true;
      }
    } catch (err) {
      if (seq !== leadSeq) return;
      host.replaceChildren(make('p', 'empty', `Could not load the enquiries — ${err.message}.`));
      count.textContent = '';
    } finally {
      if (seq === leadSeq) host.classList.remove('is-stale');
    }
  }

  document.querySelectorAll('.seg [data-leads]').forEach((btn) => {
    btn.addEventListener('click', () => {
      leadScope = btn.dataset.leads;
      document.querySelectorAll('.seg [data-leads]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === btn)));
      loadLeads();
    });
  });

  /* ---- In plain English ----------------------------------------------------
     Claude's read of the numbers above, for the date range on screen. The
     server keeps one per range per day, so opening the dashboard shows the
     saved one for free; asking again is a button, never automatic. The panel
     only appears when the server has Claude switched on. */
  const insightPanel = $('#insight-panel');
  const insightEl = $('#insight');
  const insightAsk = $('#insight-ask');
  const insightNote = $('#insight-note');

  function renderInsight(ins) {
    insightEl.replaceChildren(make('p', 'insight__headline', ins.headline || ''));
    if (ins.points && ins.points.length) {
      const ul = make('ul', 'insight__points');
      ins.points.forEach((pt) => {
        const li = make('li');
        li.append(make('strong', null, pt.title), document.createTextNode(` ${pt.detail || ''}`));
        ul.append(li);
      });
      insightEl.append(ul);
    }
    if (ins.next && ins.next.length) {
      const ol = make('ol', 'insight__next');
      ins.next.forEach((t) => ol.append(make('li', null, t)));
      insightEl.append(make('p', 'insight__k', 'Worth trying next'), ol);
    }
    insightNote.textContent = ins.ts ? `Read ${ago(ins.ts)} · aggregate numbers only` : '';
  }

  const insightEmpty = (text) => { insightEl.replaceChildren(make('p', 'empty', text)); };

  async function loadInsight() {
    const range = days;
    if (current && current.ai === false) { insightPanel.hidden = true; return; }
    try {
      const r = await api(`/api/insights/?days=${range}`);
      if (!r) return;
      if (range !== days) return;            // the range changed while this was in flight
      if (!r.res.ok || !r.data.ai) { insightPanel.hidden = true; return; }
      insightPanel.hidden = false;
      insightAsk.hidden = false;
      insightAsk.disabled = false;
      if (r.data.insight) {
        renderInsight(r.data.insight);
        insightAsk.textContent = 'Ask again';
      } else {
        insightNote.textContent = '';
        insightEmpty(`Get a short written read of the last ${range} days: what changed, what is working and what to try next.`);
        insightAsk.textContent = 'Ask Claude';
      }
    } catch {
      insightPanel.hidden = true;   // not there yet on this deployment
    }
  }

  insightAsk.addEventListener('click', async () => {
    const range = days;
    const fresh = insightAsk.textContent === 'Ask again';
    insightAsk.disabled = true;
    insightAsk.textContent = 'Reading the numbers…';
    try {
      const r = await api('/api/insights/', { method: 'POST', body: { days: range, fresh } });
      if (!r) return;
      if (!r.res.ok || !r.data.insight) throw new Error(r.data.error || `Server returned ${r.res.status}`);
      if (range === days) renderInsight(r.data.insight);
      insightAsk.textContent = 'Ask again';
    } catch (err) {
      insightEmpty(`Claude could not answer: ${err.message}`);
      insightAsk.textContent = 'Ask Claude';
    } finally {
      insightAsk.disabled = false;
    }
  });

  /* ---- Reports ---------------------------------------------------------------
     A report is a page of totals for one day, week or month, frozen when it is
     made and readable by anyone with its link. The choices below follow the
     server's calendar (UTC days, weeks from Monday), and the server works the
     period out again from the day it is sent, so this list only has to be
     convenient, never authoritative. */
  const reportForm = $('#report-form');
  const reportWhen = $('#report-when');
  const reportMake = $('#report-make');
  const reportStatus = $('#report-status');
  const reportList = $('#report-list');
  let reportPeriod = 'week';

  /** [value, label] pairs, newest first; the value is a day inside the period. */
  function reportChoices(period) {
    const today = isoDay(new Date());
    const out = [];
    if (period === 'day') {
      for (let i = 0; i < 14; i++) {
        const d = plusDays(today, -i);
        const name = `${DOW[utcDay(d).getUTCDay()]} ${md(d)}`;
        out.push([d, i === 0 ? `Today so far (${name})` : i === 1 ? `Yesterday (${name})` : name]);
      }
    } else if (period === 'week') {
      const monday = plusDays(today, -((utcDay(today).getUTCDay() + 6) % 7));
      for (let i = 0; i < 12; i++) {
        const from = plusDays(monday, -7 * i);
        const span = `${md(from)} – ${md(i === 0 ? today : plusDays(from, 6))}`;
        out.push([from, i === 0 ? `This week so far (${span})` : i === 1 ? `Last week (${span})` : span]);
      }
    } else {
      const t = utcDay(today);
      for (let i = 0; i < 12; i++) {
        const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1));
        const name = `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`;
        out.push([isoDay(first), i === 0 ? `${name} so far` : name]);
      }
    }
    return out;
  }

  function fillChoices() {
    reportWhen.replaceChildren(...reportChoices(reportPeriod).map(([value, label], i) => {
      const o = make('option', null, label);
      o.value = value;
      // The last finished one is what "the weekly report" usually means.
      o.selected = i === 1;
      return o;
    }));
  }

  /** Only http(s) links from the server become hrefs. */
  const safeHref = (u) => {
    try {
      const url = new URL(String(u), location.href);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch { return null; }
  };

  const copyText = async (btn, text) => {
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch { btn.textContent = 'Could not copy'; }
    setTimeout(() => { btn.textContent = 'Copy link'; }, 1800);
  };

  function renderReports(rows) {
    reportList.replaceChildren();
    rows.forEach((r) => {
      const href = safeHref(r.url);
      const li = make('li');
      const name = make('span', 'report-name');
      const a = make(href ? 'a' : 'span', null, r.label || 'Report');
      if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; }
      name.append(a, make('small', null, `made ${ago(r.ts)}`));
      li.append(name);

      if (href) {
        const copy = button('Copy link');
        copy.addEventListener('click', () => copyText(copy, href));
        li.append(copy);
      }
      const stop = button('Stop sharing');
      stop.addEventListener('click', async () => {
        if (!window.confirm('Stop sharing this report? Its link will stop working for everyone.')) return;
        stop.disabled = true;
        try {
          const res = await api(`/api/reports/?token=${encodeURIComponent(r.token)}`, { method: 'DELETE' });
          if (!res) return;
          if (!res.res.ok) throw new Error();
          loadReports();
        } catch {
          stop.disabled = false;
          stop.textContent = 'Could not stop it — retry';
        }
      });
      li.append(stop);
      reportList.append(li);
    });
  }

  async function loadReports() {
    try {
      const r = await api('/api/reports/');
      if (!r || !r.res.ok) return;
      renderReports(r.data.reports || []);
    } catch { /* the list is a convenience; making a report still works */ }
  }

  reportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    reportMake.disabled = true;
    reportStatus.className = 'report-status';
    reportStatus.textContent = leadAi ? 'Making the report. Claude is writing its summary, which takes a few seconds…' : 'Making the report…';
    try {
      const r = await api('/api/reports/', { method: 'POST', body: { period: reportPeriod, day: reportWhen.value } });
      if (!r) return;
      const d = r.data;
      if (!r.res.ok) throw new Error(d.error || `Server returned ${r.res.status}`);
      const href = safeHref(d.url);
      reportStatus.replaceChildren(document.createTextNode(`${d.existing ? 'Already made' : 'Ready'}: ${d.label}. `));
      if (href) {
        const open = make('a', null, 'Open it');
        open.href = href;
        open.target = '_blank';
        open.rel = 'noopener';
        reportStatus.append(open, document.createTextNode(' to save it as a PDF or copy its link.'));
      }
      if (d.summaryNote) {
        reportStatus.append(document.createTextNode(` It has no plain-English summary: ${d.summaryNote}`));
      }
      loadReports();
    } catch (err) {
      reportStatus.className = 'report-status is-bad';
      reportStatus.textContent = `Could not make the report: ${err.message}`;
    } finally {
      reportMake.disabled = false;
    }
  });

  document.querySelectorAll('.seg [data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      reportPeriod = btn.dataset.period;
      document.querySelectorAll('.seg [data-period]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === btn)));
      fillChoices();
    });
  });
  fillChoices();

  /* ---- Tracking link builder -----------------------------------------------
     Tags a link with utm_source / utm_medium / utm_campaign, the three the
     site's analytics reads. Spelled the way the server stores them, so what is
     typed here is exactly what appears under Campaigns. */
  const builder = $('#builder');
  const builderPage = $('#builder-page');
  const builderOut = $('#builder-url');
  const builderCopy = $('#builder-copy');
  const slug = (v) => String(v || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');

  /** Every building page, under the site-wide ones in the HTML. */
  function fillBuilderPages() {
    const keep = builderPage.value;
    builderPage.querySelectorAll('optgroup').forEach((g) => g.remove());
    if (!buildings.size) return;
    const group = make('optgroup');
    group.label = 'Buildings';
    for (const [s, b] of byName()) {
      const o = make('option', null, b.city ? `${b.name}, ${b.city}` : b.name);
      o.value = `/properties/${s}/`;
      group.append(o);
    }
    builderPage.append(group);
    builderPage.value = keep;
    if (builderPage.value !== keep) builderPage.value = '/';
    buildLink();
  }

  function buildLink() {
    const f = builder.elements;
    const source = slug(f.source.value);
    const campaign = slug(f.campaign.value);
    if (!source || !campaign) {
      builderOut.value = '';
      builderCopy.disabled = true;
      return;
    }
    const u = new URL(f.page.value, SITE);
    u.searchParams.set('utm_source', source);
    u.searchParams.set('utm_medium', f.medium.value);
    u.searchParams.set('utm_campaign', campaign);
    builderOut.value = u.toString();
    builderCopy.disabled = false;
  }
  builder.addEventListener('input', buildLink);
  builder.addEventListener('change', buildLink);
  builder.addEventListener('submit', (e) => e.preventDefault());
  builderCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(builderOut.value);
      builderCopy.textContent = 'Copied';
    } catch {
      builderOut.select();
      builderCopy.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => { builderCopy.textContent = 'Copy'; }, 1800);
  });

  /* ---- Controls ------------------------------------------------------------ */
  document.querySelectorAll('.seg [data-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      days = Number(btn.dataset.days);
      document.querySelectorAll('.seg [data-days]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === btn)));
      load();
    });
  });

  // Charts are drawn at real pixel size rather than scaled, so they need a
  // redraw when the column width changes.
  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (!current || window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });

  /* The first request doubles as the session check: 401 shows the form. */
  async function start() {
    if (!(await load())) return;
    loadLeads();
    loadReports();
  }
  start();
})();
