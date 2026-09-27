// The Story's timeline. render(t) sets every element for time t (seconds), so any
// frame can be drawn on its own, in any order. Nothing here runs on a clock.
'use strict';
const S = window.STORY;
const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const inv = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const E = {
  outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  inExpo: (p) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10)),
  outQuart: (p) => 1 - Math.pow(1 - p, 4),
  outCubic: (p) => 1 - Math.pow(1 - p, 3),
  inCubic: (p) => p * p * p,
  inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outBack: (p) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
};
const B = S.beat;
const DROP = S.drop;
const shots = S.shots;                      // montage, each two beats
const FLAG = DROP + 2 * shots.length * B;   // Charlotte Square, one bar
const CTA = FLAG + 4 * B;                   // "Let's find your place", one bar
const SLAM = CTA + 4 * B;                   // the logo lands here
const px = (v) => `${v.toFixed(2)}px`;
const show = (el, on) => { el.style.visibility = on ? 'visible' : 'hidden'; };
// a word that rises into place, like the site's intro: up from below, out of a blur
function rise(el, t, t0, dur = 0.5, dist = 60, blur = 10) {
  const p = E.outQuart(inv(t, t0, t0 + dur));
  el.style.opacity = p.toFixed(3);
  el.style.transform = `translateY(${px((1 - p) * dist)})`;
  if (!(el instanceof SVGElement)) el.style.filter = p < 1 ? `blur(${px((1 - p) * blur)})` : 'none';
}
// a deterministic wobble for camera shake
const wob = (t, f, ph) => Math.sin(t * f * 6.2832 + ph) * 0.6 + Math.sin(t * f * 2.71 * 6.2832 + ph * 1.7) * 0.4;

// ---------------------------------------------------------------- intro
let dot = null;   // centre of the full stop in "home.", measured once the font is in
function measure() {
  const sp = S.fontSize * 0.25;             // a word space at the title's size
  $('t-evolution').setAttribute('x', (S.titleX + $('t-an').getComputedTextLength() + sp).toFixed(1));
  $('t-home').setAttribute('x', (S.titleX + $('t-in').getComputedTextLength() + sp).toFixed(1));
  $('t-hometan').setAttribute('x', $('t-home').getAttribute('x'));
  const home = $('t-home');
  const bb = home.getBBox();
  const r = S.dotR;
  const cx = bb.x + bb.width + r * 1.25, cy = S.line2 - r * 1.05;
  for (const id of ['t-dot', 't-dottan']) { $(id).setAttribute('cx', cx.toFixed(1)); $(id).setAttribute('cy', cy.toFixed(1)); $(id).setAttribute('r', r); }
  dot = { x: cx, y: cy };
}
function intro(t) {
  const on = t < DROP;
  show($('intro'), on);
  if (!on) return;
  if (!dot) measure();
  const words = [['t-an', 0.02, 0.55], ['t-evolution', B, 0.55], ['t-in', 2 * B, 0.55], ['t-homeg', 3 * B, 0.3]];
  for (const [id, t0, d] of words) rise($(id), t, t0, d, 70, 12);
  rise($('t-lab'), t, 0.0, 0.7, 24, 6);
  rise($('t-cities'), t, 2 * B, 0.6, 20, 6);
  $('t-rule').style.transform = `scaleX(${E.outExpo(inv(t, 0.05, 1.2)).toFixed(4)})`;
  // zoom through the full stop into the first photo, landing on the drop
  const z0 = DROP - 0.36;
  const p = inv(t, z0, DROP);
  const s = Math.exp(Math.log(S.zoomTo) * E.inExpo(p));
  const tf = `translate(${dot.x} ${dot.y}) scale(${s.toFixed(4)}) translate(${-dot.x} ${-dot.y})`;
  $('t-zoom').setAttribute('transform', tf);
  $('t-maskzoom').setAttribute('transform', tf);
  $('t-tanzoom').setAttribute('transform', tf);
  const fill = E.inOutCubic(inv(t, z0 - 0.15, z0 + 0.03));   // the photo pours into the letters
  $('t-homeimg').setAttribute('opacity', fill.toFixed(3));
  $('t-tanzoom').setAttribute('opacity', (1 - fill).toFixed(3));
  $('t-others').style.opacity = (1 - E.outCubic(inv(t, z0 + 0.04, z0 + 0.24))).toFixed(3);
}

// ---------------------------------------------------------------- montage
function kenburns(img, t, a, b, kb) {
  const p = inv(t, a, b);
  const k = lerp(kb[0], kb[1], p);
  img.style.transform = `translate(${px(kb[2] * p)}, ${px(kb[3] * p)}) scale(${k.toFixed(4)})`;
}
function diagPoly(c) {   // the part of the frame where x - y <= c, as a polygon
  const pts = [[0, 0], [S.W, 0], [S.W, S.H], [0, S.H]];
  const inside = (q) => q[0] - q[1] <= c;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    if (inside(a)) out.push(a);
    const fa = a[0] - a[1] - c, fb = b[0] - b[1] - c;
    if ((fa < 0) !== (fb < 0)) { const u = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
  }
  if (out.length < 3) return 'polygon(0 0, 0 0, 0 0)';
  return 'polygon(' + out.map((q) => `${q[0].toFixed(1)}px ${q[1].toFixed(1)}px`).join(',') + ')';
}
function montage(t) {
  shots.forEach((sh, i) => {
    const a = DROP + 2 * i * B, b = a + 2 * B;
    const next = shots[i + 1];
    const layer = $(`shot${i}`);
    const lead = { strips: 0.14, whip: 0.14, frame: 0.1, diag: 0.1, punch: 0, dot: 0 }[sh.trans];
    const tail = next ? { strips: 0.6, whip: 0.2, frame: 0.2, diag: 0.5, punch: 0.02, dot: 0 }[next.trans] : FLAG + 1.2 * B - b;
    const on = t >= a - lead && t < b + tail;
    show(layer, on);
    if (!on) return;
    const img = layer.querySelectorAll('img');
    img.forEach((im) => kenburns(im, t, a, b + 0.5, sh.kb));
    layer.style.transform = 'none'; layer.style.filter = 'none'; layer.style.clipPath = 'none';
    // how this shot comes in
    if (sh.trans === 'strips') {
      layer.querySelectorAll('.strip').forEach((st, k) => {
        const p = E.outExpo(inv(t, a - lead + k * 0.035, a - lead + k * 0.035 + 0.5));
        st.style.transform = `translateY(${px((1 - p) * S.H)})`;
      });
    } else if (sh.trans === 'whip') {
      const p = E.inOutCubic(inv(t, a - 0.14, a + 0.16));
      layer.style.transform = `translateX(${px((1 - p) * S.W)})`;
    } else if (sh.trans === 'frame') {
      const pb = E.outExpo(inv(t, a - 0.1, a + 0.35));
      layer.querySelector('.bg').style.clipPath = `inset(${((1 - pb) * 100).toFixed(2)}% 0 0 0)`;
      const pw = E.outExpo(inv(t, a, a + 0.5));
      layer.querySelector('.panel').style.clipPath = `inset(${((1 - pw) * 50).toFixed(2)}% 0 ${((1 - pw) * 50).toFixed(2)}% 0)`;
      const k = lerp(1.2, 1.0, E.outCubic(inv(t, a, b + 0.3)));
      img[0].style.transform = `scale(${k.toFixed(4)})`;
    } else if (sh.trans === 'diag') {
      const p = E.outExpo(inv(t, a - 0.1, a + 0.4));
      const c = lerp(-S.H - 40, S.W + 60, p);
      layer.style.clipPath = diagPoly(c);
      const edge = $(`edge${i}`);
      show(edge, p > 0 && p < 1);
      edge.style.clipPath = diagPoly(c + 46);
    } else if (sh.trans === 'punch') {
      const p = E.outExpo(inv(t, a, a + 0.4));
      img[0].style.transform = `scale(${lerp(1.22, 1.0, p).toFixed(4)})`;
    }
    // how it leaves: the next whip carries it off to the left
    if (next && next.trans === 'whip') {
      const p = E.inOutCubic(inv(t, b - 0.14, b + 0.16));
      if (p > 0) layer.style.transform = `translateX(${px(-p * S.W)})`;
    }
  });
  // the whip's motion blur, strongest mid-swing
  let blur = 0;
  shots.forEach((sh, i) => { if (sh.trans === 'whip') { const a = DROP + 2 * i * B; blur = Math.max(blur, Math.sin(Math.PI * inv(t, a - 0.14, a + 0.16)) * 70); } });
  $('whipblur').setAttribute('stdDeviation', `${blur.toFixed(1)} 0`);
  shots.forEach((sh, i) => { if (sh.trans === 'whip' || (shots[i + 1] && shots[i + 1].trans === 'whip')) $(`shot${i}`).style.filter = blur > 0.5 ? 'url(#whip)' : 'none'; });
  // labels
  shots.forEach((sh, i) => {
    const a = DROP + 2 * i * B, b = a + 2 * B;
    const lab = $(`label${i}`);
    const on = t >= a && t < b + 0.05;
    show(lab, on);
    if (!on) return;
    const t0 = a + (sh.trans === 'frame' ? 0.22 : 0.1);
    rise(lab.querySelector('.ct'), t, t0, 0.45, 18, 4);
    lab.querySelector('.ct i').style.transform = `scaleX(${E.outExpo(inv(t, t0, t0 + 0.6)).toFixed(3)})`;
    rise(lab.querySelector('.nm'), t, t0 + 0.05, 0.5, 50, 10);
    const pm = E.outQuart(inv(t, t0 + 0.12, t0 + 0.7));
    const mt = lab.querySelector('.mt');
    mt.style.opacity = pm.toFixed(3);
    mt.style.letterSpacing = `${lerp(0.55, 0.26, pm).toFixed(3)}em`;
    const out = E.inCubic(inv(t, b - 0.14, b));
    lab.style.opacity = (1 - out).toFixed(3);
    lab.style.transform = `translateY(${px(out * 24)})`;
  });
}

// ---------------------------------------------------------------- flagship
function flagship(t) {
  const f = [FLAG, FLAG + B, FLAG + 2 * B, FLAG + 3 * B];
  const on = t >= FLAG - 0.14 && t < CTA + 0.45;
  ['flag0', 'flag1', 'flag2', 'flaglabel', 'flagtop'].forEach((id) => show($(id), on));
  if (!on) return;
  const L0 = $('flag0'), L1 = $('flag1'), L2 = $('flag2');
  // push the last montage shot back while the card rises
  const last = $(`shot${shots.length - 1}`);
  const pd = E.outCubic(inv(t, FLAG - 0.14, FLAG + 0.4));
  last.style.filter = `brightness(${lerp(1, 0.32, pd).toFixed(3)}) blur(${px(pd * 6)})`;
  // the card rises, then opens to the full frame on the next beat
  const pr = E.outExpo(inv(t, FLAG - 0.14, FLAG + 0.36));
  const po = E.inOutCubic(inv(t, f[1] - 0.06, f[1] + 0.42));
  const card = S.card;
  const ins = [lerp(card.top, 0, po), lerp(card.side, 0, po), lerp(card.bottom, 0, po), lerp(card.side, 0, po)];
  L0.style.clipPath = `inset(${ins.map(px).join(' ')})`;
  L0.style.transform = `translateY(${px((1 - pr) * S.H * 0.47)})`;
  kenburns(L0.querySelector('img'), t, FLAG - 0.14, f[2], [1.14, 1.02, 0, 0]);
  // two quick cuts inside, each punched in on its beat
  [[L1, f[2]], [L2, f[3]]].forEach(([L, a]) => {
    show(L, t >= a && t < CTA + 0.45);
    const p = E.outExpo(inv(t, a, a + 0.38));
    L.querySelector('img').style.transform = `scale(${(lerp(1.2, 1.02, p) + 0.04 * inv(t, a + 0.38, CTA)).toFixed(4)})`;
  });
  const top = $('flagtop');
  rise(top, t, FLAG + 0.08, 0.5, 24, 6);
  top.style.opacity = ((1 - E.outCubic(inv(t, f[1], f[1] + 0.25))) * Number(top.style.opacity || 0)).toFixed(3);
  const lab = $('flaglabel');
  rise(lab.querySelector('.ct'), t, f[1] + 0.22, 0.45, 18, 4);
  lab.querySelector('.ct i').style.transform = `scaleX(${E.outExpo(inv(t, f[1] + 0.22, f[1] + 0.8)).toFixed(3)})`;
  rise(lab.querySelector('.nm'), t, f[1] + 0.27, 0.55, 50, 10);
  const pm = E.outQuart(inv(t, f[1] + 0.34, f[1] + 0.9));
  const mt = lab.querySelector('.mt');
  mt.style.opacity = pm.toFixed(3); mt.style.letterSpacing = `${lerp(0.55, 0.26, pm).toFixed(3)}em`;
}

// ---------------------------------------------------------------- call to action, then the fold
function cta(t) {
  const c = [CTA, CTA + B, CTA + 2 * B, CTA + 3 * B];
  const on = t >= CTA - 0.14 && t < SLAM + 0.02;
  show($('cta'), on);
  show($('cta-fold'), on);
  if (!on) return;
  const pw = E.outExpo(inv(t, CTA - 0.14, CTA + 0.32));
  $('cta-paper').style.clipPath = `inset(${((1 - pw) * 100).toFixed(2)}% 0 0 0)`;
  $('cta-edge').style.clipPath = `inset(${Math.max(0, (1 - pw) * 100 - 1.6).toFixed(2)}% 0 0 0)`;
  rise($('c-lab'), t, c[0] + 0.02, 0.5, 20, 4);
  rise($('c-l1'), t, c[0] + 0.06, 0.55, 70, 12);
  rise($('c-l2'), t, c[1], 0.55, 70, 12);
  $('c-rule').style.transform = `scaleX(${E.outExpo(inv(t, c[2], c[2] + 0.6)).toFixed(4)})`;
  rise($('c-url'), t, c[2] + 0.04, 0.5, 40, 8);
  rise($('c-bio'), t, c[2] + 0.22, 0.5, 16, 4);
  // the music brakes; the page folds into the line the logo lands on
  const pf = E.inCubic(inv(t, c[3], c[3] + 0.42));
  const ps = E.inOutCubic(inv(t, c[3] + 0.42, SLAM - 0.04));
  const fold = $('cta-fold');
  fold.style.transformOrigin = `${S.W / 2}px ${S.baseY}px`;
  fold.style.transform = `scaleY(${Math.max(0.0025, 1 - pf).toFixed(4)})`;
  fold.style.filter = pf > 0 ? `brightness(${lerp(1, 0.7, pf).toFixed(3)})` : 'none';
  show(fold, pf < 0.999);
  const line = $('ground');
  const lineOn = t >= c[3] + 0.36;
  if (lineOn && t < SLAM) {
    show(line, true);
    const w = lerp(S.W, S.logoW, ps);
    line.style.width = px(w); line.style.left = px(S.W / 2 - w / 2); line.style.height = '5px'; line.style.top = px(S.baseY - 2.5);
    line.style.background = ps > 0.5 ? 'var(--tan)' : 'var(--paper)'; line.style.opacity = '1';
  }
}

// ---------------------------------------------------------------- the logo slam
function slam(t) {
  const on = t >= SLAM - 0.6;
  show($('logo'), on);
  show($('ring'), false);
  if (!on) { return; }
  const pieces = document.querySelectorAll('#logo .lg-i');
  const n = pieces.length;
  pieces.forEach((el, j) => {
    const land = SLAM - (n - 1 - j) * 0.011;
    const fall = 0.15;
    const p = inv(t, land - fall, land);
    const y = -(1100 + 40 * j) * (1 - E.inCubic(p));
    const sq = t >= land ? lerp(0.66, 1, E.outBack(inv(t, land, land + 0.24))) : 1.06;
    el.style.opacity = t >= land - fall ? '1' : '0';
    el.style.transform = `translateY(${px(y)}) scaleY(${sq.toFixed(4)})`;
  });
  const words = document.querySelectorAll('#logo .lg-w');
  words.forEach((el, j) => {
    const t0 = SLAM + 0.16 + j * 0.028;
    const p = E.outQuart(inv(t, t0, t0 + 0.55));
    el.style.opacity = p.toFixed(3);
    el.style.transform = `translateY(${px((1 - p) * 34)})`;
  });
  // the "24" catches the light on the last chime
  const g = Math.exp(-Math.pow((t - (SLAM + 0.95)) / 0.12, 2));
  document.querySelectorAll('#logo .lg-w.c').forEach((el) => { el.style.fill = g > 0.02 ? `rgb(${lerp(229, 255, g) | 0},${lerp(230, 252, g) | 0},${lerp(211, 240, g) | 0})` : ''; });
  // impact: shake, flash, a ring, dust, a brief colour split
  const dt = t - SLAM;
  const cam = $('cam');
  if (dt >= 0 && dt < 0.6) {
    const a = Math.exp(-dt / 0.11);
    cam.style.transform = `translate(${px(wob(dt, 27, 0.3) * 24 * a)}, ${px(wob(dt, 31, 1.9) * 18 * a)}) scale(${(1 + 0.035 * Math.exp(-dt / 0.09)).toFixed(4)})`;
  } else if (dt >= 0.6) {
    cam.style.transform = `scale(${(1 + 0.03 * E.outCubic(inv(t, SLAM + 0.6, S.end))).toFixed(4)})`;
  }
  const fl = $('flash');
  fl.style.opacity = dt >= 0 ? (0.5 * (1 - E.outCubic(inv(dt, 0, 0.24)))).toFixed(3) : '0';
  const ring = $('ring');
  const pr = inv(dt, 0, 0.75);
  show(ring, dt >= 0 && pr < 1);
  ring.setAttribute('r', lerp(40, 1150, E.outExpo(pr)).toFixed(1));
  ring.setAttribute('stroke-width', (12 * (1 - pr)).toFixed(2));
  ring.setAttribute('opacity', (0.85 * (1 - pr)).toFixed(3));
  const split = dt >= 0 ? Math.exp(-dt / 0.06) : 0;
  $('logo-art').style.filter = split > 0.03 ? `drop-shadow(${px(7 * split)} 0 0 rgba(255,70,60,${(0.5 * split).toFixed(3)})) drop-shadow(${px(-7 * split)} 0 0 rgba(60,190,255,${(0.5 * split).toFixed(3)}))` : 'none';
  const line = $('ground');
  if (t >= SLAM) {
    show(line, true);
    const pl = inv(dt, 0, 0.9);
    const w = lerp(S.logoW, S.W, E.outExpo(inv(dt, 0, 0.35)));
    line.style.width = px(w); line.style.left = px(S.W / 2 - w / 2);
    const lh = lerp(10, 2, E.outCubic(pl));
    line.style.height = px(lh); line.style.top = px(S.baseY - lh / 2);
    line.style.background = 'var(--tan)';
    line.style.opacity = (1 - E.inCubic(pl)).toFixed(3);
  }
  document.querySelectorAll('#dust circle').forEach((c) => {
    const d = S.dust[Number(c.dataset.i)];
    if (dt < 0 || dt > d.life) { c.setAttribute('opacity', '0'); return; }
    c.setAttribute('cx', (d.x + d.vx * dt).toFixed(1));
    c.setAttribute('cy', (S.baseY + d.vy * dt + 0.5 * 1500 * dt * dt).toFixed(1));
    c.setAttribute('opacity', (0.9 * (1 - dt / d.life)).toFixed(3));
  });
  rise($('l-tag'), t, SLAM + 1.2, 0.7, 30, 8);
  rise($('l-url'), t, SLAM + 1.5, 0.7, 16, 4);
}

window.render = function render(t) {   // every element is set from t alone, so frames can be drawn in any order
  $('cam').style.transform = 'none';
  $('flash').style.opacity = '0';
  show($('ground'), false);
  intro(t); montage(t); flagship(t); cta(t); slam(t);
};
window.ready = async function ready() {
  await document.fonts.load("200px 'Instrument Serif'");
  await document.fonts.load("italic 200px 'Instrument Serif'");
  await document.fonts.load("600 30px Manrope");
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
  const svgImgs = [...document.querySelectorAll('image')].map((im) => im.getAttribute('href'));
  await Promise.all(svgImgs.map((src) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = src; })));
  measure();
  return { W: S.W, H: S.H, frames: Math.round(S.end * S.fps), end: S.end, slam: SLAM, cta: CTA, flag: FLAG };
};
