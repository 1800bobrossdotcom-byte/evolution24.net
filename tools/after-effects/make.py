#!/usr/bin/env python3
"""Evolution24 Properties: the animated logo, as an After Effects project.

    python3 tools/after-effects/make.py

After Effects writes its project files (.aep) only itself, so this writes the next best
thing: an After Effects script that builds the project. Run it in After Effects (File >
Scripts > Run Script File) and it makes the comps below and saves "Evolution24 Logo.aep"
beside itself. Every bar of the mark and every letter of the wordmark becomes a native,
editable shape layer, keyframed with the website's own timing and easing:

  Evolution24 Intro 16x9          the home page's intro as on a laptop: the bars rise, the
                                  letters settle, the line fills, the curtain lifts (2.95 s)
  Evolution24 Intro 9x16          the same intro as on a phone, in its quicker timing (1.75 s)
  Evolution24 Lockup Build 16x9   the header logo's build, on transparency

It writes tools/after-effects/evolution24-logo.jsx (kept in the repository) and, in
tools/after-effects/out/ (not kept), the kit to hand over: the script, the logo as SVG with
every bar and letter named, a README, the reference videos that reference.cjs renders from
the live site, and Evolution24-Logo-After-Effects.zip.

The paths come from the traced PSD (source/logo/logo_vec.json), in the same order and
1000 x 410 box as the website's. The timing comes from assets/css/main.css: this checks the
stylesheet still says what is written below, and stops if it has changed.
"""
import importlib.util
import json
import math
import re
import shutil
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / "out"
KIT = "Evolution24-Logo-After-Effects"

spec = importlib.util.spec_from_file_location("build", ROOT / "scripts/build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)                      # the site's logo, in the site's order

LETTERS = "EVOLUTION24PROPERTIES"
COLORS = {"ink": "#151613", "tan": "#debb92", "cream": "#e5e6d3", "paper": "#f4f1ea"}
EASE = (0.2, 0.7, 0.1, 1.0)                         # --ease
EASE_IN_OUT = (0.7, 0.0, 0.2, 1.0)                  # --ease-in-out

# The website's animation, in seconds. "step" is the stagger per bar or letter (the CSS --d).
INTRO_LAPTOP = dict(
    bar=dict(dur=1.05, delay=0.150, step=0.070),
    word=dict(dur=0.90, delay=0.900, step=0.032, rise=0.70, blur=4.0),   # blur in logo units
    line=dict(dur=1.90, delay=0.100),
    out=dict(dur=0.90, delay=2.050),
)
INTRO_PHONE = dict(
    bar=dict(dur=0.60, delay=0.060, step=0.032),
    word=dict(dur=0.50, delay=0.420, step=0.016, rise=0.60, blur=0.0),
    line=dict(dur=1.05, delay=0.100),
    out=dict(dur=0.60, delay=1.150),
)
HEADER = dict(
    bar=dict(dur=0.90, delay=0.150, step=0.045, fade=0.40),            # opacity reaches 1 at 40%
    word=dict(dur=0.80, delay=0.420, step=0.022, rise=0.40, blur=0.0),
)
# What the stylesheet must still say for the numbers above to be right.
CSS_FACTS = [
    "--ease: cubic-bezier(.2, .7, .1, 1);",
    "--ease-in-out: cubic-bezier(.7, 0, .2, 1);",
    "animation: intro-out .9s var(--ease-in-out) 2.05s forwards;",
    "html.is-intro .intro svg { width: min(72vw, 560px);",
    "html.is-intro .intro .lg-piece { animation: intro-bar 1.05s var(--ease) both; animation-delay: calc(var(--d, 0) * 70ms + 150ms); }",
    "html.is-intro .intro .lg-word { animation: intro-word .9s var(--ease) both; animation-delay: calc(var(--d, 0) * 32ms + 900ms); }",
    "left: 50%; bottom: 14vh; width: 120px; height: 1px;",
    "animation: intro-progress 1.9s var(--ease-in-out) both .1s;",
    "@keyframes intro-bar { from { transform: scaleY(0); } to { transform: none; } }",
    "@keyframes intro-word { from { opacity: 0; transform: translateY(70%); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }",
    "@keyframes intro-out { from { clip-path: inset(0 0 0 0); } to { clip-path: inset(0 0 100% 0); visibility: hidden; } }",
    "html.is-intro .intro { animation-duration: .6s; animation-delay: 1.15s; }",
    "html.is-intro .intro .lg-piece { animation-duration: .6s; animation-delay: calc(var(--d, 0) * 32ms + 60ms); }",
    "html.is-intro .intro .lg-word { animation-name: intro-word-lite; animation-duration: .5s; animation-delay: calc(var(--d, 0) * 16ms + 420ms); }",
    "html.is-intro .intro .intro-line::after { animation-duration: 1.05s; }",
    "@keyframes intro-word-lite { from { opacity: 0; transform: translateY(60%); } to { opacity: 1; transform: none; } }",
    ".lg-piece { transform-box: fill-box; transform-origin: 50% 100%; }",
    ".lg-word { transform-box: fill-box; transform-origin: 50% 100%; }",
    ".brand .lg-piece { animation: bar-rise .9s var(--ease) both; animation-delay: calc(var(--d, 0) * 45ms + 150ms); }",
    ".brand .lg-word { animation: word-in .8s var(--ease) both; animation-delay: calc(var(--d, 0) * 22ms + 420ms); }",
    "@keyframes bar-rise { from { transform: scaleY(0); opacity: 0; } 40% { opacity: 1; } to { transform: none; } }",
    "@keyframes word-in { from { opacity: 0; transform: translateY(40%); } to { opacity: 1; transform: none; } }",
]

# The comps. The intros are framed as the site is: 16x9 as a 1440-wide laptop window, 9x16 as
# a 360-wide phone, each scaled up to the frame (k = frame pixels per CSS pixel).
COMPS = [
    dict(key="intro16", name="Evolution24 Intro 16x9", w=1920, h=1080, css_w=1440, timing=INTRO_LAPTOP, dur=3.5),
    dict(key="intro9", name="Evolution24 Intro 9x16", w=1080, h=1920, css_w=360, timing=INTRO_PHONE, dur=2.5),
    dict(key="lockup", name="Evolution24 Lockup Build 16x9", w=1920, h=1080, lockup_w=1200, timing=HEADER, dur=3.0),
]
FPS = 60


# ---------------------------------------------------------------- the logo's paths
def _num(v):
    return float(v) / 6                               # the PSD at one-sixth scale, as the site


def subpaths(d):
    """An SVG path (absolute M, L, C, Z only) as After Effects shapes: vertices with in and out
    tangents relative to them, one closed shape per subpath."""
    toks = re.findall(r"[A-Za-z]|-?\d+(?:\.\d+)?", d)
    assert set(t for t in toks if t.isalpha()) <= set("MLCZ"), f"unexpected path commands in {d[:60]}"
    shapes, cur, cmd, i = [], None, None, 0

    def close(s):
        v = s["v"]
        if len(v) > 1 and math.dist(v[0], v[-1]) < 1e-6:
            s["i"][0] = s["i"][-1]
            for k in "vio":
                s[k].pop()

    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd == "Z":
                close(cur)
                cur = None
            continue
        if cmd == "M":
            cur = {"v": [(_num(toks[i]), _num(toks[i + 1]))], "i": [(0.0, 0.0)], "o": [(0.0, 0.0)]}
            shapes.append(cur)
            i += 2
            cmd = "L"                                 # coordinates after a moveto are linetos
        elif cmd == "L":
            cur["v"].append((_num(toks[i]), _num(toks[i + 1])))
            cur["i"].append((0.0, 0.0))
            cur["o"].append((0.0, 0.0))
            i += 2
        elif cmd == "C":
            x1, y1, x2, y2, x, y = (_num(v) for v in toks[i:i + 6])
            px, py = cur["v"][-1]
            cur["o"][-1] = (x1 - px, y1 - py)
            cur["v"].append((x, y))
            cur["i"].append((x2 - x, y2 - y))
            cur["o"].append((0.0, 0.0))
            i += 6
    if cur is not None:
        close(cur)
    return shapes


def bbox(shapes):
    """The exact box of the filled shape, curves included: what CSS calls the fill box."""
    xs, ys = [], []
    for s in shapes:
        n = len(s["v"])
        for k in range(n):
            p0 = s["v"][k]
            p3 = s["v"][(k + 1) % n]
            p1 = (p0[0] + s["o"][k][0], p0[1] + s["o"][k][1])
            p2 = (p3[0] + s["i"][(k + 1) % n][0], p3[1] + s["i"][(k + 1) % n][1])
            for axis, acc in ((0, xs), (1, ys)):
                a, b, c, e = p0[axis], p1[axis], p2[axis], p3[axis]
                acc += [a, e]
                # where the cubic's derivative is zero: q2 t^2 + q1 t + q0 = 0
                q2 = -a + 3 * b - 3 * c + e
                q1 = 2 * (a - 2 * b + c)
                q0 = b - a
                roots = []
                if abs(q2) < 1e-12:
                    if abs(q1) > 1e-12:
                        roots = [-q0 / q1]
                else:
                    disc = q1 * q1 - 4 * q2 * q0
                    if disc >= 0:
                        r = math.sqrt(disc)
                        roots = [(-q1 + r) / (2 * q2), (-q1 - r) / (2 * q2)]
                for t in roots:
                    if 0 < t < 1:
                        u = 1 - t
                        acc.append(u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * e)
    return [min(xs), min(ys), max(xs), max(ys)]


def pieces():
    """The 15 bars and 21 letters, in the website's order (lgi0..14, lgw0..20)."""
    src = build.LOGO_SRC
    icon, word = [], []
    for layer, cls in (("Icon cream", "c"), ("Icon tan", "t")):
        for c in src[layer]["comps"]:
            icon.append({"cls": cls, "raw": c["d"], "x": c["bbox"][0], "y": c["bbox"][1]})
    for layer, cls in (("Wordmark tan", "t"), ("Wordmark 24 cream", "c")):
        for c in src[layer]["comps"]:
            word.append({"cls": cls, "raw": c["d"], "x": c["bbox"][0]})
    icon.sort(key=lambda c: (c["x"], -c["y"]))
    word.sort(key=lambda c: c["x"])
    # Same order and shapes as the site, or stop: the AE comps must be the site's logo.
    assert [build._scale(c["raw"]) for c in icon] == [c["d"] for c in build.LOGO["icon"]]
    assert [build._scale(c["raw"]) for c in word] == [c["d"] for c in build.LOGO["word"]]
    assert len(icon) == 15 and len(word) == len(LETTERS) == 21
    line1 = {id(c) for c in build.LINE1}
    out = {"bars": [], "letters": []}
    for i, c in enumerate(icon):
        shapes = subpaths(c["raw"])
        out["bars"].append({"name": f"Bar {i + 1:02d}", "cls": c["cls"], "shapes": shapes, "box": bbox(shapes),
                            "d": build.LOGO["icon"][i]["d"]})
    for i, c in enumerate(word):
        shapes = subpaths(c["raw"])
        out["letters"].append({"name": f"Letter {i + 1:02d} {LETTERS[i]}", "char": LETTERS[i], "cls": c["cls"],
                               "shapes": shapes, "box": bbox(shapes), "line": 1 if id(build.LOGO["word"][i]) in line1 else 2,
                               "d": build.LOGO["word"][i]["d"]})
    assert "".join(p["char"] for p in out["letters"] if p["line"] == 1) == "EVOLUTION24"
    return out


def lockup_groups():
    """The header lockup's three groups (build.logo_lockup) as anchor, position and scale:
    translate(a b) scale(k) translate(c d) maps p to (a, b) + k (p - (-c, -d))."""
    k = 1.35
    top = (274 - (44 * 2 + 22) * k) / 2
    assert f'translate(420 {top:.1f}) scale({k}) translate(-6 -360)' in build.logo_lockup()
    assert 'translate(-318 -7)' in build.logo_lockup() and 'viewBox="0 0 1116 274"' in build.logo_lockup()
    return {"mark": {"anchor": [318, 7], "position": [0, 0], "scale": 100},
            "line1": {"anchor": [6, 360], "position": [420, top], "scale": k * 100},
            "line2": {"anchor": [562, 360], "position": [420, top + 66 * k], "scale": k * 100},
            "size": [1116, 274]}


# ---------------------------------------------------------------- the script
def rgb(hexcode):
    return [round(int(hexcode[i:i + 2], 16) / 255, 6) for i in (1, 3, 5)]


def js(v):
    """A value as ExtendScript (ES3) source: no trailing commas, plain ASCII."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        r = round(float(v), 4)
        return str(int(r)) if r == int(r) else repr(r)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=True)
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(js(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(f"{k}:{js(x)}" for k, x in v.items()) + "}"
    raise TypeError(v)


def flat(points):
    return [round(c, 2) for p in points for c in p]


def piece_js(p, extra=None):
    d = {"name": p["name"], "fill": "cream" if p["cls"] == "c" else "tan",
         "box": [round(c, 3) for c in p["box"]],
         "shapes": [{"v": flat(s["v"]), "i": flat(s["i"]), "o": flat(s["o"])} for s in p["shapes"]]}
    d.update(extra or {})
    return js(d)


def comp_specs():
    specs = []
    for c in COMPS:
        s = {"key": c["key"], "name": c["name"], "w": c["w"], "h": c["h"], "duration": c["dur"]}
        t = c["timing"]
        s["bar"] = t["bar"]
        s["word"] = t["word"]
        if "css_w" in c:                              # an intro: the site's overlay, framed as a browser window
            k = c["w"] / c["css_w"]
            css_h = c["h"] / k
            logo_css = min(0.72 * c["css_w"], 560)
            # The line: 120 x 1 CSS px, its bottom 14vh up. Chrome draws it on whole pixels, so
            # it is snapped here too, which keeps it crisp.
            line_top = round(round(css_h - 0.14 * css_h - 1) * k)
            s.update(layout="stacked", background=True, logoWidth=logo_css * k,
                     line={"w": 120 * k, "h": max(1, round(k)), "top": line_top, "dur": t["line"]["dur"], "delay": t["line"]["delay"]},
                     curtain={"dur": t["out"]["dur"], "delay": t["out"]["delay"]})
        else:
            s.update(layout="lockup", background=False, logoWidth=c["lockup_w"])
        specs.append(s)
    return specs


def jsx(data):
    p = data
    bars = ",\n    ".join(piece_js(b) for b in p["bars"])
    letters = ",\n    ".join(piece_js(l, {"line": l["line"]}) for l in p["letters"])
    colors = {k: rgb(v) for k, v in COLORS.items()}
    template = (HERE / "template.jsx").read_text()
    header = (f"// Generated by tools/after-effects/make.py from the website's logo paths and animation\n"
              f"// (source/logo/logo_vec.json, assets/css/main.css). Edit those or make.py, not this file.\n")
    body = (template
            .replace("/*@COLORS@*/", js(colors))
            .replace("/*@EASE@*/", js(list(EASE)))
            .replace("/*@EASE_IN_OUT@*/", js(list(EASE_IN_OUT)))
            .replace("/*@FPS@*/", js(FPS))
            .replace("/*@BARS@*/", "[\n    " + bars + "\n]")
            .replace("/*@LETTERS@*/", "[\n    " + letters + "\n]")
            .replace("/*@LOCKUP@*/", js(lockup_groups()))
            .replace("/*@COMPS@*/", js(comp_specs())))
    assert "/*@" not in body, "a placeholder was left in the template"
    text = header + body
    assert text.isascii(), "ExtendScript reads ASCII safely; keep the script ASCII"
    return text


# ---------------------------------------------------------------- the kit
def svg_stacked(data):
    fill = {"c": COLORS["cream"], "t": COLORS["tan"]}
    bars = "\n    ".join(f'<path id="{b["name"].lower().replace(" ", "-")}" fill="{fill[b["cls"]]}" d="{b["d"]}"/>' for b in data["bars"])
    letters = "\n    ".join(f'<path id="{l["name"].lower().replace(" ", "-")}" fill="{fill[l["cls"]]}" d="{l["d"]}"/>' for l in data["letters"])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 410" width="1000" height="410">\n'
            f'  <title>Evolution24 Properties</title>\n'
            f'  <g id="mark">\n    {bars}\n  </g>\n  <g id="wordmark">\n    {letters}\n  </g>\n</svg>\n')


def main():
    css = (ROOT / "assets/css/main.css").read_text()
    missing = [f for f in CSS_FACTS if f not in css]
    if missing:
        raise SystemExit("The website's logo animation has changed; update the timing in make.py to match:\n  "
                         + "\n  ".join(missing))
    data = pieces()
    script = jsx(data)
    (HERE / "evolution24-logo.jsx").write_text(script)
    print(f"wrote tools/after-effects/evolution24-logo.jsx ({len(script) // 1024} KB)")

    kit = OUT / KIT
    if kit.exists():
        shutil.rmtree(kit)
    (kit / "Vectors").mkdir(parents=True)
    (kit / "Evolution24 Logo.jsx").write_text(script)
    (kit / "Vectors" / "Evolution24 logo (stacked).svg").write_text(svg_stacked(data))
    shutil.copy(ROOT / "assets/img/logo.svg", kit / "Vectors" / "Evolution24 logo (as on the website).svg")
    (kit / "README.txt").write_text((HERE / "README.txt").read_text())
    refs = sorted((OUT / "reference").glob("*.mp4")) if (OUT / "reference").exists() else []
    if refs:
        (kit / "Reference").mkdir()
        for r in refs:
            shutil.copy(r, kit / "Reference" / r.name)
    zip_path = OUT / f"{KIT}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(kit.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(OUT))
    print(f"wrote {zip_path.relative_to(ROOT)} ({zip_path.stat().st_size // 1024} KB, {len(refs)} reference videos)")


if __name__ == "__main__":
    main()
