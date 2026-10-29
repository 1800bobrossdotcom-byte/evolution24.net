/* =============================================================================
   Evolution24 Properties: first-party statistics. Charlotte Square's tracker,
   for a site with eleven buildings.

   Sends to /api/collect/ on this same site, which is why the Content Security
   Policy needs no outside address and why nothing leaves evolution24.net.

   What it never does: set a cookie, read one, store anything in the browser, or
   send an address. The server makes a daily-changing code to count visits and
   throws the address away. An explicit Do Not Track or Global Privacy Control
   signal turns it off. Delete this file and its <script> tag and the site is
   exactly as it was.
   ============================================================================= */
(() => {
  'use strict';

  const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  if (dnt) return;

  const ENDPOINT = '/api/collect/';
  const device = () => {
    const w = Math.min(screen.width, screen.height);
    return w <= 480 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop';
  };

  /* Campaign tags on the address they arrived at (?utm_source=facebook&…), sent
     with the pageview. Ad clicks that carry only a click id still say which
     network sent them; the id itself is never sent. */
  const utm = (() => {
    const q = new URLSearchParams(location.search);
    const out = {};
    for (const k of ['source', 'medium', 'campaign']) {
      const v = q.get(`utm_${k}`);
      if (v) out[k] = v.slice(0, 80);
    }
    if (!out.source && q.has('gclid')) Object.assign(out, { source: 'google', medium: out.medium || 'cpc' });
    if (!out.source && q.has('msclkid')) Object.assign(out, { source: 'bing', medium: out.medium || 'cpc' });
    if (!out.source && q.has('fbclid')) out.source = 'facebook';
    return Object.keys(out).length ? out : undefined;
  })();

  function send(kind, meta, property) {
    const body = JSON.stringify({
      kind,
      path: location.pathname,
      ref: document.referrer || null,
      device: device(),
      utm: kind === 'pageview' ? utm : undefined,
      property: property || undefined,
      meta: meta || undefined,
    });
    try {
      // sendBeacon survives the page closing, which matters for the clicks below:
      // they are usually the last thing to happen on a page.
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      else fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    } catch { /* a metric is never worth an error in the console */ }
  }

  // A page the browser prerendered (speculation rules) counts only once it is shown.
  if (document.prerendering) document.addEventListener('prerenderingchange', () => send('pageview'), { once: true });
  else send('pageview');

  /* ---- Named events, delegated from the document: nothing else needs to know
     this file exists. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a');
    if (a) {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('tel:')) return send('phone_click');
      if (href.startsWith('mailto:')) return send('email_click');
      if (a.hasAttribute('data-apply')) {   // Apply: the building's form, with the home chosen
        return send('apply_click', a.dataset.unit ? { unit: a.dataset.unit.slice(0, 20) } : undefined, a.dataset.property);
      }
      if (href.includes('rentmanager.com')) return send('portal_click');
      if (/google\.com\/maps|maps\.google\.com/.test(href)) return send('map_click');
      if (/^https?:/i.test(href)) {
        try {
          const host = new URL(href).hostname;
          if (host !== location.hostname) return send('outbound', { host });
        } catch { /* not a link worth counting */ }
      }
      return undefined;
    }
    const b = e.target.closest && e.target.closest('button');
    if (!b) return undefined;
    if (b.closest('[data-map]')) return send('map_click');
    if (b.closest('[data-gallery]') || b.hasAttribute('data-open-gallery')) return send('gallery_open');
    return undefined;
  }, { capture: true });

  // Which size of home a visitor filtered to: the leasing-relevant number.
  // main.js calls this from its filter chips.
  window.e24track = (kind, meta) => { if (kind === 'filter' && meta && meta.value) send('filter', { value: String(meta.value).slice(0, 20) }); };

  // The first time they touch an enquiry form: the step between reading and
  // asking, which shows whether a page loses people at the form.
  let started = false;
  document.addEventListener('focusin', (e) => {
    if (started || !e.target.closest || !e.target.closest('form[data-lead]')) return;
    started = true;
    send('form_start');
  });
})();
