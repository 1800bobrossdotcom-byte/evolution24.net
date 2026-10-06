// The After Effects keyframes, replayed, against the website's own animation.
//   node scripts/compare-after-effects.cjs
// 1. scripts/test-after-effects.cjs --export lists every comp, layer and keyframe the After
//    Effects script makes (run against its stand-in for After Effects);
// 2. this replays them as After Effects interpolates them, each pair of keyframes a cubic
//    Bezier in time and value built from its speed and influence, and draws each frame as SVG
//    in Chromium;
// 3. it plays the site's own animation in Chromium, stopped at the same moments
//    (tools/after-effects/live.cjs);
// 4. and compares the two pictures pixel by pixel (Python with Pillow and NumPy).
// The letters' blur is left out of the strict comparison: the site's is a CSS filter and After
// Effects' a Gaussian Blur, whose strength is After Effects' own business. It is compared, and
// reported, separately. Frames land in tools/after-effects/out/compare/.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const live = require('../tools/after-effects/live.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'after-effects', 'out', 'compare');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const SCENE_FILE = path.join(OUT, 'scene.json');
execFileSync(process.execPath, [path.join(__dirname, 'test-after-effects.cjs'), '--export', SCENE_FILE], { stdio: 'ignore' });
const SCENE = JSON.parse(fs.readFileSync(SCENE_FILE, 'utf8'));

/* ---- After Effects' interpolation ------------------------------------------------------- */
// One dimension between two keyframes: a cubic Bezier from (t0, v0) to (t1, v1) whose handles
// reach influence% of the way across in time, at the keyframe's speed.
function bezier1d(t, t0, v0, out, t1, v1, inn) {
  const span = t1 - t0;
  const x1 = t0 + (out.influence / 100) * span, y1 = v0 + out.speed * (out.influence / 100) * span;
  const x2 = t1 - (inn.influence / 100) * span, y2 = v1 - inn.speed * (inn.influence / 100) * span;
  const at = (u, a, b, c, d) => { const w = 1 - u; return w * w * w * a + 3 * w * w * u * b + 3 * w * u * u * c + u * u * u * d; };
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (at(m, t0, x1, x2, t1) < t) lo = m; else hi = m; }
  return at((lo + hi) / 2, v0, y1, y2, v1);
}
const SPATIAL = new Set(['ADBE Position', 'ADBE Anchor Point']);
function valueAt(prop, t, matchName) {
  const ks = prop.keys;
  if (!ks.length) return prop.value;
  if (t <= ks[0].t) return ks[0].v;
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
  let i = 0;
  while (ks[i + 1].t <= t) i++;
  const a = ks[i], b = ks[i + 1];
  if (!Array.isArray(a.v)) return bezier1d(t, a.t, a.v, a.outEase[0], b.t, b.v, b.inEase[0]);
  if (SPATIAL.has(matchName)) {                     // one speed, along a straight path
    const dist = Math.hypot(...a.v.map((x, d) => b.v[d] - x));
    const s = dist ? bezier1d(t, a.t, 0, a.outEase[0], b.t, dist, b.inEase[0]) / dist : 0;
    return a.v.map((x, d) => x + s * (b.v[d] - x));
  }
  return a.v.map((x, d) => bezier1d(t, a.t, x, a.outEase[d], b.t, b.v[d], b.inEase[d]));
}

/* ---- drawing a comp as SVG ----------------------------------------------------------------- */
const rgb = (c) => `rgb(${c.slice(0, 3).map((x) => Math.round(x * 255)).join(',')})`;
const tr = (L, m, t) => valueAt(L.transform[m], t, m);
function local(L, t) {
  const a = tr(L, 'ADBE Anchor Point', t), p = tr(L, 'ADBE Position', t), s = tr(L, 'ADBE Scale', t);
  const sx = s[0] / 100, sy = s[1] / 100;
  return [sx, 0, 0, sy, p[0] - sx * a[0], p[1] - sy * a[1]];
}
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
function world(comp, L, t) {
  let m = local(L, t);
  for (let q = L; q.parent !== null; q = comp.layers[q.parent]) m = mul(local(comp.layers[q.parent], t), m);
  return m;
}
const matrix = (m) => `matrix(${m.map((x) => +x.toFixed(6)).join(' ')})`;
function pathD(shape) {
  const v = shape.vertices, ti = shape.inTangents, to = shape.outTangents;
  const pt = (p) => `${+p[0].toFixed(4)} ${+p[1].toFixed(4)}`;
  let d = `M${pt(v[0])}`;
  for (let k = 0; k < v.length; k++) {
    const n = (k + 1) % v.length;
    if (n === 0 && !shape.closed) break;
    d += `C${pt([v[k][0] + to[k][0], v[k][1] + to[k][1]])} ${pt([v[n][0] + ti[n][0], v[n][1] + ti[n][1]])} ${pt(v[n])}`;
  }
  return d + (shape.closed ? 'Z' : '');
}
const groupD = (g) => g.paths.map(pathD).join('') + g.rects.map((r) => `M${-r[0] / 2} ${-r[1] / 2}h${r[0]}v${r[1]}h${-r[0]}Z`).join('');
function shapeSvg(L) {
  return L.groups.map((g) => `<path d="${groupD(g)}" fill="${rgb(g.fill.color)}" fill-opacity="${g.fill.opacity / 100}"/>`).join('');
}
let ids = 0;
let SCENE_NOW = SCENE;
function compSvg(comp, t, opts) {
  const defs = [];
  const parts = [];
  for (const L of comp.layers.slice().reverse()) {   // bottom first
    if (!L.enabled || L.kind === 'null') continue;
    const m = world(comp, L, t);
    const opacity = tr(L, 'ADBE Opacity', t) / 100;
    let inner = '';
    if (L.kind === 'solid') inner = `<rect width="${comp.w}" height="${comp.h}" fill="${rgb(L.color)}"/>`;
    if (L.kind === 'shape') inner = shapeSvg(L);
    if (L.kind === 'precomp') inner = compSvg(SCENE_NOW.find((c) => c.name === L.source), t, opts);
    let g = `<g transform="${matrix(m)}" opacity="${opacity}">${inner}</g>`;
    const blur = L.effects.find((e) => e.matchName === 'ADBE Gaussian Blur 2');
    if (blur && opts.blur) {
      let b = valueAt(blur.blurriness, t);
      const expr = /: ([\d.]+);\nvalue \* s \/ ([\d.]+);/.exec(blur.blurriness.expression);
      if (expr) b *= (L.parent === null ? +expr[1] : Math.abs(tr(comp.layers[L.parent], 'ADBE Scale', t)[0])) / +expr[2];
      if (b > 0.01) {
        const id = `b${ids++}`;
        defs.push(`<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${comp.w}" height="${comp.h}"><feGaussianBlur stdDeviation="${0.3 * b}"/></filter>`);
        g = `<g filter="url(#${id})">${g}</g>`;
      }
    }
    if (L.matte !== null) {                          // an alpha matte of solid shapes: a clip
      const M = comp.layers[L.matte];
      const id = `m${ids++}`;
      const mm = matrix(world(comp, M, t));            // a clipPath holds shapes only, so each carries the transform
      defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${M.groups.map((g) => `<path transform="${mm}" d="${groupD(g)}"/>`).join('')}</clipPath>`);
      g = `<g clip-path="url(#${id})">${g}</g>`;
    }
    parts.push(g);
  }
  return `<defs>${defs.join('')}</defs>${parts.join('')}`;
}
function frameSvg(comp, t, opts) {
  ids = 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${comp.w}" height="${comp.h}" viewBox="0 0 ${comp.w} ${comp.h}">`
    + `<rect width="${comp.w}" height="${comp.h}" fill="${rgb(comp.bgColor)}"/>${compSvg(comp, t, opts)}</svg>`;
}

/* ---- the comparison ------------------------------------------------------------------------ */
// Mistakes the comparison must catch, drawn from the same keyframes: everything 30 ms late, the
// logo 1% too big, and straight-line easing in place of the website's curves.
const clone = (x) => JSON.parse(JSON.stringify(x));
function variant(kind, snap) {
  const scene = clone(SCENE);
  // where Chrome put the site's logo, to the pixel: the comps centre it exactly
  for (const comp of scene) {
    for (const L of comp.layers) {
      if (/move and scale me/.test(L.name)) L.transform['ADBE Position'].value = L.transform['ADBE Position'].value.map((v, d) => v + [snap.dx, snap.dy, 0][d]);
    }
  }
  if (kind === 'as built') return { scene, shift: 0 };
  if (kind === '30 ms late') return { scene, shift: 0.03 };
  for (const comp of scene) {
    for (const L of comp.layers) {
      if (kind === '1% too big' && /move and scale me/.test(L.name)) L.transform['ADBE Scale'].value = L.transform['ADBE Scale'].value.map((v) => v * 1.01);
      if (kind === 'linear easing') {
        for (const p of [...Object.values(L.transform), ...L.effects.map((e) => e.blurriness)]) {
          p.keys.forEach((k, i) => {
            const n = p.keys[i + 1];
            if (!n) return;
            const span = n.t - k.t;
            const slope = (d) => (Array.isArray(k.v) ? (n.v[d] - k.v[d]) / span : (n.v - k.v) / span);
            const dist = Array.isArray(k.v) ? Math.hypot(...k.v.map((x, d) => n.v[d] - x)) / span : 0;
            k.outEase = k.outEase.map((e, d) => ({ speed: k.outEase.length === 1 && Array.isArray(k.v) ? dist : slope(d), influence: 100 / 3 }));
            n.inEase = n.inEase.map((e, d) => ({ speed: n.inEase.length === 1 && Array.isArray(k.v) ? dist : slope(d), influence: 100 / 3 }));
          });
        }
      }
    }
  }
  return { scene, shift: 0 };
}
const VARIANTS = ['as built', '30 ms late', '1% too big', 'linear easing'];

const steps = (end, every, more = []) => [...Array(Math.floor(end / every + 1e-9) + 1).keys()].map((i) => +(i * every).toFixed(3))
  .concat(more).sort((a, b) => a - b);
const RUNS = [
  { key: 'intro16', comp: 'Evolution24 Intro 16x9', blur: false, times: steps(2.9, 0.1, [0.95, 1.33, 2.25, 2.5, 2.75, 2.94]) },
  { key: 'intro9', comp: 'Evolution24 Intro 9x16', blur: false, times: steps(1.7, 0.1, [0.45, 1.3, 1.45, 1.74]) },
  { key: 'lockup', comp: 'Evolution24 Lockup Build 16x9', blur: false, times: steps(1.8, 0.1, [0.25, 0.9]) },
  { key: 'intro16', comp: 'Evolution24 Intro 16x9', blur: true, times: [0.95, 1.0, 1.15, 1.3, 1.5, 1.8] },
];

(async () => {
  const { browser, stop } = await live.start();
  const sim = await (await browser.newContext({ viewport: { width: 1920, height: 1920 } })).newPage();
  const rows = [];
  for (const run of RUNS) {
    const site = await live.open(browser, run.key, { blur: run.blur });
    const dir = path.join(OUT, `${run.key}${run.blur ? '-blur' : ''}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const t of run.times) {
      const name = t.toFixed(3);
      fs.writeFileSync(path.join(dir, `${name}-site.png`), await site.seek(t));
      for (const kind of VARIANTS) {
        const v = variant(kind, site.snap);
        const comp = v.scene.find((c) => c.name === run.comp);
        SCENE_NOW = v.scene;
        await sim.setViewportSize({ width: comp.w, height: comp.h });
        await sim.setContent(`<style>html,body{margin:0}</style>${frameSvg(comp, Math.max(0, t - v.shift), { blur: run.blur })}`);
        const file = `${name}-ae${kind === 'as built' ? '' : '-' + kind.replace(/\W+/g, '-')}.png`;
        fs.writeFileSync(path.join(dir, file), await sim.screenshot({ type: 'png' }));
        rows.push({ dir, site: `${name}-site.png`, ae: file, run: `${run.key}${run.blur ? ' with blur' : ''}`, kind, t });
      }
    }
    await site.close();
  }
  await stop();

  // Both pictures softened by about a pixel, so that edges drawn a fraction of a pixel apart, and
  // the thin fringe Chrome leaves on the site's animated pieces, count for little; a shape in the
  // wrong place or at the wrong moment still shows.
  const stats = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
import numpy as np
from PIL import Image, ImageFilter
rows = json.load(sys.stdin)
cache = {}
def soft(p):
    if p not in cache:
        cache[p] = np.asarray(Image.open(p).convert('RGB').filter(ImageFilter.GaussianBlur(1.5)), dtype=np.int16)
    return cache[p]
for r in rows:
    a, b = soft(r['dir'] + '/' + r['site']), soft(r['dir'] + '/' + r['ae'])
    d = np.abs(a - b).max(axis=2)
    r['off'] = float((d > 24).mean() * 100)
    r['mean'] = float(d.mean())
print(json.dumps(rows))
`], { input: JSON.stringify(rows), maxBuffer: 1 << 26 }).toString());

  let failed = 0;
  for (const run of [...new Set(stats.map((s) => s.run))]) {
    const of = (kind) => stats.filter((s) => s.run === run && s.kind === kind);
    const total = (kind) => of(kind).reduce((n, s) => n + s.mean, 0);
    const built = of('as built');
    const worst = built.reduce((w, s) => (s.off > w.off ? s : w));
    const caught = VARIANTS.slice(1).map((k) => [k, total(k) / total('as built')]);
    const ok = worst.off < 0.5 && caught.every(([, x]) => x > 1.5);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${run}: ${built.length} frames; at worst ${worst.off.toFixed(3)}% of pixels differ by more than 24 of 255 `
      + `(${worst.t}s). Deliberate mistakes differ ${caught.map(([k, x]) => `${x.toFixed(1)}x as much (${k})`).join(', ')}`);
  }
  console.log(failed ? `${failed} FAILED` : 'the After Effects keyframes match the website, and the check catches each deliberate mistake');
  process.exit(failed ? 1 : 0);
})();
