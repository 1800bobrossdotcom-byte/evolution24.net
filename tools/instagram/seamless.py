#!/usr/bin/env python3
"""A seamless nine for the Instagram profile, drawn from the website.

    python3 tools/instagram/seamless.py [out-dir]     (default: tools/instagram/out/seamless)

One 3240 x 4320 picture, cut into nine 1080 x 1440 (3:4) posts that join up on the profile grid:
  top row      the site's hero in type: the logo, "An evolution | in home." across the first two
               posts, and the numbers on the right, over a rule that runs the width of the row
  lower rows   the building mark as a skyline the width of the grid, each of its four buildings
               filled with a photo of one of ours, standing on a tan line over a strip of ink that
               carries the phone number, the website and "Find your place."
Pictures run across the posts' edges; words never do, so each post still reads on its own in the
feed. The page checks that, and the run fails if any text crosses an edge.

Writes into out-dir: posts/01-...jpg to 09-...jpg (numbered in upload order), grid.jpg (the nine
as one), grid-gaps.jpg (as the profile shows them, with its thin gaps), profile-preview.png (a
phone, light and dark), captions.md, and a zip of the lot. Needs Pillow and Playwright.
"""
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "out" / "seamless"
WORK = OUT / "work"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load("build", ROOT / "scripts/build.py")          # the site's logo, names, numbers and phone
kit = load("kit", HERE / "make.py")                         # the first kit: fonts, grading, the phone preview
PROPS = {p["slug"]: p for p in build.PROPS}

TW, TH = 1080, 1440                  # one post, 3:4, the shape of Instagram's profile grid
CW, CH = TW * 3, TH * 3              # the whole grid
EDGE = 56                            # how close text may come to a post's edge

# The building mark (build.LOGO["icon"]) in its own units, and where it stands on the grid.
MARK = (319, 8, 361, 273)            # x, y, width, height of the mark's paths
LEFT, RIGHT = 120, 3120              # the mark's width on the grid
BASE = 3960                          # the tan line the buildings stand on
S = (RIGHT - LEFT) / MARK[2]         # grid pixels per mark unit
FOOT = 278                           # the mark's ground line, in its units

# The mark's four buildings, left to right: which of its paths make each one, and whose photo
# fills it. Tan buildings take a tan duotone, cream ones a cream duotone, so the mark still reads.
BUILDINGS = [
    dict(paths=[0], slug="181-st-paul-street", file="01-exterior.jpg", focus=(0.5, 0.42), tone="cream"),
    dict(paths=[1], slug="biltmore", file="02-exterior.jpg", focus=(0.5, 0.4), tone="tan"),
    dict(paths=[2, 3, 4, 5, 6, 7], slug="121-park-drive", file="01-exterior.jpg", focus=(0.6, 0.66), zoom=1.3, tone="cream"),
    dict(paths=list(range(8, 15)), slug="charlotte-square", file="01-exterior-facade.jpg", focus=(0.66, 0.5), tone="tan"),
]
TONES = {"tan": ("#151613", "#8a6232", "#ecd3ad"), "cream": ("#151613", "#6b6a63", "#f1eee5")}

ROW, COL = {0: "top", 1: "middle", 2: "bottom"}, {0: "left", 1: "middle", 2: "right"}


# ---------------------------------------------------------------- the buildings' photos
def points(d):
    """A path's coordinates (the mark's paths are absolute lines and curves)."""
    nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", d)]
    return list(zip(nums[0::2], nums[1::2]))


def bbox(d):
    pts = points(d)
    return min(x for x, _ in pts), min(y for _, y in pts), max(x for x, _ in pts), max(y for _, y in pts)


def building_box(b):
    boxes = [bbox(build.LOGO["icon"][i]["d"]) for i in b["paths"]]
    return (min(x[0] for x in boxes), min(x[1] for x in boxes), max(x[2] for x in boxes), max(x[3] for x in boxes))


def duotone(im, tone):
    """Two inks and the paper. Blue counts for more than usual, so skies come out light, not brown."""
    dark, mid, light = TONES[tone]
    grey = ImageOps.autocontrast(im.convert("L", (0.22, 0.36, 0.42, 0)), cutoff=1)
    return ImageOps.colorize(grey, black=dark, mid=mid, white=light)


def building_photo(b, box):
    """The photo, turned upright, cropped to the building's shape at grid size, in its duotone."""
    w, h = round((box[2] - box[0]) * S), round((box[3] - box[1]) * S)
    im = ImageOps.exif_transpose(Image.open(ROOT / "source/photos" / b["slug"] / b["file"])).convert("RGB")
    if b.get("zoom"):                    # closer in, around the focus, before cropping to the shape
        z, (fx, fy) = b["zoom"], b["focus"]
        cw, ch = im.width / z, im.height / z
        x0 = min(max(fx * im.width - cw / 2, 0), im.width - cw)
        y0 = min(max(fy * im.height - ch / 2, 0), im.height - ch)
        im = im.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch)))
        b = dict(b, focus=(0.5, 0.5))
    im = duotone(ImageOps.fit(im, (w, h), Image.LANCZOS, centering=b["focus"]), b["tone"])
    name = f"{b['slug']}.jpg"
    im.save(WORK / name, quality=94, subsampling=0)
    return name


def skyline():
    """The mark as an SVG the width of the grid, each building clipped from its photo."""
    clips, images = [], []
    for i, b in enumerate(BUILDINGS):
        box = building_box(b)
        paths = "".join(f'<path d="{build.LOGO["icon"][p]["d"]}"/>' for p in b["paths"])
        clips.append(f'<clipPath id="b{i}">{paths}</clipPath>')
        images.append(f'<image href="{building_photo(b, box)}" x="{box[0]}" y="{box[1]}" width="{box[2] - box[0]}" '
                      f'height="{box[3] - box[1]}" preserveAspectRatio="xMidYMid slice" clip-path="url(#b{i})"/>')
    x, y, w, h = MARK
    style = f"left:{LEFT}px;top:{BASE - (FOOT - y) * S:.1f}px;width:{w * S:.1f}px;height:{h * S:.1f}px"
    return f'<svg class="mark" viewBox="{x} {y} {w} {h}" style="{style}"><defs>{"".join(clips)}</defs>{"".join(images)}</svg>'


def label_x(b):
    """Where a building's name goes on the ground: from the left of where it meets the ground."""
    feet = [x for i in b["paths"] for x, y in points(build.LOGO["icon"][i]["d"]) if y >= FOOT - 1]
    return LEFT + (min(feet) - MARK[0]) * S


# ---------------------------------------------------------------- the page
def t(cls, html, left, top, width=None, extra=""):
    """A block of words. Every one is checked against the posts' edges."""
    w = f"width:{width}px;" if width else ""
    return f'<div class="t {cls}" style="left:{left}px;top:{top}px;{w}{extra}">{html}</div>'


def page():
    lockup = build.standalone_lockup(("#b88d5a", "#151613")).replace("<svg ", '<svg class="lockup" ', 1)
    stats = [(len(build.PROPS), "Properties"), (3, "Cities"), (build.FOUNDED, "Founded")]
    names = "".join(f"<li>{build.esc(p['name'])}</li>" for p in build.PROPS)
    arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>'
    ground = BASE + 8
    blocks = [
        # Top row: the hero.
        t("nav", "Properties&ensp;·&ensp;Available now&ensp;·&ensp;About&ensp;·&ensp;Contact", TW + EDGE + 24, 128),
        t("pill-o", "Residents", 2 * TW + 760, 112),
        t("h1", "An evolution", EDGE + 34, 620),
        t("h1", "in <em>home.</em>", TW + EDGE + 24, 620),
        t("pills", f'<span class="pill">Find a home {arrow}</span><span class="pill o">Link in bio</span>', EDGE + 34, 960),
        t("lede", "Apartments with character across Rochester, Syracuse and Geneva, New York, from a family-owned "
                  "company that picks up the phone.", TW + EDGE + 24, 935, 820),
        t("stats", "".join(f"<div><b>{n}</b><span>{label}</span></div>" for n, label in stats), 2 * TW + EDGE + 24, 935, 860),
        # Middle row: about us, and the buildings by name.
        t("eyebrow", "Family-owned &amp; operated", EDGE + 34, 1560),
        t("h2", "Small by design.<br><em>Hands-on</em> by nature.", EDGE + 34, 1640),
        t("body", "Real people, quick answers, and homes we would be happy to live in ourselves.", EDGE + 34, 1990, 600),
        t("eyebrow", "Our buildings", 2 * TW + 540, 1560),
        t("names", f"<ul>{names}</ul>", 2 * TW + 540, 1640),
        # The ground: the phone, the website, and the close.
        t("ctl", "Call the office", EDGE + 34, ground + 132),
        t("cta", build.PHONE, EDGE + 34, ground + 180),
        t("ctl", "Tours &amp; applications&ensp;·&ensp;link in bio", TW + EDGE + 24, ground + 132),
        t("cta", "evolution24.net", TW + EDGE + 24, ground + 180),
        t("ctl", f"{build.EHO}Equal Housing Opportunity", 2 * TW + EDGE + 24, ground + 132),
        t("cta", "Find your <em>place.</em>", 2 * TW + EDGE + 24, ground + 180),
    ]
    for b in BUILDINGS:   # each building's name on the ground, under it
        blocks.append(t("tag", build.esc(PROPS[b["slug"]]["name"]), round(label_x(b)) + 6, ground + 34))
    css = CSS % dict(CW=CW, CH=CH, BASE=BASE, RULE=1300)
    return (f'<!doctype html><meta charset="utf-8"><style>{kit.fonts()}{css}</style><div class="canvas">'
            f'<div class="rule"></div>{lockup}{skyline()}<div class="ground"></div>{"".join(blocks)}</div>'
            f"<script>{CHECK % dict(TW=TW, TH=TH, EDGE=EDGE - 8)}</script>")


CSS = """
:root{--ink:#151613;--paper:#f4f1ea;--tan:#debb92;--tan-d:#b88d5a;--cream:#eeeadf;--accent:#8a6232;--muted:#5c5d55}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper)}
.canvas{position:relative;width:%(CW)dpx;height:%(CH)dpx;overflow:hidden;background:var(--paper);color:var(--ink)}
.rule{position:absolute;left:0;right:0;top:%(RULE)dpx;height:3px;background:rgba(21,22,19,.14)}
.lockup{position:absolute;left:90px;top:104px;width:540px}
.mark{position:absolute;overflow:visible}
.ground{position:absolute;left:0;right:0;top:%(BASE)dpx;bottom:0;background:var(--ink);border-top:10px solid var(--tan)}
.t{position:absolute;white-space:nowrap}
.nav{font:600 25px/1 Manrope;letter-spacing:.24em;text-transform:uppercase;color:rgba(21,22,19,.62)}
.pill-o{font:700 23px/1 Manrope;letter-spacing:.24em;text-transform:uppercase;border:2.5px solid rgba(21,22,19,.55);border-radius:99px;padding:20px 34px}
.h1{font:400 212px/1 'Instrument Serif';letter-spacing:-.012em}
.h1 em,.h2 em,.cta em{font-style:italic;color:var(--accent)}
.pills{display:flex;gap:22px}
.pill{display:inline-flex;align-items:center;gap:16px;font:700 24px/1 Manrope;letter-spacing:.22em;text-transform:uppercase;
  background:var(--tan);border:2.5px solid var(--tan);border-radius:99px;padding:24px 36px}
.pill svg{width:30px;height:30px}
.pill.o{background:none;border-color:rgba(21,22,19,.5)}
.lede{white-space:normal;font:500 38px/1.45 Manrope;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);border-top:3px solid rgba(21,22,19,.18);padding-top:34px}
.stats b{display:block;font:400 132px/1 'Instrument Serif'}
.stats span{display:block;margin-top:20px;font:700 22px/1 Manrope;letter-spacing:.26em;text-transform:uppercase;color:var(--muted)}
.eyebrow{display:flex;align-items:center;gap:22px;font:700 24px/1 Manrope;letter-spacing:.28em;text-transform:uppercase;color:var(--accent)}
.eyebrow:before{content:'';width:64px;height:3px;background:var(--accent)}
.h2{font:400 122px/.98 'Instrument Serif';letter-spacing:-.01em}
.body{white-space:normal;font:500 36px/1.45 Manrope;color:var(--muted)}
.names ul{list-style:none;font:italic 400 50px/1.32 'Instrument Serif'}
.tag{font:700 21px/1 Manrope;letter-spacing:.26em;text-transform:uppercase;color:var(--tan)}
.ctl{display:flex;align-items:center;gap:14px;font:700 22px/1 Manrope;letter-spacing:.26em;text-transform:uppercase;color:var(--tan)}
.ctl svg{width:30px;height:30px}
.cta{font:400 92px/1 'Instrument Serif';color:var(--cream)}
.cta em{color:var(--tan)}
"""

# In the page: no block of words may cross a post's edge, or come within EDGE of one.
CHECK = """
document.fonts.ready.then(() => {
  document.querySelectorAll('.t').forEach((el) => {
    const r = el.getBoundingClientRect();
    const c0 = Math.floor(r.left / %(TW)d), c1 = Math.floor((r.right - 1) / %(TW)d);
    const r0 = Math.floor(r.top / %(TH)d), r1 = Math.floor((r.bottom - 1) / %(TH)d);
    const inset = Math.min(r.left - c0 * %(TW)d, (c0 + 1) * %(TW)d - r.right, r.top - r0 * %(TH)d, (r0 + 1) * %(TH)d - r.bottom);
    if (c0 !== c1 || r0 !== r1 || inset < %(EDGE)d) {
      console.error('text too near or across a post edge: "' + el.textContent.slice(0, 40) + '" at ' +
        [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
    }
  });
});
"""


# ---------------------------------------------------------------- run
def render(jobs):
    listing = WORK / "jobs.json"
    listing.write_text(json.dumps([dict(j, html=str(j["html"]), png=str(j["png"])) for j in jobs]))
    subprocess.run(["node", str(HERE / "render.cjs"), str(listing)], check=True)


def gaps(tiles, gap=6, scale=1 / 3):
    """The nine as the profile shows them: small, with thin gaps between."""
    w, h = round(TW * scale), round(TH * scale)
    sheet = Image.new("RGB", (3 * w + 2 * gap, 3 * h + 2 * gap), "white")
    for (r, c), im in tiles.items():
        sheet.paste(im.resize((w, h), Image.LANCZOS), (c * (w + gap), r * (h + gap)))
    return sheet


def main():
    for sub in ("work", "posts"):
        shutil.rmtree(OUT / sub, ignore_errors=True)
    WORK.mkdir(parents=True)
    (OUT / "posts").mkdir(parents=True)
    (WORK / "grid.html").write_text(page())
    (WORK / "avatar.html").write_text(kit.avatar_page("#151613", kit.ON_INK))
    render([dict(html=WORK / "grid.html", png=WORK / "grid.png", width=CW, height=CH),
            dict(html=WORK / "avatar.html", png=OUT / "profile-picture.png", width=1080, height=1080)])

    whole = Image.open(WORK / "grid.png").convert("RGB")
    tiles, files = {}, {}
    for r in range(3):
        for c in range(3):
            order = 9 - (r * 3 + c)            # Instagram puts the newest post top left: post bottom right first
            spot = "center" if (r, c) == (1, 1) else f"{ROW[r]}-{COL[c]}"
            files[(r, c)] = f"{order:02d}-{spot}.jpg"
            tiles[(r, c)] = whole.crop((c * TW, r * TH, (c + 1) * TW, (r + 1) * TH))
            kit.save_jpeg(tiles[(r, c)], OUT / "posts" / files[(r, c)])
    kit.save_jpeg(whole, OUT / "grid.jpg", quality=90)
    kit.save_jpeg(gaps(tiles), OUT / "grid-gaps.jpg", quality=92)

    kit.KIT = OUT                            # the first kit's phone preview, pointed at these posts
    (WORK / "preview.html").write_text(kit.preview_page(files))
    render([dict(html=WORK / "preview.html", png=OUT / "profile-preview.png", width=860, height=916, scale=3)])

    shutil.copy(HERE / "captions-seamless.md", OUT / "captions.md")
    zpath = OUT / "evolution24-seamless-grid.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ["posts/" + files[k] for k in sorted(files, key=lambda k: files[k])] + [
                "grid.jpg", "grid-gaps.jpg", "profile-preview.png", "profile-picture.png", "captions.md"]:
            z.write(OUT / f, Path("evolution24-seamless-grid") / f)
    for f in sorted(OUT.rglob("*")):
        if f.is_file() and WORK not in f.parents:
            print(f"{f.relative_to(OUT)}  {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
