// Draws any moment of one ad on its own: window.render(t) sets every element for time t, so
// frames can be rendered one by one (render.cjs). The ad itself is window.STORY, from series.py:
//   shots:  photos, each in a box, coming in with a transition and drifting (Ken Burns)
//   items:  words and graphics, each coming in with an animation and leaving at its end
//   endAt:  when the end card comes up.
const S = window.STORY;
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const out3 = (t) => { t = clamp(t); return 1 - Math.pow(1 - t, 3); };
const out5 = (t) => { t = clamp(t); return 1 - Math.pow(1 - t, 5); };
const inOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const back = (t) => { t = clamp(t); const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const lerp = (a, b, k) => a + (b - a) * k;

const shots = S.shots.map((s, i) => ({ ...s, el: $('shot' + i), img: $('shot' + i).querySelector('img') }));
const items = S.items.map((it, i) => ({ ...it, el: $('item' + i) }));

window.ready = async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
  // words that count or type keep their final text in data-text
  return { end: S.end };
};

function drawShot(s, t) {
  const on = t >= s.t0 && t <= s.t1 + 0.001;
  s.el.style.visibility = on ? 'visible' : 'hidden';
  if (!on) return;
  const k = clamp((t - s.t0) / (s.t1 - s.t0));
  const [z0, z1, dx, dy] = s.kb;
  const z = lerp(z0, z1, inOut(k));
  s.img.style.transform = `translate(${dx * inOut(k)}px, ${dy * inOut(k)}px) scale(${z})`;
  const p = clamp((t - s.t0) / s.d);           // the transition in
  const e = out5(p);
  let clip = 'none', tr = '', op = 1;
  switch (s.trans) {
    case 'cut': break;
    case 'fade': op = smooth(p); break;
    case 'wipeL': clip = `inset(0 ${100 - e * 100}% 0 0)`; break;
    case 'wipeR': clip = `inset(0 0 0 ${100 - e * 100}%)`; break;
    case 'wipeU': clip = `inset(${100 - e * 100}% 0 0 0)`; break;
    case 'wipeD': clip = `inset(0 0 ${100 - e * 100}% 0)`; break;
    case 'iris': clip = `circle(${e * 75}% at ${s.cx ?? 50}% ${s.cy ?? 50}%)`; break;
    case 'diag': clip = `polygon(0 0, ${e * 220}% 0, ${e * 220 - 100}% 100%, 0 100%)`; break;
    case 'slideL': tr = `translateX(${(1 - e) * 100}%)`; break;
    case 'slideU': tr = `translateY(${(1 - e) * 100}%)`; break;
    case 'zoom': tr = `scale(${lerp(1.25, 1, e)})`; op = smooth(p * 1.6); break;
    case 'drop': tr = `translateY(${(1 - back(p)) * -110}%)`; break;
  }
  s.el.style.clipPath = clip;
  s.el.style.transform = tr;
  s.el.style.opacity = op;
}

function money(v) { return '$' + Math.round(v).toLocaleString('en-US'); }

function drawItem(it, t) {
  const el = it.el;
  const pin = it.t0, d = it.d ?? 0.55;
  const outAt = it.t1 ?? 1e9;
  const vis = t >= pin && t <= outAt + 0.35;
  el.style.visibility = vis ? 'visible' : 'hidden';
  if (!vis) return;
  const p = clamp((t - pin) / d);
  const leave = 1 - smooth((t - outAt) / 0.3);
  let tf = '', op = 1;
  switch (it.anim) {
    case 'rise': {                        // each line slides up out of its own mask
      el.querySelectorAll('.ln > span').forEach((sp, j) => {
        const q = out5((t - pin - j * (it.stagger ?? 0.09)) / d);
        sp.style.transform = `translateY(${(1 - q) * 110}%)`;
      });
      break;
    }
    case 'words': {                       // word by word, each up and in
      el.querySelectorAll('.w').forEach((w, j) => {
        const q = out3((t - pin - j * (it.stagger ?? 0.07)) / (d * 0.8));
        w.style.transform = `translateY(${(1 - q) * 0.6}em)`;
        w.style.opacity = q;
      });
      break;
    }
    case 'pop': tf = `scale(${lerp(0.4, 1, back(p))}) rotate(${it.rot ?? 0}deg)`; op = smooth(p * 2); break;
    case 'slide': tf = `translateX(${(1 - out5(p)) * (it.from ?? -80)}px)`; op = smooth(p * 1.5); break;
    case 'fade': op = smooth(p); break;
    case 'up': tf = `translateY(${(1 - out5(p)) * 60}px)`; op = smooth(p * 1.5); break;
    case 'rule': tf = `scaleX(${out5(p)})`; break;
    case 'count': {
      const v = lerp(it.from, it.to, out3(p));
      el.querySelector('.num').textContent = money(v);
      tf = `translateY(${(1 - out5(p * 1.5)) * 40}px)`; op = smooth(p * 3);
      break;
    }
    case 'type': {
      const full = el.dataset.text;
      el.querySelector('.tt').textContent = full.slice(0, Math.round(full.length * clamp(p)));
      el.querySelector('.caret').style.opacity = (t - pin) % 0.5 < 0.25 || p < 1 ? 1 : 0;
      break;
    }
    case 'tick': {                        // a box draws, the tick strokes in, the words slide
      const box = el.querySelector('.box'), mark = el.querySelector('.mark'), tx = el.querySelector('.ttx');
      box.style.transform = `scale(${lerp(0.2, 1, back(clamp(p * 2)))})`;
      box.style.opacity = smooth(p * 3);
      mark.style.strokeDashoffset = 40 * (1 - out3(clamp((p - 0.35) * 2.2)));
      tx.style.transform = `translateX(${(1 - out5(clamp(p * 1.4 - 0.1))) * -40}px)`;
      tx.style.opacity = smooth(p * 2 - 0.1);
      break;
    }
    case 'stamp': {
      tf = `scale(${lerp(0.2, 1, back(p))}) rotate(${lerp(-80, it.rot ?? -10, out5(p)) + (t - pin) * 6}deg)`;
      op = smooth(p * 2.5);
      break;
    }
    case 'pin': {                          // the pin drops and bounces, rings go out from it
      const q = clamp((t - pin) / 0.5);
      const y = q < 1 ? -260 * Math.pow(1 - q, 2) + (q > 0.7 ? -18 * Math.sin((q - 0.7) / 0.3 * Math.PI) : 0) : 0;
      el.querySelector('.pinhead').style.transform = `translateY(${y}px)`;
      el.querySelectorAll('.ring').forEach((r, j) => {
        const rr = ((t - pin - 0.45 - j * 0.6) % 1.8 + 1.8) % 1.8 / 1.8;
        const live = t - pin - 0.45 - j * 0.6 > 0;
        r.setAttribute('r', 20 + rr * 200);
        r.style.opacity = live ? (1 - rr) * 0.8 : 0;
      });
      break;
    }
    case 'bar': {                          // a progress bar across the shots
      const k = clamp((t - pin) / ((it.t1 ?? S.endAt) - pin));
      el.querySelector('.fill').style.transform = `scaleX(${k})`;
      el.querySelectorAll('.seg').forEach((sg, j) => sg.classList.toggle('on', t >= it.marks[j]));
      op = smooth(p * 2);
      break;
    }
  }
  el.style.transform = tf;
  el.style.opacity = op * leave;
}

function drawEnd(t) {
  const e = $('end');
  const p = clamp((t - S.endAt) / 0.55);
  e.style.visibility = p > 0 ? 'visible' : 'hidden';
  if (p <= 0) return;
  e.style.clipPath = `inset(${(1 - out5(p)) * 100}% 0 0 0)`;
  e.querySelectorAll('.eitem').forEach((el, j) => {
    const q = out5((t - S.endAt - 0.25 - j * 0.09) / 0.6);
    el.style.transform = `translateY(${(1 - q) * 50}px)`;
    el.style.opacity = q;
  });
  const mark = $('endmark');
  const q = clamp((t - S.endAt - 0.1) / 0.6);
  mark.style.transform = `scale(${lerp(0.5, 1, back(q))})`;
  mark.style.opacity = smooth(q * 2);
}

window.render = (t) => {
  shots.forEach((s) => drawShot(s, t));
  items.forEach((it) => drawItem(it, t));
  drawEnd(t);
  $('chrome').style.opacity = 1 - smooth((t - S.endAt) / 0.3);
  const fadeIn = clamp(t / 0.12);
  $('stage').style.opacity = fadeIn;
};
