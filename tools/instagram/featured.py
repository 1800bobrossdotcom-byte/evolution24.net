#!/usr/bin/env python3
"""Nine posts for the Instagram profile: eight of our buildings, one to a post, around the brand.

    python3 tools/instagram/featured.py [out-dir]     (default: tools/instagram/out/featured)

Each post is a 1080 x 1440 (3:4) picture that stands on its own in the feed:
  eight posts   one photo each from a different building, full bleed, graded like the first kit,
                with the city, the building's name and a line about it at the foot, as the
                site's cards name them
  the center    the brand on ink: the logo, "An evolution in home.", the numbers and the website
Together they make the profile's grid, exteriors and rooms in turn around the brand. Every block
of words is checked to sit inside the post's margins, and a photo blown up beyond what its pixels
can hold stops the run.

Writes into out-dir: posts/01-...jpg to 09-...jpg (numbered in upload order), grid.jpg (the nine
as one), grid-gaps.jpg (as the profile shows them, with its thin gaps), profile-preview.png (a
phone, light and dark), captions.md, and a zip of the lot. Needs Pillow and Playwright.
"""
import importlib.util
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "out" / "featured"
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
EDGE = 64                            # the margin words keep from a post's edge
MAX_ZOOM = 1.3                       # how far a photo may be enlarged before it goes soft

# The grid, left to right and top to bottom. focus is where to keep when a photo is cropped to
# 3:4; note is a line about the building, taken from its description on the site.
BRAND = "brand"
GRID = [
    dict(slug="181-st-paul-street", file="01-exterior.jpg", note="Loft studios, downtown"),
    dict(slug="561-south-main-street", file="04-bedroom.jpg", note="Pressed-tin ceilings"),
    dict(slug="charlotte-square", file="01-exterior-facade.jpg", focus=(0.55, 0.5), note="Luxury apartments, East End"),
    dict(slug="301-central-avenue", file="08-bedroom-brick.jpg", note="Renovated, downtown"),
    BRAND,
    dict(slug="145-south-fitzhugh-street", file="09-kitchen-red-fridge.jpg", focus=(0.6, 0.5), note="Studios and 1 bedrooms"),
    dict(slug="biltmore", file="01-lobby.png", note="A restored mosaic lobby"),
    dict(slug="water-street", file="03-loft-mezzanine.jpg", note="Lofts with high ceilings"),
    dict(slug="121-park-drive", file="01-exterior.jpg", note="A restored Victorian"),
]

ROW, COL = {0: "top", 1: "middle", 2: "bottom"}, {0: "left", 1: "middle", 2: "right"}
too_soft = []


def photo(spec):
    """The original, turned upright, cropped to a post and graded like the first kit."""
    im = ImageOps.exif_transpose(Image.open(ROOT / "source/photos" / spec["slug"] / spec["file"])).convert("RGB")
    zoom = max(TW / im.width, TH / im.height)
    if zoom > MAX_ZOOM:
        too_soft.append(f"{spec['slug']}/{spec['file']} is enlarged {zoom:.2f}x")
    im = kit.grade(ImageOps.fit(im, (TW, TH), Image.LANCZOS, centering=spec.get("focus", (0.5, 0.5))))
    name = f"{spec['slug']}-{Path(spec['file']).stem}.jpg"
    im.save(WORK / name, quality=94, subsampling=0)
    return name


# ---------------------------------------------------------------- the pages
def t(cls, html):
    """A block of words. Every one is checked against the post's margins."""
    return f'<div class="t {cls}">{html}</div>'


def page(body, cls=""):
    return (f'<!doctype html><meta charset="utf-8"><style>{kit.fonts()}{CSS}</style>'
            f'<div class="post {cls}">{body}</div><script>{CHECK % dict(EDGE=EDGE - 8)}</script>')


def building_page(spec):
    p = PROPS[spec["slug"]]
    words = (t("kicker", build.esc(p["city"])) + t("name", build.esc(p["name"])) + t("note", build.esc(spec["note"])))
    return page(f'<img class="photo" src="{photo(spec)}" alt=""><div class="shade"></div><div class="foot">{words}</div>')


def brand_page():
    lockup = build.standalone_lockup().replace("<svg ", '<svg class="lockup" ', 1)   # tan and cream, for ink
    stats = [(len(build.PROPS), "Properties"), (3, "Cities"), (build.FOUNDED, "Founded")]
    body = (lockup
            + t("h1", "An evolution<br>in <em>home.</em>")
            + t("lede", "Apartments with character in<br>Rochester, Syracuse and Geneva.")
            + t("stats", "".join(f"<div><b>{n}</b><span>{lab}</span></div>" for n, lab in stats))
            + t("site", f"evolution24.net&ensp;·&ensp;{build.PHONE}"))
    return page(body, "brand")


CSS = """
:root{--ink:#151613;--paper:#f4f1ea;--tan:#debb92;--cream:#eeeadf}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--ink)}
.post{position:relative;width:1080px;height:1440px;overflow:hidden;background:var(--ink);color:var(--cream)}
.photo{position:absolute;inset:0;width:100%;height:100%;display:block}
.shade{position:absolute;inset:0;background:linear-gradient(0deg,rgba(21,22,19,.86),rgba(21,22,19,.55) 300px,rgba(21,22,19,0) 640px)}
.foot{position:absolute;left:72px;right:72px;bottom:96px}
.t{white-space:nowrap}
.kicker{font:700 24px/1 Manrope;letter-spacing:.28em;text-transform:uppercase;color:var(--tan)}
.name{margin-top:26px;font:400 118px/1 'Instrument Serif';letter-spacing:-.01em}
.note{margin-top:24px;font:500 32px/1.2 Manrope;color:rgba(238,234,223,.88)}
.brand{display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:150px}
.lockup{width:600px}
.h1{margin-top:150px;font:400 172px/.98 'Instrument Serif';letter-spacing:-.012em}
.h1 em{font-style:italic;color:var(--tan)}
.lede{margin-top:56px;font:500 32px/1.45 Manrope;color:rgba(238,234,223,.82)}
.stats{margin-top:96px;width:780px;display:grid;grid-template-columns:repeat(3,1fr);border-top:3px solid rgba(238,234,223,.3);padding-top:36px}
.stats b{display:block;font:400 104px/1 'Instrument Serif'}
.stats span{display:block;margin-top:16px;font:700 21px/1 Manrope;letter-spacing:.26em;text-transform:uppercase;color:rgba(238,234,223,.75)}
.site{position:absolute;bottom:110px;font:700 24px/1 Manrope;letter-spacing:.26em;text-transform:uppercase;color:var(--tan)}
"""

# In the page: every block of words must sit inside the post, EDGE from each side.
CHECK = """
document.fonts.ready.then(() => {
  document.querySelectorAll('.t').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.left < %(EDGE)d || r.top < %(EDGE)d || r.right > 1080 - %(EDGE)d || r.bottom > 1440 - %(EDGE)d || el.scrollWidth > el.clientWidth + 1) {
      console.error('text too near the edge: "' + el.textContent.slice(0, 40) + '" at ' +
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
    jobs, files = [], {}
    for i, spec in enumerate(GRID):
        r, c = divmod(i, 3)
        order = 9 - i                          # Instagram puts the newest post top left: post bottom right first
        spot = "center" if (r, c) == (1, 1) else f"{ROW[r]}-{COL[c]}"
        what = "brand" if spec == BRAND else spec["slug"]
        files[(r, c)] = f"{order:02d}-{spot}-{what}.jpg"
        html = WORK / f"{order:02d}.html"
        html.write_text(brand_page() if spec == BRAND else building_page(spec))
        jobs.append(dict(html=html, png=WORK / f"{order:02d}.png", width=TW, height=TH))
    if too_soft:
        sys.exit("Photos enlarged past %.1fx (choose a larger one):\n  " % MAX_ZOOM + "\n  ".join(too_soft))
    (WORK / "avatar.html").write_text(kit.avatar_page("#151613", kit.ON_INK))
    render(jobs + [dict(html=WORK / "avatar.html", png=OUT / "profile-picture.png", width=1080, height=1080)])

    tiles = {}
    whole = Image.new("RGB", (3 * TW, 3 * TH))
    for (r, c), name in files.items():
        tiles[(r, c)] = Image.open(WORK / f"{name[:2]}.png").convert("RGB")
        kit.save_jpeg(tiles[(r, c)], OUT / "posts" / name)
        whole.paste(tiles[(r, c)], (c * TW, r * TH))
    kit.save_jpeg(whole, OUT / "grid.jpg", quality=90)
    kit.save_jpeg(gaps(tiles), OUT / "grid-gaps.jpg", quality=92)

    kit.KIT = OUT                            # the first kit's phone preview, pointed at these posts
    (WORK / "preview.html").write_text(kit.preview_page(files))
    render([dict(html=WORK / "preview.html", png=OUT / "profile-preview.png", width=860, height=916, scale=3)])

    shutil.copy(HERE / "captions-featured.md", OUT / "captions.md")
    zpath = OUT / "evolution24-featured-grid.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ["posts/" + files[k] for k in sorted(files, key=lambda k: files[k])] + [
                "grid.jpg", "grid-gaps.jpg", "profile-preview.png", "profile-picture.png", "captions.md"]:
            z.write(OUT / f, Path("evolution24-featured-grid") / f)
    for f in sorted(OUT.rglob("*")):
        if f.is_file() and WORK not in f.parents:
            print(f"{f.relative_to(OUT)}  {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
