// The After Effects script for the animated logo, run against a stand-in for After Effects.
//   node scripts/test-after-effects.cjs [--export scene.json]
// It parses tools/after-effects/evolution24-logo.jsx as ECMAScript 3 (what ExtendScript
// understands), then runs it with After Effects' scripting objects replaced by a mock that
// checks what the real ones insist on: the match names it asks for, references going stale
// once a sibling is added, one ease per dimension (one for spatial properties), influences
// between 0.1 and 100. It records every comp, layer and keyframe, and --export writes them
// out for scripts/compare-after-effects.cjs, which renders them next to the website's own
// animation. It cannot prove After Effects accepts every call: running the script in After
// Effects does that.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const JSX = path.join(ROOT, 'tools', 'after-effects', 'evolution24-logo.jsx');
const SOURCE = fs.readFileSync(JSX, 'utf8');
const acorn = (() => {
  try { return require('acorn'); } catch {
    const root = require('child_process').execSync('npm root -g').toString().trim();
    return require(path.join(root, 'eslint', 'node_modules', 'acorn'));
  }
})();

/* ---- After Effects, mocked -------------------------------------------------------------- */
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
const MATTE = { NO_TRACK_MATTE: 5012, ALPHA: 5013, ALPHA_INVERTED: 5014, LUMA: 5015, LUMA_INVERTED: 5016 };
const VALUE = { ONE: 'OneD', TWO: 'TwoD', TWO_S: 'TwoD_SPATIAL', THREE: 'ThreeD', THREE_S: 'ThreeD_SPATIAL', COLOR: 'COLOR', SHAPE: 'SHAPE' };

// What each group holds, by match name: [child match name, value type, default] or a group.
const GROUPS = {
  'ADBE Transform Group': [['ADBE Anchor Point', VALUE.THREE_S, [0, 0, 0]], ['ADBE Position', VALUE.THREE_S, [960, 540, 0]],
    ['ADBE Scale', VALUE.THREE, [100, 100, 100]], ['ADBE Rotate Z', VALUE.ONE, 0], ['ADBE Opacity', VALUE.ONE, 100]],
  'ADBE Vector Group': [['ADBE Vectors Group', 'group'], ['ADBE Vector Transform Group', 'group']],
  'ADBE Vector Shape - Group': [['ADBE Vector Shape', VALUE.SHAPE, null]],
  'ADBE Vector Shape - Rect': [['ADBE Vector Rect Size', VALUE.TWO, [100, 100]], ['ADBE Vector Rect Position', VALUE.TWO_S, [0, 0]], ['ADBE Vector Rect Roundness', VALUE.ONE, 0]],
  'ADBE Vector Graphic - Fill': [['ADBE Vector Fill Rule', VALUE.ONE, 1], ['ADBE Vector Fill Color', VALUE.COLOR, [1, 0, 0, 1]], ['ADBE Vector Fill Opacity', VALUE.ONE, 100]],
  'ADBE Gaussian Blur 2': [['ADBE Gaussian Blur 2-0001', VALUE.ONE, 0], ['ADBE Gaussian Blur 2-0002', VALUE.ONE, 1], ['ADBE Gaussian Blur 2-0003', VALUE.ONE, 0]],
  'ADBE Vector Transform Group': [],
};
// What may be added where.
const ADDABLE = {
  'ADBE Root Vectors Group': ['ADBE Vector Group'],
  'ADBE Vectors Group': ['ADBE Vector Shape - Group', 'ADBE Vector Shape - Rect', 'ADBE Vector Graphic - Fill'],
  'ADBE Effect Parade': ['ADBE Gaussian Blur 2'],
};
const DIMS = { OneD: 1, TwoD: 2, TwoD_SPATIAL: 2, ThreeD: 3, ThreeD_SPATIAL: 3, COLOR: 4 };

function mockAfterEffects(opts) {
  const log = { alerts: [], saved: null, undo: 0, matchNames: new Set() };
  let stale = 0;                                      // how many stale references were used (must stay 0)

  // Records hold the data; every property() or addProperty() call hands out a new handle.
  // As in After Effects, adding a property to a group leaves the handles already given out
  // for that group's children invalid; asking the group again gives a fresh one.
  function handleCheck(h, what) {
    if (h.stale) { stale++; throw new Error(`Object is invalid (${what} was used after a sibling was added)`); }
  }

  function makeProperty(matchName, type, def) {
    return { kind: 'property', matchName, type, keys: [], expression: '', static: def };
  }
  function propertyHandle(p, registry) {
    const h = { stale: false };
    registry.push(h);
    const { matchName, type } = p;
    const dims = DIMS[type] || 1;
    const fit = (v) => {
      if (type === VALUE.SHAPE) {
        assert.ok(v && Array.isArray(v.vertices) && v.vertices.length > 2, `${matchName}: a shape needs vertices`);
        assert.ok(v.vertices.length === v.inTangents.length && v.vertices.length === v.outTangents.length, `${matchName}: tangents and vertices differ`);
        v.vertices.concat(v.inTangents, v.outTangents).forEach((pt) => assert.ok(pt.length === 2 && pt.every(Number.isFinite), `${matchName}: bad point ${pt}`));
        return { vertices: v.vertices, inTangents: v.inTangents, outTangents: v.outTangents, closed: v.closed };
      }
      if (dims === 1) { assert.ok(Number.isFinite(v), `${matchName}: ${v} is not a number`); return v; }
      assert.ok(Array.isArray(v) && v.every(Number.isFinite), `${matchName}: ${JSON.stringify(v)} is not an array of numbers`);
      assert.ok(v.length === dims || (dims === 3 && v.length === 2), `${matchName}: ${v.length} values for ${dims} dimensions`);
      return v.length === dims ? v.slice() : v.concat([Array.isArray(p.static) ? p.static[2] : 0]);
    };
    const keyAt = (i) => { assert.ok(i >= 1 && i <= p.keys.length, `${matchName}: no keyframe ${i}`); return p.keys[i - 1]; };
    const live = () => handleCheck(h, matchName);
    return {
      get matchName() { live(); return matchName; },
      get value() { live(); return p.keys.length ? p.keys[0].v : p.static; },
      get isSpatial() { live(); return /SPATIAL/.test(type); },
      get numKeys() { live(); return p.keys.length; },
      get expression() { live(); return p.expression; },
      set expression(s) { live(); assert.strictEqual(typeof s, 'string'); p.expression = s; },
      setValue(v) { live(); assert.strictEqual(p.keys.length, 0, `${matchName}: setValue on a keyframed property`); p.static = fit(v); },
      setValueAtTime(t, v) {
        live(); assert.ok(Number.isFinite(t) && t >= 0, `${matchName}: time ${t}`);
        const k = { t, v: fit(v), inType: KIT.LINEAR, outType: KIT.LINEAR, inEase: null, outEase: null, inTan: null, outTan: null };
        const at = p.keys.findIndex((x) => Math.abs(x.t - t) < 1e-9);
        if (at >= 0) p.keys[at] = k; else { p.keys.push(k); p.keys.sort((a, b) => a.t - b.t); }
      },
      nearestKeyIndex(t) {
        live(); assert.ok(p.keys.length, `${matchName}: no keyframes`);
        let best = 0; p.keys.forEach((k, i) => { if (Math.abs(k.t - t) < Math.abs(p.keys[best].t - t)) best = i; });
        return best + 1;
      },
      setInterpolationTypeAtKey(i, inType, outType) {
        live(); const k = keyAt(i);
        assert.ok(Object.values(KIT).includes(inType), 'interpolation type');
        k.inType = inType; k.outType = outType === undefined ? inType : outType;
      },
      setTemporalEaseAtKey(i, inEase, outEase) {
        live(); const k = keyAt(i);
        const want = /SPATIAL/.test(type) ? 1 : dims;
        [inEase, outEase].forEach((e) => {
          assert.ok(Array.isArray(e) && e.length === want, `${matchName}: ${e && e.length} eases where After Effects wants ${want}`);
          e.forEach((x) => {
            assert.ok(x && x.__ease, `${matchName}: not a KeyframeEase`);
            assert.ok(Number.isFinite(x.speed), `${matchName}: speed ${x.speed}`);
            assert.ok(x.influence >= 0.1 && x.influence <= 100, `${matchName}: influence ${x.influence} is outside 0.1 to 100`);
          });
        });
        k.inEase = inEase.map((x) => ({ speed: x.speed, influence: x.influence }));
        k.outEase = outEase.map((x) => ({ speed: x.speed, influence: x.influence }));
      },
      setSpatialTangentsAtKey(i, inTan, outTan) {
        live(); const k = keyAt(i);
        assert.ok(/SPATIAL/.test(type), `${matchName}: spatial tangents on a property that is not spatial`);
        [inTan, outTan].forEach((v) => assert.ok(Array.isArray(v) && (v.length === 2 || v.length === 3), `${matchName}: tangent ${v}`));
        k.inTan = inTan; k.outTan = outTan;
      },
    };
  }

  function makeGroup(matchName) {
    log.matchNames.add(matchName);
    const g = { kind: 'group', matchName, children: [], handles: [], name: matchName };
    (GROUPS[matchName] || []).forEach(([m, type, def]) => {
      log.matchNames.add(m);
      g.children.push(type === 'group' ? makeGroup(m) : makeProperty(m, type, def));
    });
    return g;
  }
  function groupHandle(g, registry) {
    const h = { stale: false };
    if (registry) registry.push(h);
    const live = () => handleCheck(h, g.matchName);
    const handleOf = (c) => (c.kind === 'group' ? groupHandle(c, g.handles) : propertyHandle(c, g.handles));
    return {
      get name() { live(); return g.name; },
      set name(n) { live(); g.name = n; },
      get matchName() { live(); return g.matchName; },
      get numProperties() { live(); return g.children.length; },
      property(m) {
        live();
        const c = g.children.find((x) => x.matchName === m);
        assert.ok(c, `${g.matchName} has no "${m}"`);
        return handleOf(c);
      },
      addProperty(m) {
        live();
        assert.ok((ADDABLE[g.matchName] || []).includes(m), `"${m}" cannot be added to ${g.matchName}`);
        g.handles.forEach((x) => { x.stale = true; });
        g.handles = [];
        const child = makeGroup(m);
        g.children.push(child);
        return handleOf(child);
      },
    };
  }

  function makeLayer(comp, kind, extra) {
    const L = Object.assign({ comp, kind, name: '', parent: null, enabled: true, trackMatteType: MATTE.NO_TRACK_MATTE, matte: null,
      groups: { 'ADBE Transform Group': makeGroup('ADBE Transform Group'), 'ADBE Effect Parade': makeGroup('ADBE Effect Parade') } }, extra);
    // Where After Effects puts a new layer: at the comp's centre, anchored at the middle of its
    // source (a 100 x 100 null, a solid or comp of its own size), or at its origin for a shape layer.
    const t0 = L.groups['ADBE Transform Group'].children;
    t0.find((c) => c.matchName === 'ADBE Position').static = [comp.w / 2, comp.h / 2, 0];
    const size = kind === 'null' ? [100, 100] : kind === 'solid' ? [comp.w, comp.h] : kind === 'precomp' ? [L.source.w, L.source.h] : [0, 0];
    t0.find((c) => c.matchName === 'ADBE Anchor Point').static = [size[0] / 2, size[1] / 2, 0];
    if (kind === 'shape') L.groups['ADBE Root Vectors Group'] = makeGroup('ADBE Root Vectors Group');
    const api = {
      get name() { return L.name; }, set name(n) { L.name = String(n); },
      get parent() { return L.parent ? L.parent.api : null; },
      set parent(x) {
        assert.ok(x && x.__layer && x.__layer.comp === comp, 'a parent must be a layer in the same comp');
        for (let q = x.__layer; q; q = q.parent) assert.ok(q !== L, 'a layer cannot be its own ancestor');
        // After Effects keeps the child where it was on screen by changing its transform.
        const t = L.groups['ADBE Transform Group'].children;
        t.find((c) => c.matchName === 'ADBE Scale').static = [123.4, 123.4, 100];
        t.find((c) => c.matchName === 'ADBE Position').static = [-1, -1, 0];
        L.parent = x.__layer;
      },
      get enabled() { return L.enabled; }, set enabled(b) { L.enabled = Boolean(b); },
      get trackMatteType() { return L.trackMatteType; },
      set trackMatteType(t) {
        const i = comp.layers.indexOf(L);
        assert.ok(i > 0, 'a legacy track matte needs a layer above');
        L.trackMatteType = t; L.matte = comp.layers[i - 1];
      },
      get index() { return comp.layers.indexOf(L) + 1; },
      get __layer() { return L; },
      property(m) { assert.ok(L.groups[m], `a ${kind} layer has no "${m}"`); return groupHandle(L.groups[m], null); },
      moveBefore(other) { comp.layers.splice(comp.layers.indexOf(L), 1); comp.layers.splice(comp.layers.indexOf(other.__layer), 0, L); },
    };
    if (opts.modernMatte) {
      api.setTrackMatte = (m, type) => { assert.ok(m && m.__layer && m.__layer.comp === comp); L.matte = m.__layer; L.trackMatteType = type; };
    }
    L.api = api;
    comp.layers.unshift(L);                           // new layers go on top
    return api;
  }

  const project = { items: [], folders: [] };
  function makeComp(name, w, h, par, duration, fps) {
    [w, h, duration, fps].forEach((n) => assert.ok(Number.isFinite(n) && n > 0, `comp ${name}: ${n}`));
    const C = { kind: 'comp', name, w, h, par, duration, fps, layers: [], bgColor: [0, 0, 0], parentFolder: null, opened: false };
    const api = {
      get name() { return C.name; }, get width() { return w; }, get height() { return h; }, get duration() { return duration; },
      get frameRate() { return fps; },
      set bgColor(c) { assert.ok(c.length === 3 && c.every((x) => x >= 0 && x <= 1), 'bgColor'); C.bgColor = c; },
      set parentFolder(f) { C.parentFolder = f.__folder; },
      openInViewer() { C.opened = true; },
      get __comp() { return C; },
      layers: {
        addShape: () => makeLayer(C, 'shape'),
        addNull: (d) => { assert.ok(Math.abs(d - duration) < 1e-9, 'null duration'); return makeLayer(C, 'null'); },
        addSolid: (color, n, sw, sh, spar, d) => {
          assert.ok(color.length === 3 && sw === w && sh === h && d === duration, 'solid settings');
          const l = makeLayer(C, 'solid', { color }); l.name = n; return l;
        },
        add: (item) => { assert.ok(item && item.__comp, 'only comps are added here'); return makeLayer(C, 'precomp', { source: item.__comp }); },
      },
    };
    C.api = api;
    project.items.push(C);
    return api;
  }
  function makeFolder(name) {
    const F = { name, parent: null };
    project.folders.push(F);
    return { get __folder() { return F; }, set parentFolder(f) { F.parent = f.__folder; } };
  }

  const app = {
    project: null,
    newProject() { app.project = { items: { addComp: makeComp, addFolder: makeFolder }, save(f) { log.saved = f.fsName; } }; return app.project; },
    beginUndoGroup() { log.undo++; },
    endUndoGroup() { log.undo--; },
  };
  function Shape() { this.vertices = []; this.inTangents = []; this.outTangents = []; this.closed = false; }
  function KeyframeEase(speed, influence) { this.speed = speed; this.influence = influence; this.__ease = true; }
  function File(p) { this.fsName = String(p); this.parent = { fsName: path.dirname(String(p)) }; }
  const ctx = vm.createContext({
    app, Shape, KeyframeEase, File, Math,
    KeyframeInterpolationType: KIT, TrackMatteType: MATTE,
    alert: (m) => log.alerts.push(String(m)),
    $: { fileName: '/Users/designer/Downloads/Evolution24-Logo-After-Effects/Evolution24 Logo.jsx' },
  });
  vm.runInContext(SOURCE, ctx, { filename: 'evolution24-logo.jsx' });
  return { project, log, stale: () => stale };
}

/* ---- what the script built, as plain data ------------------------------------------- */
function exportScene(project) {
  const prop = (p) => ({ value: p.static, keys: p.keys.map((k) => ({ t: k.t, v: k.v, inType: k.inType, outType: k.outType, inEase: k.inEase, outEase: k.outEase })), expression: p.expression });
  const find = (g, m) => g.children.find((c) => c.matchName === m);
  return project.items.map((C) => ({
    name: C.name, w: C.w, h: C.h, fps: C.fps, duration: C.duration, bgColor: C.bgColor,
    layers: C.layers.map((L) => {
      const t = L.groups['ADBE Transform Group'];
      const out = { name: L.name, kind: L.kind, enabled: L.enabled, parent: L.parent ? C.layers.indexOf(L.parent) : null,
        matte: L.matte ? C.layers.indexOf(L.matte) : null, source: L.source ? L.source.name : null, color: L.color || null,
        transform: Object.fromEntries(['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale', 'ADBE Opacity'].map((m) => [m, prop(find(t, m))])),
        effects: L.groups['ADBE Effect Parade'].children.map((e) => ({ matchName: e.matchName, blurriness: prop(find(e, 'ADBE Gaussian Blur 2-0001')) })) };
      if (L.kind === 'shape') {
        out.groups = L.groups['ADBE Root Vectors Group'].children.map((g) => {
          const items = find(g, 'ADBE Vectors Group').children;
          const fill = items.find((c) => c.matchName === 'ADBE Vector Graphic - Fill');
          return {
            name: g.name,
            paths: items.filter((c) => c.matchName === 'ADBE Vector Shape - Group').map((c) => find(c, 'ADBE Vector Shape').static),
            rects: items.filter((c) => c.matchName === 'ADBE Vector Shape - Rect').map((c) => find(c, 'ADBE Vector Rect Size').static),
            fill: fill ? { color: find(fill, 'ADBE Vector Fill Color').static, opacity: find(fill, 'ADBE Vector Fill Opacity').static } : null,
          };
        });
      }
      return out;
    }),
  }));
}

/* ---- the checks ------------------------------------------------------------------------- */
const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok  ', name]); } catch (e) { results.push(['FAIL', `${name}: ${e.message}`]); } };

test('the script is ECMAScript 3, which ExtendScript runs, and plain ASCII', () => {
  acorn.parse(SOURCE, { ecmaVersion: 3 });
  assert.ok(/^[\x00-\x7f]*$/.test(SOURCE), 'non-ASCII characters');
});

let modern;
test('it runs to the end in a mock of After Effects 2023 and later, without touching a stale reference', () => {
  modern = mockAfterEffects({ modernMatte: true });
  assert.strictEqual(modern.stale(), 0);
  assert.strictEqual(modern.log.undo, 0, 'every undo group is closed');
});
let legacy;
test('and in a mock of earlier versions, with the old way of setting a track matte', () => {
  legacy = mockAfterEffects({ modernMatte: false });
  assert.strictEqual(legacy.stale(), 0);
});

const comps = () => modern.project.items;
const byName = (n) => comps().find((c) => c.name === n);
test('it builds three comps and two precomps, at the frame sizes and lengths planned', () => {
  assert.deepStrictEqual(comps().map((c) => [c.name, c.w, c.h, c.fps, c.duration]).sort(), [
    ['Evolution24 Intro 16x9', 1920, 1080, 60, 3.5], ['Evolution24 Intro 16x9 contents', 1920, 1080, 60, 3.5],
    ['Evolution24 Intro 9x16', 1080, 1920, 60, 2.5], ['Evolution24 Intro 9x16 contents', 1080, 1920, 60, 2.5],
    ['Evolution24 Lockup Build 16x9', 1920, 1080, 60, 3],
  ].sort());
  assert.ok(byName('Evolution24 Intro 16x9').opened, 'the first comp opens in the viewer');
});
test('it saves the project beside the script, and says so', () => {
  assert.strictEqual(modern.log.saved, '/Users/designer/Downloads/Evolution24-Logo-After-Effects/Evolution24 Logo.aep');
  assert.match(modern.log.alerts[0], /built 3 comps and saved/);
});
test('each intro holds a background, the logo on a null, 15 bars, 21 letters and the line', () => {
  for (const n of ['Evolution24 Intro 16x9 contents', 'Evolution24 Intro 9x16 contents']) {
    const names = byName(n).layers.map((l) => l.name).reverse();     // bottom to top
    assert.strictEqual(names[0], 'Background');
    assert.strictEqual(names[1], 'Logo (move and scale me)');
    assert.deepStrictEqual(names.slice(2, 17), Array.from({ length: 15 }, (_, i) => `Bar ${String(i + 1).padStart(2, '0')}`));
    assert.strictEqual(names.slice(17, 38).map((s) => s.slice(-1)).join(''), 'EVOLUTION24PROPERTIES');
    assert.deepStrictEqual(names.slice(38), ['Line', 'Line fill']);
    const logo = byName(n).layers.find((l) => l.name === 'Logo (move and scale me)');
    assert.ok(byName(n).layers.filter((l) => /^(Bar|Letter)/.test(l.name)).every((l) => l.parent === logo), 'every piece hangs from the null');
  }
});
test('each intro\'s curtain is an alpha matte over its contents, hidden itself, in both ways of setting it', () => {
  for (const m of [modern, legacy]) {
    for (const n of ['Evolution24 Intro 16x9', 'Evolution24 Intro 9x16']) {
      const c = m.project.items.find((x) => x.name === n);
      const intro = c.layers.find((l) => l.name === 'Intro');
      const matte = c.layers.find((l) => l.name === 'Curtain (matte)');
      assert.strictEqual(intro.source.name, `${n} contents`);
      assert.ok(intro.matte === matte && intro.trackMatteType === MATTE.ALPHA, 'alpha matte');
      assert.ok(c.layers.indexOf(matte) === c.layers.indexOf(intro) - 1, 'the matte sits just above');
      assert.strictEqual(matte.enabled, false);
    }
  }
});
test('the lockup hangs the mark and each line of words from its own null, as the header\'s SVG groups do', () => {
  const c = byName('Evolution24 Lockup Build 16x9');
  const named = (n) => c.layers.find((l) => l.name === n);
  const top = named('Lockup (move and scale me)');
  ['Mark', 'EVOLUTION24', 'PROPERTIES'].forEach((n) => assert.strictEqual(named(n).parent, top));
  const letters = c.layers.filter((l) => /^Letter/.test(l.name)).reverse();
  assert.strictEqual(letters.filter((l) => l.parent === named('EVOLUTION24')).map((l) => l.name.slice(-1)).join(''), 'EVOLUTION24');
  assert.strictEqual(letters.filter((l) => l.parent === named('PROPERTIES')).map((l) => l.name.slice(-1)).join(''), 'PROPERTIES');
  assert.ok(c.layers.filter((l) => /^Bar/.test(l.name)).every((l) => l.parent === named('Mark')));
  assert.ok(!c.layers.some((l) => l.kind === 'solid'), 'transparent: no background');
});
test('every piece is keyframed from the website\'s timing: bars grow, letters rise and fade in', () => {
  const scene = exportScene(modern.project);
  const intro = scene.find((c) => c.name === 'Evolution24 Intro 16x9 contents');
  const bars = intro.layers.filter((l) => /^Bar/.test(l.name)).reverse();
  bars.forEach((b, i) => {
    const s = b.transform['ADBE Scale'].keys;
    assert.strictEqual(s.length, 2);
    assert.ok(Math.abs(s[0].t - (0.15 + 0.07 * i)) < 1e-9 && Math.abs(s[1].t - s[0].t - 1.05) < 1e-9, `${b.name} timing`);
    assert.deepStrictEqual([s[0].v[1], s[1].v[1]], [0, 100]);
  });
  const letters = intro.layers.filter((l) => /^Letter/.test(l.name)).reverse();
  letters.forEach((l, i) => {
    const pos = l.transform['ADBE Position'].keys;
    assert.ok(Math.abs(pos[0].t - (0.9 + 0.032 * i)) < 1e-9 && Math.abs(pos[1].t - pos[0].t - 0.9) < 1e-9, `${l.name} timing`);
    assert.ok(pos[0].v[1] > pos[1].v[1] && pos[0].v[0] === pos[1].v[0], `${l.name} rises straight up`);
    assert.deepStrictEqual(l.transform['ADBE Opacity'].keys.map((k) => k.v), [0, 100]);
    assert.strictEqual(l.effects.length, 1);
    assert.match(l.effects[0].blurriness.expression, /thisLayer\.parent\.transform\.scale/);
  });
  const phone = scene.find((c) => c.name === 'Evolution24 Intro 9x16 contents');
  assert.ok(phone.layers.filter((l) => /^Letter/.test(l.name)).every((l) => l.effects.length === 0), 'the phone timing has no blur');
});
test('the easing is the website\'s curve, as speed and influence', () => {
  const scene = exportScene(modern.project);
  const bar = scene.find((c) => c.name === 'Evolution24 Intro 16x9 contents').layers.find((l) => l.name === 'Bar 01');
  const [k0, k1] = bar.transform['ADBE Scale'].keys;
  // cubic-bezier(.2, .7, .1, 1) over 1.05 s for 0 to 100: leaves at 0.7/0.2 x 100/1.05 %/s with 20% influence, lands at 0 with 90%
  assert.ok(Math.abs(k0.outEase[1].speed - 0.7 / 0.2 * 100 / 1.05) < 1e-6 && Math.abs(k0.outEase[1].influence - 20) < 1e-9);
  assert.ok(Math.abs(k1.inEase[1].speed) < 1e-9 && Math.abs(k1.inEase[1].influence - 90) < 1e-9);
  assert.ok(k0.outEase[0].speed === 0 && k0.outEase.length === 3, 'width does not change');
  assert.strictEqual(k0.outType, KIT.BEZIER);
});
test('only After Effects\' own match names are used', () => {
  const known = new Set([...Object.keys(GROUPS), ...Object.values(GROUPS).flat().map((x) => x[0]), ...Object.keys(ADDABLE)]);
  modern.log.matchNames.forEach((m) => assert.ok(known.has(m), m));
});

if (process.argv.includes('--export')) {
  const out = process.argv[process.argv.indexOf('--export') + 1];
  fs.writeFileSync(out, JSON.stringify(exportScene(modern.project)));
  console.log(`wrote ${out}`);
}
results.forEach(([s, n]) => console.log(s, n));
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
