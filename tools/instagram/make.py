#!/usr/bin/env python3
"""The Instagram launch kit, drawn in the site's look.

    python3 tools/instagram/make.py [out-dir]        (default: tools/instagram/out)

Writes into out-dir/kit and zips it:
  profile-picture.png, profile-picture-paper.png   the building mark, 1080 x 1080
  posts/01-...jpg to posts/09-...jpg               nine 1080 x 1440 (3:4) posts, named in upload order
  grid.jpg                                         the nine together, as the profile shows them
  profile-preview.png                              how the profile looks, light and dark mode
  captions.md                                      bio, captions and alt text (copied from here)

The grid is drawn as one 3240 x 4320 picture and cut into nine. Photo windows sit on ink
above and below a paper band that runs straight across the middle row. The band carries
the story on the left and tours and applications on the right, and passes behind
Charlotte Square, the flagship, in the centre. Each post is still whole on its own in
the feed. Needs Pillow and Playwright, like render-icons.cjs.
"""
import importlib.util
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageCms, ImageEnhance, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "out"
WORK, KIT = OUT / "work", OUT / "kit"

spec = importlib.util.spec_from_file_location("build", ROOT / "scripts/build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)                     # the site's logo, names and phone number
PROPS = {p["slug"]: p for p in build.PROPS}

TW, TH = 1080, 1440                 # one post, 3:4, the shape of Instagram's profile grid
CW, CH = TW * 3, TH * 3             # the whole grid
WIN_X, WIN_W = 110, 860             # photo windows, in post coordinates
WIN_Y, WIN_B = 130, 1150
BAND_ROW = 1                        # the row the paper band runs across, at window height

ON_INK, ON_LIGHT = ("#debb92", "#e5e6d3"), ("#b88d5a", "#151613")

# (row, column) -> what the post shows. "order" is the upload order: Instagram puts the
# newest post top left, so the grid is posted from the bottom right.
TILES = {
    (0, 0): dict(order=9, kind="photo", slug="biltmore", file="01-lobby.png", focus=(0.5, 0.55),
                 meta="Furnished studios · Rochester"),
    (0, 1): dict(order=8, kind="photo", slug="water-street", file="03-loft-mezzanine.jpg", focus=(0.5, 0.5),
                 meta="Lofts · Downtown Rochester"),
    (0, 2): dict(order=7, kind="photo", slug="121-park-drive", file="01-exterior.jpg", focus=(0.5, 0.4),
                 meta="A restored Victorian · Manlius"),
    (1, 0): dict(order=6, kind="story", key="our-story", name="Real people, quick answers.",
                 meta="Family-owned & operated"),
    (1, 1): dict(order=5, kind="photo", slug="charlotte-square", file="01-exterior-facade.jpg", focus=(0.56, 0.5),
                 meta="Our flagship · charlottesquareroc.com"),
    (1, 2): dict(order=4, kind="cta", key="lets-find-your-place", name=build.PHONE, meta="Equal Housing Opportunity"),
    (2, 0): dict(order=3, kind="photo", slug="181-st-paul-street", file="01-exterior.jpg", focus=(0.5, 0.5),
                 meta="Loft studios · Rochester"),
    (2, 1): dict(order=2, kind="photo", slug="379-south-main-street", file="02-living-room.jpg", focus=(0.5, 0.45),
                 meta="Original fireplaces · Geneva"),
    (2, 2): dict(order=1, kind="photo", slug="561-south-main-street", file="04-bedroom.jpg", focus=(0.5, 0.4),
                 meta="Pressed-tin ceilings · Geneva"),
}
PLACE = {0: "top", 1: "middle", 2: "bottom"}
SIDE = {0: "left", 1: "middle", 2: "right"}


# ---------------------------------------------------------------- pieces
def grade(im, sat=0.92, con=1.04, warm=0.24):
    """One light grade so six cameras sit together: a touch less colour, a touch more
    contrast, and a little of the site's tan in the mid-tones."""
    im = ImageEnhance.Contrast(ImageEnhance.Color(im).enhance(sat)).enhance(con)
    tan = Image.new("RGB", im.size, (222, 187, 146))
    mids = im.convert("L").point(lambda v: int(255 * (1 - abs(v - 128) / 128) ** 1.2))
    return Image.blend(im, Image.composite(tan, im, mids), warm)


def photo(t):
    """The original, turned upright, cropped to the window at 2x and graded."""
    im = ImageOps.exif_transpose(Image.open(ROOT / "source/photos" / t["slug"] / t["file"])).convert("RGB")
    im = grade(ImageOps.fit(im, (WIN_W * 2, (WIN_B - WIN_Y) * 2), Image.LANCZOS, centering=t["focus"]))
    name = f"{t['slug']}-{Path(t['file']).stem}.jpg"
    im.save(WORK / name, quality=95, subsampling=0)
    return name


def on_band(t):
    """The words each post carries on the band."""
    k = t["kind"]
    if k == "story":
        return ('<p class="lab">Our story</p><h2>An evolution<br>in <em>home.</em></h2>'
                f'<p class="body">Founded in {build.FOUNDED} by a husband-and-wife duo with a passion for property management.</p>')
    if k == "cta":
        return ('<p class="lab">Tours &amp; applications</p><h2>Let’s find<br>your <em>place.</em></h2>'
                '<p class="body">See what’s available,<br>book a tour and apply online.</p>'
                '<p class="url">evolution24.net</p><p class="bio">Link in bio</p>')
    raise ValueError(k)


def post(r, c, t):
    """A window (a photo, or words on the band) with its label underneath."""
    if t["kind"] == "photo":
        inside, name = f'<div class="win"><img src="{photo(t)}" alt=""></div>', PROPS[t["slug"]]["name"]
    else:
        inside, name = f'<div class="win words">{on_band(t)}</div>', t["name"]
    eho = build.EHO if t["meta"] == "Equal Housing Opportunity" else ""
    return (f'<section class="post" style="left:{c * TW}px;top:{r * TH}px">{inside}'
            f'<div class="label"><p class="name">{build.esc(name)}</p><p class="meta">{eho}{build.esc(t["meta"])}</p></div></section>')


def backdrop():
    """The ink, and the paper band that runs across the three middle posts, behind the
    flagship's photo in the centre."""
    y = BAND_ROW * TH
    return (f'<svg class="backdrop" viewBox="0 0 {CW} {CH}" width="{CW}" height="{CH}">'
            f'<rect width="{CW}" height="{CH}" class="ink"/>'
            f'<rect y="{y + WIN_Y}" width="{CW}" height="{WIN_B - WIN_Y}" class="band"/></svg>')


def fonts():
    f = ROOT / "assets/fonts"
    return (f"@font-face{{font-family:'Instrument Serif';src:url('{(f / 'instrument-serif-latin.woff2').as_uri()}') format('woff2')}}"
            f"@font-face{{font-family:'Instrument Serif';font-style:italic;src:url('{(f / 'instrument-serif-italic-latin.woff2').as_uri()}') format('woff2')}}"
            f"@font-face{{font-family:Manrope;font-weight:200 800;src:url('{(f / 'manrope-latin.woff2').as_uri()}') format('woff2')}}")


CSS = """
:root{--ink:#151613;--ink2:#1e201c;--paper:#f4f1ea;--tan:#debb92;--on-ink:#eeeadf;--accent:#8a6232;--text:#1b1c19;--muted:#5c5d55}
*{box-sizing:border-box;margin:0}
body{background:var(--ink)}
.canvas{position:relative;width:%(CW)dpx;height:%(CH)dpx;overflow:hidden}
.backdrop{position:absolute;inset:0}
.ink{fill:var(--ink)} .band{fill:var(--paper)}
.post{position:absolute;width:%(TW)dpx;height:%(TH)dpx}
.win{position:absolute;left:%(WIN_X)dpx;top:%(WIN_Y)dpx;width:%(WIN_W)dpx;height:%(WIN_H)dpx;overflow:hidden;background:var(--ink2)}
.win img{display:block;width:100%%;height:100%%;object-fit:cover}
.label{position:absolute;left:%(WIN_X)dpx;right:%(WIN_X)dpx;top:%(LABEL)dpx}
.name{font:400 76px/1 'Instrument Serif';color:var(--on-ink)}
.meta{font:600 25px/1 Manrope;letter-spacing:.26em;text-transform:uppercase;color:var(--tan);margin-top:26px;display:flex;align-items:center;gap:14px;white-space:nowrap}
.meta svg{width:30px;height:30px;flex:none}
.words{background:none;padding:92px 0 76px;color:var(--text)}
.lab{font:700 24px/1 Manrope;letter-spacing:.28em;text-transform:uppercase;color:var(--accent)}
h2{font:400 148px/.94 'Instrument Serif';letter-spacing:-.01em;margin-top:44px;color:var(--ink)}
h2 em{font-style:italic;color:var(--accent)}
.body{font:500 34px/1.45 Manrope;color:var(--muted);margin-top:52px;max-width:680px}
.url{font:400 76px/1 'Instrument Serif';color:var(--ink);margin-top:40px}
.bio{font:700 22px/1 Manrope;letter-spacing:.28em;text-transform:uppercase;color:var(--accent);margin-top:22px}
""" % dict(CW=CW, CH=CH, TW=TW, TH=TH, WIN_X=WIN_X, WIN_Y=WIN_Y, WIN_W=WIN_W, WIN_H=WIN_B - WIN_Y, LABEL=WIN_B + 58)


def grid_page():
    posts = "".join(post(r, c, t) for (r, c), t in sorted(TILES.items()))
    return f'<!doctype html><meta charset="utf-8"><style>{fonts()}{CSS}</style><div class="canvas">{backdrop()}{posts}</div>'


def avatar_page(bg, colors, width=0.6):
    """The building mark, centred, sized to sit well inside Instagram's circle crop."""
    mark = build.standalone_logo("mark", colors).replace("<svg ", '<svg id="m" ', 1)
    return (f'<!doctype html><meta charset="utf-8"><style>*{{margin:0}}body{{width:1080px;height:1080px;background:{bg};position:relative}}'
            f'#m{{position:absolute;left:50%;top:50%}}</style>{mark}<script>'
            f"const m=document.getElementById('m'),b=m.getBBox(),w={width}*1080,h=b.height*w/b.width;"
            "m.setAttribute('viewBox',`${b.x} ${b.y} ${b.width} ${b.height}`);"
            "Object.assign(m.style,{width:w+'px',height:h+'px',marginLeft:-w/2+'px',marginTop:-h/2+'px'});</script>")


BIO = ["An evolution in home.",
       "Family-owned apartments with character in Rochester, Syracuse & Geneva, NY.",
       "Tours, availability & applications ↓"]


def preview_page(files):
    """The profile as a phone shows it, light and dark, to judge the grid before posting.
    A plain sketch of a profile page, not Instagram's own design."""
    cells = "".join(f'<img src="{(KIT / "posts" / files[(r, c)]).as_uri()}" alt="">' for r in range(3) for c in range(3))
    bio = "<br>".join(build.esc(x) for x in BIO)

    def phone(mode):
        return (f'<div class="phone {mode}"><p class="mode">{mode.title()} mode</p><div class="head">'
                f'<img class="av" src="{(KIT / "profile-picture.png").as_uri()}" alt="">'
                f'<div><p class="nm">{build.NAME}</p><p class="cat">Property management company</p>'
                '<p class="stats"><b>9</b> posts</p></div></div>'
                f'<p class="bio">{bio}</p><p class="link">evolution24.net</p>'
                '<div class="btns"><span class="b1">Follow</span><span>Message</span><span>Contact</span></div>'
                f'<div class="tabs"><i><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></i></div><div class="grid">{cells}</div></div>')

    css = ("*{box-sizing:border-box;margin:0}body{width:860px;height:916px;background:#dcd8cf;display:flex;gap:40px;padding:24px 20px;font-family:Manrope}"
           ".phone{width:390px;border-radius:28px;overflow:hidden;padding:6px 0 18px}.light{background:#fff;color:#000}.dark{background:#000;color:#f5f5f5}"
           ".mode{font:700 10px/1 Manrope;letter-spacing:.2em;text-transform:uppercase;text-align:center;padding:10px 0 14px;opacity:.5}"
           ".head{display:flex;gap:18px;align-items:center;padding:0 16px}.av{width:86px;height:86px;border-radius:50%}"
           ".nm{font:700 16px/1.3 Manrope}.cat{font:400 13px/1.4 Manrope;opacity:.6}.stats{font:400 13px/1.8 Manrope}"
           ".bio{font:400 13.5px/1.4 Manrope;padding:12px 16px 0}.link{font:600 13.5px/1.4 Manrope;padding:2px 16px 0;color:#00376b}"
           ".dark .link{color:#e0f1ff}.btns{display:flex;gap:6px;padding:14px 16px}.btns span{flex:1;text-align:center;font:600 13px/32px Manrope;border-radius:8px;background:#efefef}"
           ".dark .btns span{background:#262626}.btns .b1{background:#0095f6!important;color:#fff}"
           ".tabs{height:44px;display:flex;justify-content:center;border-bottom:1px solid rgba(128,128,128,.2)}"
           ".tabs i{width:130px;border-bottom:1px solid currentColor;display:grid;grid-template-columns:repeat(3,5px);gap:2px;place-content:center}"
           ".tabs b{width:5px;height:5px;background:currentColor;border-radius:1px}"
           ".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5px}.grid img{width:100%;aspect-ratio:3/4;display:block}")
    return f'<!doctype html><meta charset="utf-8"><style>{fonts()}{css}</style>{phone("light")}{phone("dark")}'


# ---------------------------------------------------------------- run
def render(jobs):
    listing = WORK / "jobs.json"
    listing.write_text(json.dumps([dict(j, html=str(j["html"]), png=str(j["png"])) for j in jobs]))
    subprocess.run(["node", str(HERE / "render.cjs"), str(listing)], check=True)


def save_jpeg(im, path, quality=95):
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    im.convert("RGB").save(path, quality=quality, subsampling=0, optimize=True, icc_profile=srgb)


def main():
    for old in (WORK, KIT):                   # only what this script writes, never the folder it was given
        shutil.rmtree(old, ignore_errors=True)
    WORK.mkdir(parents=True)
    (KIT / "posts").mkdir(parents=True)

    pages = {"grid": grid_page(), "avatar": avatar_page("#151613", ON_INK), "avatar-paper": avatar_page("#f4f1ea", ON_LIGHT)}
    for name, html in pages.items():
        (WORK / f"{name}.html").write_text(html)
    render([dict(html=WORK / "grid.html", png=WORK / "grid.png", width=CW, height=CH),
            dict(html=WORK / "avatar.html", png=KIT / "profile-picture.png", width=1080, height=1080),
            dict(html=WORK / "avatar-paper.html", png=KIT / "profile-picture-paper.png", width=1080, height=1080)])

    whole = Image.open(WORK / "grid.png").convert("RGB")
    files = {}
    for (r, c), t in TILES.items():
        key = t.get("key") or t["slug"]
        spot = "center" if (r, c) == (1, 1) else f"{PLACE[r]}-{SIDE[c]}"
        files[(r, c)] = f"{t['order']:02d}-{spot}-{key}.jpg"
        save_jpeg(whole.crop((c * TW, r * TH, (c + 1) * TW, (r + 1) * TH)), KIT / "posts" / files[(r, c)])
    save_jpeg(whole, KIT / "grid.jpg", quality=90)

    (WORK / "preview.html").write_text(preview_page(files))       # phone-sized, drawn at 3x like a phone
    render([dict(html=WORK / "preview.html", png=KIT / "profile-preview.png", width=860, height=916, scale=3)])

    shutil.copy(HERE / "captions.md", KIT / "captions.md")
    zpath = OUT / "evolution24-instagram-kit.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(KIT.rglob("*")):
            if f.is_file():
                z.write(f, Path("evolution24-instagram") / f.relative_to(KIT))
    for f in sorted(KIT.rglob("*")):
        if f.is_file():
            print(f"{f.relative_to(OUT)}  {f.stat().st_size // 1024} KB")
    print(zpath.relative_to(OUT), f"{zpath.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
