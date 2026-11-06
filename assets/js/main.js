/* Evolution24 Properties — every behaviour on the site, no dependencies.
   Each block checks for its own markup first, so one file serves every page. */
(() => {
  'use strict';
  const doc = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Where this visit started: the campaign tag or outside site, and the first
     page. Kept in sessionStorage (not a cookie) for this visit only, and sent
     only with the contact form, so the team can see which ads and sites work. */
  const SOURCE_KEY = 'e24-source';
  try {
    if (!sessionStorage.getItem(SOURCE_KEY)) {
      const q = new URLSearchParams(location.search), src = { landing: location.pathname };
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(k => { if (q.get(k)) src[k] = q.get(k).slice(0, 120); });
      try { const r = document.referrer && new URL(document.referrer); if (r && r.host !== location.host) src.ref = r.host; } catch { /* no referrer */ }
      sessionStorage.setItem(SOURCE_KEY, JSON.stringify(src));
    }
  } catch { /* storage blocked: the form still works, just without this */ }
  const visitSource = () => { try { return JSON.parse(sessionStorage.getItem(SOURCE_KEY) || '{}'); } catch { return {}; } };

  /* ---- Intro: runs once per visit (the head script decides). Click or any key skips it. */
  const intro = $('.intro');
  if (intro && doc.classList.contains('is-intro')) {
    const done = () => { intro.classList.add('is-done'); doc.classList.remove('is-intro'); };
    intro.addEventListener('animationend', e => { if (e.animationName === 'intro-out') done(); });
    intro.addEventListener('click', done);
    addEventListener('keydown', done, { once: true });
    setTimeout(done, 3600); // belt and braces: never leave a curtain up
  }

  /* ---- Header: goes solid past the hero, hides on scroll down, returns on scroll up. */
  const header = $('.site-header');
  if (header) {
    let last = scrollY, ticking = false;
    const onScroll = () => {
      const y = scrollY;
      header.classList.toggle('is-solid', y > 40);
      header.classList.toggle('is-hidden', y > 400 && y > last && !document.body.classList.contains('menu-open'));
      last = y; ticking = false;
    };
    addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(onScroll); ticking = true; } }, { passive: true });
    onScroll();
  }

  /* ---- Mobile menu */
  const menuBtn = $('.menu-btn');
  if (menuBtn) {
    const set = open => {
      document.body.classList.toggle('menu-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      $('.drawer').toggleAttribute('inert', !open);
    };
    set(false);
    menuBtn.addEventListener('click', () => set(!document.body.classList.contains('menu-open')));
    addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
    $$('.drawer a').forEach(a => a.addEventListener('click', () => set(false)));
  }

  /* ---- Scroll reveals (under reduced motion the CSS turns them into plain fades)
     A clip reveal starts fully clipped, and Chrome's IntersectionObserver never reports a fully
     clipped element as visible, so those are triggered by their parent, which is never clipped. */
  const revealables = $$('[data-reveal], .route');
  const reveals = new Map(); // watched element → the elements it reveals
  revealables.forEach(el => {
    const watch = el.dataset.reveal === 'clip' ? el.parentElement : el;
    if (!reveals.has(watch)) reveals.set(watch, []);
    reveals.get(watch).push(el);
  });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      reveals.get(e.target).forEach(el => el.classList.add('is-in'));
      io.unobserve(e.target);
    }), { rootMargin: '0px 0px -10% 0px', threshold: 0 });
    reveals.forEach((_, watch) => io.observe(watch));
  } else revealables.forEach(el => el.classList.add('is-in'));

  /* ---- Count-up stats */
  const counters = $$('[data-count]');
  if (counters.length && !calm && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target, end = +el.dataset.count, pre = el.dataset.pre || '', t0 = performance.now();
      const delay = doc.classList.contains('is-intro') ? (matchMedia('(max-width: 760px)').matches ? 1500 : 2600) : 500;
      const tick = t => {
        const p = Math.min(1, Math.max(0, (t - t0 - delay) / 1400));
        const v = Math.round(end * (1 - Math.pow(1 - p, 4)));
        el.textContent = pre + v.toLocaleString('en-US');
        if (p < 1) requestAnimationFrame(tick);
      };
      el.textContent = pre + '0';
      requestAnimationFrame(tick);
    }));
    counters.forEach(c => io.observe(c));
  }

  /* ---- Hero slideshow */
  const slides = $$('.hero-slide');
  if (slides.length > 1) {
    const dots = $$('.hero-dots button'), cap = $('.hero-caption');
    let i = 0, timer;
    const show = n => {
      slides[i].classList.remove('is-active'); dots[i] && dots[i].classList.remove('is-active');
      i = (n + slides.length) % slides.length;
      const s = slides[i], img = $('img', s);
      if (img.loading === 'lazy') img.loading = 'eager';
      s.classList.add('is-active'); dots[i] && dots[i].classList.add('is-active');
      if (cap) cap.innerHTML = s.dataset.caption;
    };
    const play = () => { clearInterval(timer); if (!calm) timer = setInterval(() => show(i + 1), 6500); };
    dots.forEach((d, n) => d.addEventListener('click', () => { show(n); play(); }));
    document.addEventListener('visibilitychange', () => document.hidden ? clearInterval(timer) : play());
    // Warm the next slide's image once the page is idle, not before.
    const warm = () => slides.forEach(s => { const im = $('img', s); if (im.loading === 'lazy') im.loading = 'eager'; });
    setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(warm) : warm()), 3000);
    play();
  }

  /* ---- Filters: any [data-filter-group] of chips filters the [data-filter-items] it names. */
  $$('[data-filter-group]').forEach(group => {
    const items = $$(`[data-filter-items="${group.dataset.filterGroup}"] [data-tags]`);
    const empty = $(`[data-filter-empty="${group.dataset.filterGroup}"]`);
    $$('.chip', group).forEach(chip => chip.addEventListener('click', () => {
      $$('.chip', group).forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
      const want = chip.dataset.value;
      const hits = items.map(it => want === 'all' || it.dataset.tags.split(' ').includes(want));
      const shown = hits.filter(Boolean).length;
      const apply = () => items.forEach((it, n) => it.classList.toggle('is-filtered-out', !hits[n]));
      if (document.startViewTransition) document.startViewTransition(apply); else apply();
      if (empty) empty.hidden = shown > 0;
      group.dispatchEvent(new CustomEvent('e24:filter', { bubbles: true, detail: { value: want } }));
      if (window.e24track) window.e24track('filter', { value: want });
    }));
  });

  /* ---- /properties/?region=geneva arrives pre-filtered (links from the home page). */
  const region = new URLSearchParams(location.search).get('region');
  if (region) { const chip = $(`[data-filter-group="props"] .chip[data-value="${CSS.escape(region)}"]`); if (chip) chip.click(); }

  /* ---- Lightbox for property galleries */
  const gallery = $('[data-gallery]');
  if (gallery) {
    const data = JSON.parse($('#gallery-data').textContent);
    const lb = $('.lightbox'), img = $('.lb-stage img', lb), avif = $('.lb-stage source', lb), cap = $('.lb-cap', lb), count = $('.lb-count', lb);
    let at = 0, opener = null;
    // Fetches a photo the way the stage would show it (AVIF where the browser takes it), so the
    // next swipe is instant. A detached <picture> loads like a detached new Image() does.
    const warm = q => {
      const pic = document.createElement('picture'), s = document.createElement('source'), im = new Image();
      pic.append(s, im); s.type = 'image/avif'; s.srcset = q.avif; im.srcset = q.srcset;
    };
    const render = () => {
      const p = data[at];
      avif.srcset = p.avif; img.src = p.src; img.srcset = p.srcset; img.alt = p.alt; img.width = p.w; img.height = p.h;
      img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
      cap.textContent = p.alt; count.textContent = `${at + 1} / ${data.length}`;
      [at + 1, at - 1].forEach(n => warm(data[(n + data.length) % data.length]));
    };
    const open = n => { opener = document.activeElement; at = n; render(); lb.classList.add('is-open'); lb.removeAttribute('inert'); document.body.classList.add('lb-open'); $('.lb-close', lb).focus(); };
    const close = () => { lb.classList.remove('is-open'); lb.setAttribute('inert', ''); document.body.classList.remove('lb-open'); opener && opener.focus(); };
    const step = d => { at = (at + d + data.length) % data.length; render(); };
    $$('button[data-index]', gallery).forEach(b => b.addEventListener('click', () => open(+b.dataset.index)));
    $('[data-open-gallery]') && $('[data-open-gallery]').addEventListener('click', () => open(0));
    $('.lb-close', lb).addEventListener('click', close);
    $('.lb-prev', lb).addEventListener('click', () => step(-1));
    $('.lb-next', lb).addEventListener('click', () => step(1));
    lb.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'Tab') { // keep focus inside the dialog
        const f = $$('button', lb), first = f[0], lastB = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastB.focus(); }
        else if (!e.shiftKey && document.activeElement === lastB) { e.preventDefault(); first.focus(); }
      }
    });
    let x0 = null;
    $('.lb-stage', lb).addEventListener('pointerdown', e => { x0 = e.clientX; });
    $('.lb-stage', lb).addEventListener('pointerup', e => { if (x0 !== null && Math.abs(e.clientX - x0) > 50) step(e.clientX < x0 ? 1 : -1); x0 = null; });
  }

  /* ---- Quick bar (property pages, phones only): slides up once the hero's own buttons have
     scrolled away, and back down over the closing call to action and the footer, which carry
     the same buttons. Inert while hidden, so nobody tabs or swipes into a bar they cannot see. */
  const mbar = $('[data-mbar]');
  if (mbar && 'IntersectionObserver' in window) {
    const acts = $('.p-hero .hero-actions') || $('.p-hero'), over = new Set();
    let past = false;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.target === acts) past = !e.isIntersecting && e.boundingClientRect.top < 0;
        else if (e.isIntersecting) over.add(e.target); else over.delete(e.target);
      });
      const on = past && !over.size;
      mbar.classList.toggle('is-on', on);
      mbar.toggleAttribute('inert', !on);
    });
    [acts, ...$$('.cta, .site-footer')].forEach(el => el && io.observe(el));
  }

  /* ---- Map: nothing is fetched from Google until someone asks for the map. */
  $$('[data-map]').forEach(slot => {
    $('button', slot).addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = slot.dataset.map; f.title = slot.dataset.title; f.loading = 'lazy';
      f.referrerPolicy = 'no-referrer'; f.allowFullscreen = true;
      slot.replaceChildren(f);
    });
  });

  /* ---- The Properties map: the list beside a map with a numbered pin for each building.
     Leaflet (ours, in /assets/vendor/) and the street tiles (OpenStreetMap's) load only once
     the map is about to come on screen; the list works without them. The chips above filter
     both. Zoomed out, the pins gather into one bubble per city, which zooms in when pressed. */
  const finder = $('[data-finder]');
  if (finder && 'IntersectionObserver' in window) {
    const { homes, regions } = JSON.parse($('#finder-data').textContent);
    const name = finder.dataset.finder;
    const chips = $(`[data-filter-group="${name}"]`);
    const rows = new Map($$(`[data-filter-items="${name}"] [data-slug]`).map(li => [li.dataset.slug, li]));
    const wide = matchMedia('(min-width: 981px)');
    const touch = matchMedia('(pointer: coarse)').matches;
    const CITY_ZOOM = 11;                          // below this, one bubble per city
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    const fetchOne = (tag, attrs) => new Promise((ok, no) => {
      const n = Object.assign(document.createElement(tag), attrs);
      n.onload = ok; n.onerror = no; document.head.append(n);
    });

    const draw = () => {
      const L = window.L;
      const map = L.map($('.fm-stage', finder), {
        scrollWheelZoom: false, dragging: !touch, zoomSnap: 0.5, zoomDelta: 1,
        zoomAnimation: !calm, fadeAnimation: !calm, markerZoomAnimation: !calm,
      });
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" rel="noopener">Leaflet</a>');
      L.tileLayer(finder.dataset.tiles, {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> contributors',
      }).addTo(map);

      const popup = h => {
        const box = el('div', 'fm-pop'), pic = el('a'), img = new Image(), body = el('div');
        pic.href = h.url; pic.tabIndex = -1; pic.setAttribute('aria-hidden', 'true');
        img.src = h.img; img.alt = ''; img.decoding = 'async'; pic.append(img);
        body.append(el('span', 'kicker', `${String(h.n).padStart(2, '0')} · ${h.area}`), el('h3', '', h.name));
        if (h.rent) {
          const price = el('p', 'fm-price'); price.append(el('b', '', h.rent), '/mo', h.beds ? ` · ${h.beds}` : '');
          body.append(price);
        } else if (h.beds) body.append(el('p', '', h.beds));
        body.append(el('p', '', h.status));
        const go = el('p', 'fm-go'), cta = el('a', 'btn btn--solid', h.cta[0]), see = el('a', 'link', 'See the building');
        cta.href = h.cta[1];
        if (h.ext) cta.rel = 'noopener';
        else if (h.open) { cta.setAttribute('data-apply', ''); cta.dataset.property = h.slug; }
        see.href = h.url;
        go.append(cta, see); body.append(go); box.append(pic, body);
        return box;
      };

      const pins = new Map();
      const hot = (slug, on) => {
        const r = rows.get(slug), m = pins.get(slug), icon = m && m.getElement();
        if (r) r.classList.toggle('is-hot', on);
        if (icon) icon.classList.toggle('is-hot', on);
        if (m) m.setZIndexOffset(on ? 1000 : 0);
      };
      homes.forEach(h => {
        const face = el('span'); face.append(el('b', '', String(h.n).padStart(2, '0')));
        const m = L.marker(h.at, {
          icon: L.divIcon({ className: `e24-pin${h.open || h.ext ? '' : ' is-off'}`, html: face, iconSize: [34, 34], iconAnchor: [17, 40], popupAnchor: [0, -38] }),
          title: `${h.name}: ${h.rent ? `${h.rent} a month, ` : ''}${h.status.toLowerCase()}`, keyboard: true,
        });
        m.bindPopup(() => popup(h), { minWidth: 240, maxWidth: 270, autoPanPaddingTopLeft: [16, 16], autoPanPaddingBottomRight: [16, 16] });
        m.on('popupopen', () => {
          hot(h.slug, true);
          const r = rows.get(h.slug);
          if (r && wide.matches) r.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
          if (window.e24track) window.e24track('map_click', { property: h.slug });
        });
        m.on('popupclose', () => hot(h.slug, false));
        pins.set(h.slug, m);
      });

      // What the chips show, and the pins or city bubbles for it at this zoom.
      let shown = new Set();
      const choose = value => {
        shown = new Set(homes.filter(h => {
          const r = rows.get(h.slug);
          return value === 'all' || (r && r.dataset.tags.split(' ').includes(value));
        }).map(h => h.slug));
      };
      const pinLayer = L.layerGroup().addTo(map), cityLayer = L.layerGroup().addTo(map);
      const cities = new Map();
      const layout = () => {
        const far = map.getZoom() < CITY_ZOOM;
        pins.forEach((m, slug) => {
          const want = !far && shown.has(slug);
          if (want && !pinLayer.hasLayer(m)) pinLayer.addLayer(m);
          else if (!want && pinLayer.hasLayer(m)) pinLayer.removeLayer(m);
        });
        cityLayer.clearLayers(); cities.clear();
        if (!far) return;
        const by = {};
        homes.filter(h => shown.has(h.slug)).forEach(h => { (by[h.region] = by[h.region] || []).push(h); });
        Object.entries(by).forEach(([key, hs]) => {
          const at = [hs.reduce((a, h) => a + h.at[0], 0) / hs.length, hs.reduce((a, h) => a + h.at[1], 0) / hs.length];
          // On a narrow map, "Syracuse" for "Syracuse & Manlius": three full names do not fit side by side.
          const face = el('span'); face.append(el('b', '', String(hs.length)), wide.matches ? regions[key] : regions[key].split(' & ')[0]);
          const m = L.marker(at, {
            icon: L.divIcon({ className: 'e24-area', html: face, iconSize: null }),
            title: `${regions[key]}: ${hs.length} ${hs.length === 1 ? 'building' : 'buildings'}. Press to zoom in.`, keyboard: true,
          });
          m.on('click', () => frame(hs));
          cityLayer.addLayer(m); cities.set(key, m);
        });
      };
      const frame = (list, animate = !calm) => {
        if (!list.length) return;
        const points = list.map(h => h.at);
        // Across cities the map shows their bubbles, which need room for their names.
        const across = new Set(list.map(h => h.region)).size > 1;
        const pad = across ? (wide.matches ? [120, 60] : [64, 44]) : (wide.matches ? [64, 64] : [40, 40]);
        if (points.length === 1) map.setView(points[0], 16, { animate });
        else map.fitBounds(L.latLngBounds(points), { padding: pad, maxZoom: 16, animate });
      };
      const fit = animate => frame(homes.filter(h => shown.has(h.slug)), animate);
      map.on('zoomend', layout);

      const pressed = chips && $('.chip[aria-pressed="true"]', chips);
      choose(pressed ? pressed.dataset.value : 'all');
      fit(false);
      layout();
      document.addEventListener('e24:filter', e => {
        if (e.target !== chips) return;
        map.closePopup();
        choose(e.detail.value);
        layout();
        fit();
      });

      // The list and the map, each pointing at the other.
      rows.forEach((r, slug) => {
        const h = homes.find(x => x.slug === slug);
        if (matchMedia('(hover: hover)').matches) {
          r.addEventListener('mouseenter', () => { hot(slug, true); const c = cities.get(h.region); if (c && c.getElement()) c.getElement().classList.add('is-hot'); });
          r.addEventListener('mouseleave', () => { hot(slug, pins.get(slug).isPopupOpen()); cities.forEach(c => c.getElement() && c.getElement().classList.remove('is-hot')); });
        }
        const b = $('[data-locate]', r);
        if (!b) return;
        b.hidden = false;
        b.addEventListener('click', () => {
          const m = pins.get(slug);
          if (!wide.matches) finder.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
          map.closePopup();
          map.once('moveend', () => { if (pinLayer.hasLayer(m)) m.openPopup(); });
          map.setView(m.getLatLng(), Math.max(map.getZoom(), 16), { animate: !calm });
        });
      });

      // A page scrolls under a finger, so on a touch screen the map moves with two (as Google's do).
      if (touch) {
        const hint = el('p', 'fm-hint', 'Use two fingers to move the map');
        finder.append(hint);
        let t;
        $('.fm-stage', finder).addEventListener('touchmove', e => {
          if (e.touches.length !== 1) return;
          finder.classList.add('show-hint'); clearTimeout(t);
          t = setTimeout(() => finder.classList.remove('show-hint'), 1300);
        }, { passive: true });
      } else {
        // Nor does the wheel zoom it until someone has clicked into it.
        map.on('click focus', () => map.scrollWheelZoom.enable());
        map.on('mouseout blur', () => map.scrollWheelZoom.disable());
      }
      if ('ResizeObserver' in window) new ResizeObserver(() => map.invalidateSize()).observe(finder);
      finder.classList.add('is-ready');
    };

    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      Promise.all([fetchOne('link', { rel: 'stylesheet', href: finder.dataset.css }), fetchOne('script', { src: finder.dataset.js })])
        .then(draw).catch(() => finder.classList.add('is-failed'));
    }, { rootMargin: '400px 0px' });
    // A prerendered page (speculation rules) asks OpenStreetMap for nothing until it is shown.
    if (document.prerendering) document.addEventListener('prerenderingchange', () => io.observe(finder), { once: true });
    else io.observe(finder);
  }

  /* ---- Enquiry forms: the contact page's and each building's own. Both post to
     /api/inquiry/, which saves the enquiry, puts it on the building's tab of the
     lead sheet and emails the leasing team. Without JavaScript the same forms post
     natively and the endpoint sends the browser back to #sent or #not-sent. */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  $$('form[data-lead]').forEach(form => {
    const msg = $('textarea[name="message"]', form), count = $('.count', form), status = $('.form-status', form);
    const upd = () => { if (msg && count) count.textContent = `${msg.value.length} / ${msg.maxLength}`; };
    if (msg) { msg.addEventListener('input', upd); upd(); }
    // Moving in: the next six months, between "As soon as possible" and "Later".
    $$('select[data-months]', form).forEach(sel => {
      const later = $('option[value="later"]', sel), now = new Date();
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const o = document.createElement('option');
        o.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        o.textContent = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        sel.insertBefore(o, later);
      }
    });
    // ?property=water-street&interest=waitlist&unit=73, from links elsewhere on the site
    const q = new URLSearchParams(location.search);
    ['property', 'interest', 'unit'].forEach(k => {
      const v = q.get(k), opt = v && $(`select[name="${k}"] option[value="${CSS.escape(v)}"]`, form);
      if (opt) opt.selected = true;
    });
    const src = visitSource();
    Object.keys(src).forEach(k => { if (form.elements[k] && form.elements[k].type === 'hidden') form.elements[k].value = src[k]; });
    const fail = text => { status.textContent = text; status.classList.add('is-error'); };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      form.classList.add('is-sending'); status.classList.remove('is-error'); status.textContent = 'Sending…';
      try {
        const res = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
        const out = await res.json().catch(() => ({}));
        if (res.ok && out.ok) {
          const sent = $('#sent');
          $('.flash-name', sent).textContent = data.first_name ? `, ${data.first_name}` : '';
          form.reset(); upd(); status.textContent = '';
          location.hash = 'sent';
          sent.focus();
        } else fail(out.error || 'Sorry, your message did not go through. Please call us on 585-759-7117.');
      } catch {
        fail('Sorry, your message did not go through. Please check your connection, or call us on 585-759-7117.');
      } finally {
        form.classList.remove('is-sending');
      }
    });
  });

  /* ---- The leasing special: a dialog once a visit, a little after the page (and the intro)
     has settled; the header's "½ off" brings it back. It counts down to its last day and goes,
     Eastern time, even on a page built before that day. */
  const deal = $('#deal');
  if (deal && typeof deal.showModal === 'function') {
    const until = deal.dataset.until;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    if (today > until) { deal.remove(); $$('.deal-note, [data-deal-open], .u-special').forEach(n => n.remove()); }
    else {
      const days = Math.round((Date.parse(until) - Date.parse(today)) / 864e5);
      const left = days === 0 ? 'Last day: ends tonight' : days === 1 ? 'Ends tomorrow' : `${days} days left`;
      $$('[data-deal-left]').forEach(el => { el.textContent = left; });
      const track = kind => { if (window.e24track) window.e24track(kind); };
      const KEY = 'e24-deal';
      let seen = true;
      try { seen = sessionStorage.getItem(KEY) === '1'; } catch { /* no storage: never nag; the header's button stays */ }
      const open = () => { if (deal.open) return; deal.showModal(); track('deal_open'); };
      deal.addEventListener('close', () => { try { sessionStorage.setItem(KEY, '1'); } catch { /* fine */ } });
      deal.addEventListener('click', e => {
        if (e.target === deal) deal.close();                 // the backdrop
        else if (e.target.closest('a')) { track('deal_click'); deal.close(); }
      });
      $$('[data-deal-open]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); open(); }));
      if (!seen) {
        const later = () => setTimeout(() => {
          if (!doc.classList.contains('is-intro') && !document.body.classList.contains('menu-open') && !$('dialog[open]')) open();
          else later();
        }, 2500);
        if (document.prerendering) document.addEventListener('prerenderingchange', later, { once: true });
        else later();
      }
    }
  }

  /* ---- Apply, on the building's own page: chooses the home and "Applying" in its form
     and goes there, without loading the page again. From anywhere else the link loads
     the building's page, whose form reads the same choices from the address. */
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[data-apply]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const to = new URL(a.href, location.href), form = $('#enquire form[data-lead]');
    if (to.pathname !== location.pathname || !form) return;
    e.preventDefault();
    to.searchParams.forEach((v, k) => {
      const opt = $(`select[name="${k}"] option[value="${CSS.escape(v)}"]`, form);
      if (opt) opt.selected = true;
    });
    history.replaceState(null, '', `${location.pathname}${location.search}#enquire`);
    $('#enquire').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    // A keyboard on a phone would cover the choices just made, so only where there is a mouse.
    const first = $('input:not([type="hidden"])', form);
    if (first && matchMedia('(hover: hover)').matches) first.focus({ preventScroll: true });
  });
})();
