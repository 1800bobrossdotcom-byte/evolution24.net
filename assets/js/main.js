/* Evolution24 Properties — every behaviour on the site, no dependencies.
   Each block checks for its own markup first, so one file serves every page. */
(() => {
  'use strict';
  const doc = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  /* ---- Scroll reveals */
  const revealables = $$('[data-reveal], .route');
  if ('IntersectionObserver' in window && !calm) {
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px', threshold: .12 });
    revealables.forEach(el => io.observe(el));
  } else revealables.forEach(el => el.classList.add('is-in'));

  /* ---- Count-up stats */
  const counters = $$('[data-count]');
  if (counters.length && !calm && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target, end = +el.dataset.count, pre = el.dataset.pre || '', t0 = performance.now();
      const delay = doc.classList.contains('is-intro') ? 2600 : 500;
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
      if (document.startViewTransition && !calm) document.startViewTransition(apply); else apply();
      if (empty) empty.hidden = shown > 0;
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
    const lb = $('.lightbox'), img = $('.lb-stage img', lb), cap = $('.lb-cap', lb), count = $('.lb-count', lb);
    let at = 0, opener = null;
    const render = () => {
      const p = data[at];
      img.src = p.src; img.srcset = p.srcset; img.alt = p.alt; img.width = p.w; img.height = p.h;
      img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
      cap.textContent = p.alt; count.textContent = `${at + 1} / ${data.length}`;
      [at + 1, at - 1].forEach(n => { const q = data[(n + data.length) % data.length]; const pre = new Image(); pre.srcset = q.srcset; pre.sizes = '100vw'; });
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

  /* ---- Map: nothing is fetched from Google until someone asks for the map. */
  $$('[data-map]').forEach(slot => {
    $('button', slot).addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = slot.dataset.map; f.title = slot.dataset.title; f.loading = 'lazy';
      f.referrerPolicy = 'no-referrer'; f.allowFullscreen = true;
      slot.replaceChildren(f);
    });
  });

  /* ---- Contact form: composes an email in the visitor's own mail app.
     No server sees it and nothing is stored. Swap for a POST once an endpoint exists. */
  const form = $('#contact-form');
  if (form) {
    const msg = $('#c-message', form), count = $('.count', form), status = $('.form-status', form);
    const upd = () => { count.textContent = `${msg.value.length} / ${msg.maxLength}`; };
    msg.addEventListener('input', upd); upd();
    const pre = new URLSearchParams(location.search).get('property');
    if (pre) { const opt = $(`option[value="${CSS.escape(pre)}"]`, form); if (opt) opt.selected = true; }
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const v = id => $(id, form).value.trim();
      const subject = `Enquiry${v('#c-property') ? ' — ' + v('#c-property') : ''} from ${v('#c-first')} ${v('#c-last')}`;
      const body = [
        v('#c-message'), '',
        `Name: ${v('#c-first')} ${v('#c-last')}`,
        `Email: ${v('#c-email')}`,
        v('#c-phone') && `Phone: ${v('#c-phone')}`,
        v('#c-property') && `Property: ${v('#c-property')}`,
      ].filter(x => x !== false && x !== '').join('\n');
      location.href = `mailto:${form.dataset.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      status.textContent = 'Your email app should open with the message ready to send. If it does not, call us on 585-245-3071.';
    });
  }
})();
