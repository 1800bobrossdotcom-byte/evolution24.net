#!/usr/bin/env python3
"""Nine posts for the Instagram profile: a "Now renting" campaign, from what the site has available.

    python3 tools/instagram/leasing.py [out-dir]     (default: tools/instagram/out/leasing)

Each post is a 1080 x 1440 (3:4) picture that stands on its own in the feed:
  five listings   the corners and the center: a building's photo, full bleed, with a tan "Now
                  available" stamp carrying how many of its homes are free, and a listing card at
                  the foot: the city, the building, the kinds of home and the rent they start at
  four statements between them, a cross of big words on ink and tan: Now renting. Now available.
                  Now touring. Apply online.
The counts, kinds and rents come from data/properties.json, the same list the site's "Available
now" shows, so run this again after the site's list changes. A listing whose building has nothing
available stops the run, as does a photo blown up beyond what its pixels can hold, and every block
of words is checked to sit inside the post's margins.

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
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "out" / "leasing"
WORK = OUT / "work"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load("build", ROOT / "scripts/build.py")          # the site's logo, names, units, rents and phone
kit = load("kit", HERE / "make.py")                         # the first kit: fonts, grading, the phone preview
PROPS = {p["slug"]: p for p in build.PROPS}

TW, TH = 1080, 1440                  # one post, 3:4, the shape of Instagram's profile grid
EDGE = 64                            # the margin words keep from a post's edge
MAX_ZOOM = 1.3                       # how far a photo may be enlarged before it goes soft
ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>'


def kinds(units):
    """The kinds of home free, as the site's unit cards name them: "Studio & 1-bed", "2-bed"."""
    return " & ".join("Studio" if b == 0 else f"{b}-bed" for b in sorted({u["beds"] for u in units}))


def span(units):
    """The range across them, as the site's property pages put it: "studios to 3 bedrooms"."""
    lo, hi = min(u["beds"] for u in units), max(u["beds"] for u in units)
    first = "studios" if lo == 0 else f"{lo} bedrooms"
    return first if lo == hi else f"{first} to {hi} bedrooms"


def rent(units):
    low = min(u["rent"] for u in units)
    return f"{'From ' if len(units) > 1 else ''}{build.money(low)} a month"


# The statements: the big words, the line under them, and what to do next. Their numbers are the site's.
STATEMENTS = {
    "renting": dict(tone="ink", big="Now<br><em>renting.</em>",
                    line="Apartments with character in Rochester, Syracuse and Geneva, New York.",
                    act="Find a home · link in bio"),
    "available": dict(tone="tan", big="Now<br><em>available.</em>",
                      line=f"{len(build.ALL_UNITS)} homes ready to rent: {span([u for _, u in build.ALL_UNITS])}, "
                           f"from {build.money(build.RENT_FROM)} a month.",
                      act="See them all · link in bio"),
    "touring": dict(tone="tan", big="Now<br><em>touring.</em>",
                    line=f"Ask for a tour through the link in our bio, or call the office on {build.PHONE}.",
                    act="Book a tour · link in bio"),
    "apply": dict(tone="ink", big="Apply<br><em>online.</em>",
                  line="Every available apartment has an Apply button on evolution24.net.",
                  act=f"{build.EHO}Equal Housing Opportunity"),
}

# The grid, left to right and top to bottom: listings at the corners and the center, the
# statements in a cross between them. focus is where to keep when a photo is cropped to 3:4.
GRID = [
    dict(slug="181-st-paul-street", file="01-exterior.jpg"),
    "renting",
    dict(slug="561-south-main-street", file="04-bedroom.jpg"),
    "available",
    dict(slug="water-street", file="03-loft-mezzanine.jpg"),
    "touring",
    dict(slug="121-park-drive", file="01-exterior.jpg"),
    "apply",
    dict(slug="145-south-fitzhugh-street", file="15-studio-bedroom.jpg"),
]

ROW, COL = {0: "top", 1: "middle", 2: "bottom"}, {0: "left", 1: "middle", 2: "right"}
problems = []


def photo(spec):
    """The original, turned upright, cropped to a post and graded like the first kit."""
    im = ImageOps.exif_transpose(Image.open(ROOT / "source/photos" / spec["slug"] / spec["file"])).convert("RGB")
    zoom = max(TW / im.width, TH / im.height)
    if zoom > MAX_ZOOM:
        problems.append(f"{spec['slug']}/{spec['file']} is enlarged {zoom:.2f}x: choose a larger photo")
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


def stamp(n):
    """A round sticker: "Now available" around the edge, how many in the middle."""
    ring = " · ".join(["Now available"] * 3) + " · "
    return ('<svg class="t stamp" viewBox="0 0 300 300" aria-hidden="true">'
            '<defs><path id="ring" d="M150 150m-112 0a112 112 0 1 1 224 0a112 112 0 1 1-224 0"/></defs>'
            '<circle cx="150" cy="150" r="148" class="disc"/><circle cx="150" cy="150" r="84" class="rule"/>'
            f'<text class="ring"><textPath href="#ring" textLength="700" lengthAdjust="spacing">{ring}</textPath></text>'
            f'<text x="150" y="168" class="count">{n}</text>'
            f'<text x="150" y="200" class="unit">{"home" if n == 1 else "homes"}</text></svg>')


def listing_page(spec):
    p = PROPS[spec["slug"]]
    units = p["units"]
    if not units:
        problems.append(f"{p['name']} has nothing available on the site: give its place in GRID to another building")
        return ""
    card = ('<div class="card">'
            + t("kicker", build.esc(f"{p['city']} · Now available"))
            + t("name", build.esc(p["name"]))
            + t("facts", f"<span>{kinds(units)}</span><span>{rent(units)}</span>")
            + "</div>")
    return page(f'<img class="photo" src="{photo(spec)}" alt="">{stamp(len(units))}{card}', "listing")


def statement_page(key):
    s = STATEMENTS[key]
    on_ink = s["tone"] == "ink"
    colors = kit.ON_INK if on_ink else ("#8a6232", "#151613")   # the logo's tan and cream, or brown and ink on tan
    lockup = build.standalone_lockup(colors).replace("<svg ", '<svg class="lockup" ', 1)
    body = (lockup + t("big", s["big"]) + t("line", build.esc(s["line"]))
            + t("act", s["act"] if key == "apply" else f"{build.esc(s['act'])}{ARROW}"))
    return page(body, f"statement {s['tone']}")


CSS = """
:root{--ink:#151613;--paper:#f4f1ea;--tan:#debb92;--cream:#eeeadf;--accent:#8a6232;--muted:#5c5d55}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--ink)}
.post{position:relative;width:1080px;height:1440px;overflow:hidden;background:var(--ink);color:var(--cream)}
.t{white-space:nowrap}
.photo{position:absolute;inset:0;width:100%;height:100%;display:block}
.stamp{position:absolute;top:96px;right:96px;width:300px;height:300px;transform:rotate(-10deg);white-space:normal}
.stamp .disc{fill:var(--tan)}
.stamp .rule{fill:none;stroke:var(--ink);stroke-width:2;opacity:.35}
.stamp .ring{font:800 25px Manrope;letter-spacing:.2em;text-transform:uppercase;fill:var(--ink)}
.stamp .count{font:400 112px 'Instrument Serif';text-anchor:middle;fill:var(--ink)}
.stamp .unit{font:800 17px Manrope;letter-spacing:.28em;text-transform:uppercase;text-anchor:middle;fill:var(--ink)}
.card{position:absolute;left:48px;right:48px;bottom:48px;background:var(--paper);color:var(--ink);padding:52px 56px 50px;
  box-shadow:0 18px 50px rgba(21,22,19,.28)}
.kicker{font:800 23px/1 Manrope;letter-spacing:.28em;text-transform:uppercase;color:var(--accent)}
.name{margin-top:24px;font:400 104px/1 'Instrument Serif';letter-spacing:-.01em}
.facts{display:flex;margin-top:34px;padding-top:28px;border-top:2px solid rgba(21,22,19,.14);font:600 32px/1 Manrope}
.facts span+span{margin-left:28px;padding-left:28px;border-left:2px solid rgba(21,22,19,.18)}
.statement{padding:96px 80px}
.statement.tan{background:var(--tan);color:var(--ink)}
.lockup{width:420px;display:block}
.big{margin-top:250px;font:400 236px/.9 'Instrument Serif';letter-spacing:-.02em}
.big em{font-style:italic;color:var(--tan)}
.tan .big em{color:var(--accent)}
.line{margin-top:64px;white-space:normal;max-width:860px;font:500 38px/1.4 Manrope;color:rgba(238,234,223,.85)}
.tan .line{color:rgba(21,22,19,.8)}
.act{position:absolute;left:80px;bottom:104px;display:flex;align-items:center;gap:16px;
  font:800 24px/1 Manrope;letter-spacing:.26em;text-transform:uppercase;color:var(--tan)}
.tan .act{color:var(--ink)}
.act svg{width:34px;height:34px}
"""

# In the page: every block of words must sit inside the post, EDGE from each side, and not overflow.
CHECK = """
document.fonts.ready.then(() => {
  document.querySelectorAll('.t').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.left < %(EDGE)d || r.top < %(EDGE)d || r.right > 1080 - %(EDGE)d || r.bottom > 1440 - %(EDGE)d ||
        (el.scrollWidth || 0) > (el.clientWidth || 0) + 1) {
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
        what = spec if isinstance(spec, str) else spec["slug"]
        files[(r, c)] = f"{order:02d}-{spot}-{what}.jpg"
        html = WORK / f"{order:02d}.html"
        html.write_text(statement_page(spec) if isinstance(spec, str) else listing_page(spec))
        jobs.append(dict(html=html, png=WORK / f"{order:02d}.png", width=TW, height=TH))
    if problems:
        sys.exit("\n".join(problems))
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

    shutil.copy(HERE / "captions-leasing.md", OUT / "captions.md")
    zpath = OUT / "evolution24-now-renting.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ["posts/" + files[k] for k in sorted(files, key=lambda k: files[k])] + [
                "grid.jpg", "grid-gaps.jpg", "profile-preview.png", "profile-picture.png", "captions.md"]:
            z.write(OUT / f, Path("evolution24-now-renting") / f)
    for f in sorted(OUT.rglob("*")):
        if f.is_file() and WORK not in f.parents:
            print(f"{f.relative_to(OUT)}  {f.stat().st_size // 1024} KB")
    print(f"Availability and rents as the site listed them on {build.fmt_date(build.UNITS_AS_OF)}.")


if __name__ == "__main__":
    main()
