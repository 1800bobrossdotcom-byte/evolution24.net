#!/usr/bin/env python3
"""Facebook and Instagram ads for every building with homes to rent: for each one a picture and
a 15-second video, in the feed's shape and the Stories' and Reels' shape, and the words to post
with them.

    python3 tools/ads/ads.py [out-dir] [--only water-street,biltmore] [--no-video]

Default out-dir: tools/ads/out. Writes, for each building:
  <slug>/feed.jpg        1080 x 1350 (4:5), Facebook and Instagram feeds
  <slug>/story.jpg       1080 x 1920 (9:16), Stories
  <slug>/feed.mp4        1080 x 1350, 15 s, the feeds
  <slug>/story.mp4       1080 x 1920, 15 s, Stories and Reels
and ads.md (each ad's primary text, headline, description, button, link and alt text, and how to
set the campaign up), ads.csv (the same, one row per ad), overview.jpg (every feed ad on one
sheet) and a zip of the lot.

Who to call: tools/ads/contacts.json, which is kept out of git, like the pay logs' people
(copy contacts.example.json and fill it in). Charlotte Square's ads name its leasing agent; the
rest name the Evolution24 agent under "default".

What is open, its rent and when it was listed come from data/properties.json, the same list the
website's "Available now" shows; a building with nothing open is left out. Run it again after
that list changes (the Rent Manager job keeps it current) so no ad offers a leased home or an
old rent. Every ad carries the Equal Housing Opportunity mark, and says when its rents were
listed. Nothing in them says or implies who a home is for: that is the fair housing rule
Facebook's Housing category enforces, and ours.

How a video is made: each building's three photos, graded like the Instagram kit, move slowly
in the picture panel and dissolve into one another; the words are the same layout as the
picture, drawn once by the browser in the site's fonts and laid over the frames; the last
four seconds are an end card. Frames are put together here and encoded by ffmpeg, under 15
seconds of "Day Trips" by HoliznaCC0 (CC0 1.0, the Instagram kit's track), from its downbeat.

Needs Pillow, numpy, Playwright and ffmpeg (on PATH, or `pip install imageio-ffmpeg`).
"""
import csv
import datetime as dt
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def options(argv):
    out, only, video = HERE / "out", None, True
    args = iter(argv)
    for a in args:
        if a == "--only" or a.startswith("--only="):
            only = (a.split("=", 1)[1] if "=" in a else next(args, "")).split(",")
        elif a == "--no-video":
            video = False
        elif a.startswith("--"):
            sys.exit(f"Unknown option {a}. Usage: ads.py [out-dir] [--only slug,slug] [--no-video]")
        else:
            out = Path(a).resolve()
    return out, only, video


OUT, ONLY, VIDEO = options(sys.argv[1:])
WORK = OUT / "work"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    saved = sys.argv[:]
    sys.argv[1:] = []                    # the Instagram kit reads its own out-dir from argv
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv[:] = saved
    return module


build = load("build", ROOT / "scripts/build.py")       # the site's data, logo, names and money
kit = load("kit", ROOT / "tools/instagram/make.py")     # fonts, photo grading, JPEG output
PROPS = {p["slug"]: p for p in build.PROPS}

FPS = 30
SECONDS = 15
MUSIC = dict(cache=ROOT / "tools/instagram/out/cache/day-trips.mp3",
             url="https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/8mlLtuhQCO7ohFxygnQb39fJBNNxM2iTjr6Bdrff.mp3",
             sha1="c92ff1e145ccf1e2fd28ac1a237c703093a08279", start=10.642)   # the groove comes in at bar 3

# The two shapes. panel is where the photos sit, as (left, top, right, bottom); Stories keep their
# top and bottom 250 px clear of the app's own bars, so the logo sits below the top one and the
# words above the bottom one.
FORMATS = {
    "feed": dict(W=1080, H=1350, panel=(0, 0, 1080, 850)),
    "story": dict(W=1080, H=1920, panel=(0, 400, 1080, 1200)),
}

# Each building: three photos (file, where to keep when cropped) and two lines about it, taken
# from its description and amenities on the website. pitch is the ad's opening sentence.
ADS = {
    "charlotte-square": dict(
        photos=[("07-terrace.jpg", (0.5, 0.45)), ("01-exterior-facade.jpg", (0.55, 0.5)), ("03-living-room.jpg", (0.5, 0.5))],
        facts="1, 2 and 3 bedrooms · Garage parking included",
        lines=["Luxury apartments in the East End", "LEED Gold certified · Terrace with fire pit"],
        pitch="luxury one-, two- and three-bedroom apartments a block from Main Street and East Avenue, with a space in the secure garage included",
        stamp=("1–3", "bed")),
    "301-central-avenue": dict(
        photos=[("02-living-room.jpg", (0.5, 0.55)), ("08-bedroom-brick.jpg", (0.5, 0.5)), ("05-kitchen-galley.jpg", (0.5, 0.5))],
        lines=["Fully renovated, downtown", "In-unit washer and dryer · Central air"],
        pitch="fully renovated apartments in the heart of downtown Rochester, furnished or unfurnished, with a washer and dryer in the unit"),
    "145-south-fitzhugh-street": dict(
        photos=[("15-studio-bedroom.jpg", (0.5, 0.5)), ("09-kitchen-red-fridge.jpg", (0.6, 0.5)), ("02-living-room.jpg", (0.5, 0.55))],
        lines=["A quiet street just outside downtown", "Off-street parking · On-site laundry"],
        pitch="modern studios and 1-bedrooms on a quiet street just outside downtown Rochester, close to shopping, dining and hospitals"),
    "water-street": dict(
        photos=[("03-loft-mezzanine.jpg", (0.5, 0.5)), ("02-loft-studio.jpg", (0.5, 0.5)), ("07-lobby.jpg", (0.5, 0.5))],
        lines=["Loft apartments with high ceilings", "On-site gym · Elevator · Laundry"],
        pitch="fully updated loft apartments close to downtown Rochester, with high ceilings and a gym on site"),
    "biltmore": dict(
        photos=[("01-lobby.png", (0.5, 0.5)), ("04-studio-living.jpg", (0.5, 0.5)), ("02-exterior.jpg", (0.5, 0.45))],
        lines=["A restored mosaic lobby", "WiFi and appliances included · Pets welcome"],
        pitch="furnished studios in a classic yellow-brick building on Alexander Street, with a restored mosaic lobby, WiFi included and pets welcome"),
    "181-st-paul-street": dict(
        photos=[("01-exterior.jpg", (0.5, 0.4)), ("04-kitchen.jpg", (0.5, 0.5)), ("03-studio-brick.jpg", (0.5, 0.5))],
        lines=["Tall windows · Exposed brick", "A short walk from the river"],
        pitch="loft studios in a seven-storey brick building on St. Paul Street, downtown, with tall windows and painted brick"),
    "121-park-drive": dict(
        photos=[("01-exterior.jpg", (0.5, 0.42)), ("01-exterior.jpg", (0.55, 0.62)), ("01-exterior.jpg", (0.35, 0.5))],
        lines=["A restored Victorian in Manlius", "Covered porch · Large backyard"],
        pitch="apartments in a beautifully restored Victorian on a quiet street in Manlius, with a covered porch and a large backyard"),
    "379-south-main-street": dict(
        photos=[("09-bedroom-green.jpg", (0.5, 0.45)), ("02-living-room.jpg", (0.5, 0.5)), ("07-bedroom-fireplace.jpg", (0.5, 0.5))],
        lines=["Original fireplaces · Chandeliers", "Washer and dryer · Central air"],
        pitch="a generous home on South Main Street in Geneva, a few blocks above Seneca Lake, with original fireplaces and a washer and dryer"),
    "561-south-main-street": dict(
        photos=[("04-bedroom.jpg", (0.5, 0.45)), ("05-kitchen.jpg", (0.5, 0.5)), ("03-bedroom-tin-ceiling.jpg", (0.6, 0.5))],
        lines=["Original pressed-tin ceilings", "Gas range · New baths"],
        pitch="apartments in a white Italianate house on South Main Street in Geneva, renovated under their original pressed-tin ceilings"),
}


# ---------------------------------------------------------------- facts
def contacts():
    path = HERE / "contacts.json"
    if not path.exists():
        sys.exit(f"Copy {HERE / 'contacts.example.json'} to {path} and fill in who to call. It stays out of git.")
    data = json.loads(path.read_text())
    if "default" not in data:
        sys.exit(f'{path} needs a "default" contact.')
    return data


def kinds(units):
    beds = sorted({u["beds"] for u in units})
    return " & ".join("Studio" if b == 0 else f"{b}-bed" for b in beds)


def listed(day):
    d = dt.date.fromisoformat(day)
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def facts_for(slug, spec):
    """What the ad says is open: the kinds of home, the lowest rent, how many, and when listed."""
    p = PROPS[slug]
    if p.get("external"):
        return dict(facts=spec["facts"], stamp=spec["stamp"], rent=None, count=None, kinds=None)
    units = p["units"]
    low = min(u["rent"] for u in units)
    rent = f"{build.money(low)} a month" if len(units) == 1 else f"from {build.money(low)} a month"
    return dict(facts=f"{kinds(units)} · {rent}", stamp=(str(len(units)), "home" if len(units) == 1 else "homes"),
                rent=low, count=len(units), kinds=kinds(units))


def link_for(slug):
    """Where the ad's button goes, tagged so the dashboard counts each building's ad as its own campaign."""
    p = PROPS[slug]
    if p.get("external"):
        return f"{p['external'].rstrip('/')}/?utm_source=facebook&utm_medium=paid_social&utm_campaign=now-renting"
    return f"{build.SITE}{build.prop_url(p)}?utm_source=facebook&utm_medium=paid_social&utm_campaign=now-renting-{slug}"


# ---------------------------------------------------------------- the pages
ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>'


def stamp(big, small):
    ring = " · ".join(["Now renting"] * 3) + " · "
    return ('<svg class="stamp" viewBox="0 0 300 300" aria-hidden="true">'
            '<defs><path id="ring" d="M150 150m-112 0a112 112 0 1 1 224 0a112 112 0 1 1-224 0"/></defs>'
            '<circle cx="150" cy="150" r="148" class="disc"/><circle cx="150" cy="150" r="84" class="rule"/>'
            f'<text class="ringt"><textPath href="#ring" textLength="700" lengthAdjust="spacing">{ring}</textPath></text>'
            f'<text x="150" y="{168 if len(big) <= 2 else 162}" class="count{" long" if len(big) > 2 else ""}">{build.esc(big)}</text>'
            f'<text x="150" y="200" class="unit">{build.esc(small)}</text></svg>')


def ad_html(fmt, slug, info, who, photo=None, layer=None, line=None):
    """One ad. layer: None (the whole picture), "frame" (everything but the photo and the changing
    line, for video), "line" (only the changing line, set to `line`), or "end" (the end card)."""
    F = FORMATS[fmt]
    p = PROPS[slug]
    x0, y0, x1, y1 = F["panel"]
    lockup = build.standalone_lockup().replace("<svg ", '<svg class="lockup" ', 1)
    photo_html = f'<img class="photo" src="{photo}" alt="">' if photo else ""
    city = "Rochester’s East End" if slug == "charlotte-square" else p["city"]
    as_of = "" if p.get("external") else f" · Rents as listed {listed(build.UNITS_AS_OF)}"
    end = f'''<div class="endcard">{build.standalone_logo("mark", kit.ON_LIGHT).replace("<svg ", '<svg class="endmark" ', 1)}
      <p class="end-lab">Tours by appointment</p>
      <p class="end-big">Let’s find<br>your <em>place.</em></p>
      <p class="end-url">{build.esc(link_for(slug).split("?")[0].replace("https://", "").replace("www.", "").rstrip("/"))}</p></div>'''
    body = f'''<div class="ad {fmt}{f" layer-{layer}" if layer else ""}">
  <div class="panel">{photo_html}<div class="shade"></div></div>
  <div class="inkband top"></div><div class="inkband bottom"></div>
  {lockup}
  {stamp(*info["stamp"])}
  <div class="words">
    <p class="kicker">Now renting · {build.esc(city)}</p>
    <h1 class="name">{build.esc(p["name"])}</h1>
    <p class="facts">{build.esc(line if line is not None else info["facts"])}</p>
    <div class="contact">
      <div><p class="lab">Call {build.esc(who["short"])}</p><p class="phone">{build.esc(who["phone"])}</p></div>
      <div class="right"><p class="email">{build.esc(who["email"])}</p><p class="cta">Book a tour {ARROW}</p></div>
    </div>
    <p class="small">{build.EHO}Equal Housing Opportunity{build.esc(as_of)}</p>
  </div>
  {end if layer == "end" else ""}
</div>'''
    css = CSS % dict(W=F["W"], H=F["H"], PX=x0, PY=y0, PW=x1 - x0, PH=y1 - y0, PB=y1)
    return f'<!doctype html><meta charset="utf-8"><style>{kit.fonts()}{css}</style>{body}<script>{FIT}</script>'


# A long name steps down until it fits on its line, once the fonts are in (render.cjs waits for them).
FIT = """document.fonts.ready.then(() => { const n = document.querySelector('.name');
  let s = parseFloat(getComputedStyle(n).fontSize);
  while (n.scrollWidth > n.clientWidth && s > 48) { s -= 2; n.style.fontSize = s + 'px'; } });"""


CSS = """
:root{--ink:#151613;--paper:#f4f1ea;--tan:#debb92;--cream:#eeeadf;--accent:#8a6232;--muted:#5c5d55}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:transparent}
.ad{position:relative;width:%(W)dpx;height:%(H)dpx;overflow:hidden;color:var(--cream);font-family:Manrope}
.panel{position:absolute;left:%(PX)dpx;top:%(PY)dpx;width:%(PW)dpx;height:%(PH)dpx;overflow:hidden}
.photo{width:100%%;height:100%%;display:block;object-fit:cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(21,22,19,.55),rgba(21,22,19,0) 230px),
  linear-gradient(0deg,rgba(21,22,19,.45),rgba(21,22,19,0) 160px)}
.story .shade{background:linear-gradient(0deg,rgba(21,22,19,.45),rgba(21,22,19,0) 160px)}
.inkband{position:absolute;left:0;right:0;background:var(--ink)}
.inkband.top{top:0;height:%(PY)dpx}
.inkband.bottom{top:%(PB)dpx;bottom:0}
.lockup{position:absolute;left:56px;top:48px;width:330px}
.story .lockup{left:64px;top:282px;width:380px}
.stamp{position:absolute;right:52px;top:44px;width:230px;height:230px;transform:rotate(-10deg)}
.story .stamp{right:56px;top:320px;width:250px;height:250px}
.stamp .disc{fill:var(--tan)} .stamp .rule{fill:none;stroke:var(--ink);stroke-width:2;opacity:.35}
.stamp .ringt{font:800 25px Manrope;letter-spacing:.2em;text-transform:uppercase;fill:var(--ink)}
.stamp .count{font:400 112px 'Instrument Serif';text-anchor:middle;fill:var(--ink)}
.stamp .count.long{font-size:86px}
.stamp .unit{font:800 18px Manrope;letter-spacing:.28em;text-transform:uppercase;text-anchor:middle;fill:var(--ink)}
.words{position:absolute;left:60px;right:60px;bottom:58px}
.story .words{bottom:272px}
.kicker{font:800 22px/1 Manrope;letter-spacing:.28em;text-transform:uppercase;color:var(--tan)}
.name{margin-top:16px;font:400 92px/1 'Instrument Serif';letter-spacing:-.01em;white-space:nowrap}
.facts{margin-top:16px;font:500 31px/1.25 Manrope;color:rgba(238,234,223,.9);min-height:39px}
.contact{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:30px;padding-top:24px;border-top:2px solid rgba(238,234,223,.22)}
.lab{font:800 20px/1 Manrope;letter-spacing:.26em;text-transform:uppercase;color:var(--tan)}
.phone{margin-top:10px;font:400 58px/1 'Instrument Serif';white-space:nowrap}
.right{text-align:right}
.email{font:600 26px/1.2 Manrope;color:var(--cream);white-space:nowrap}
.cta{margin-top:12px;display:inline-flex;align-items:center;gap:10px;font:800 19px/1 Manrope;letter-spacing:.24em;text-transform:uppercase;color:var(--tan)}
.cta svg{width:24px;height:24px}
.small{margin-top:26px;display:flex;align-items:center;gap:10px;font:600 17px/1 Manrope;letter-spacing:.06em;color:rgba(238,234,223,.6)}
.small svg{width:22px;height:22px;flex:none}
.story .name{font-size:104px}
.story .facts{font-size:33px}
/* video layers: one part of the picture each, the rest left see-through */
.layer-frame .panel,.layer-frame .facts{visibility:hidden}
.layer-frame .panel .shade{visibility:visible}
.layer-line *{visibility:hidden}
.layer-line .facts{visibility:visible}
.layer-end > *:not(.endcard){visibility:hidden}
.endcard{position:absolute;left:%(PX)dpx;top:%(PY)dpx;width:%(PW)dpx;height:%(PH)dpx;background:var(--paper);color:var(--ink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.endmark{width:150px;height:auto}
.end-lab{margin-top:34px;font:800 21px/1 Manrope;letter-spacing:.28em;text-transform:uppercase;color:var(--accent)}
.end-big{margin-top:22px;font:400 104px/.98 'Instrument Serif';letter-spacing:-.01em}
.end-big em{font-style:italic;color:var(--accent)}
.end-url{margin-top:30px;font:700 24px/1 Manrope;letter-spacing:.08em;color:var(--muted)}
"""


# ---------------------------------------------------------------- photos and video
def prep_photo(slug, file, focus, size, name):
    im = ImageOps.exif_transpose(Image.open(ROOT / "source/photos" / slug / file)).convert("RGB")
    im = kit.grade(ImageOps.fit(im, (round(size[0]), round(size[1])), Image.LANCZOS, centering=focus))
    im.save(WORK / name, quality=94, subsampling=0)
    return im


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def music():
    path = MUSIC["cache"]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(MUSIC["url"], headers={"User-Agent": "Mozilla/5.0"})
        path.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    if hashlib.sha1(path.read_bytes()).hexdigest() != MUSIC["sha1"]:
        sys.exit(f"{path} is not the expected recording; delete it and run again")
    return path


def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def fade_in_out(t, a, b, f=0.35):
    """1 between a and b, easing in over f seconds after a and out over f before b."""
    if t < a or t > b:
        return 0.0
    return min(ease((t - a) / f), ease((b - t) / f))


def with_alpha(layer, k):
    if k >= 0.999:
        return layer
    out = layer.copy()
    out.putalpha(layer.getchannel("A").point(lambda v: int(v * k)))
    return out


def video(fmt, slug, shots, layers, dest):
    """15 seconds: three photos moving and dissolving in the panel, the line under the name
    changing with each, then the end card. Frames are piped to ffmpeg as raw RGB."""
    F = FORMATS[fmt]
    W, H = F["W"], F["H"]
    x0, y0, x1, y1 = F["panel"]
    pw, ph = x1 - x0, y1 - y0
    # Each shot: on screen from start to end; zoom in or out by 7%, drifting a little.
    plan = [(0.0, 4.4, 1.0, 1.07, (-0.02, -0.01)), (4.0, 8.4, 1.07, 1.0, (0.02, 0.0)), (8.0, 12.0, 1.0, 1.07, (0.0, 0.02))]
    xfade = 0.4
    end_at = 11.6
    lines = [(0.0, 4.2, 0), (4.3, 8.2, 1), (8.3, 11.9, 2), (12.0, SECONDS + 1, 0)]
    frame_layer = layers["frame"]
    line_layers = [(lay, lay.getbbox()) for lay in layers["lines"]]
    end_layer = layers["end"]
    base = Image.new("RGBA", (W, H), (21, 22, 19, 255))

    def shot_frame(i, t):
        start, stop, z0, z1, (dx, dy) = plan[i]
        k = ease((t - start) / (stop - start))
        z = z0 + (z1 - z0) * k
        src = shots[i]
        sw, sh = src.size
        cw, ch = sw / (1.12 * z), sh / (1.12 * z)        # the source is 12% larger than the panel
        cx = sw / 2 + dx * sw * k
        cy = sh / 2 + dy * sh * k
        left = min(max(cx - cw / 2, 0), sw - cw)
        top = min(max(cy - ch / 2, 0), sh - ch)
        return src.resize((pw, ph), Image.BICUBIC, box=(left, top, left + cw, top + ch))

    cmd = [ffmpeg(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-ss", str(MUSIC["start"]), "-t", str(SECONDS), "-i", str(music()),
           "-filter_complex", f"[1:a]afade=t=in:d=0.25,afade=t=out:st={SECONDS - 1.6}:d=1.6[a]",
           "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", str(dest)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for n in range(SECONDS * FPS):
        t = n / FPS
        canvas = base.copy()
        live = [i for i, (a, b, *_) in enumerate(plan) if a <= t <= b]
        panel = None
        for i in live:
            img = shot_frame(i, t)
            a = plan[i][0]
            k = 1.0 if i == 0 or t >= a + xfade else ease((t - a) / xfade)
            panel = img if panel is None or k >= 1 else Image.blend(panel, img, k)
        if panel is None:
            panel = shot_frame(len(plan) - 1, plan[-1][1])
        canvas.paste(panel, (x0, y0))
        canvas.alpha_composite(frame_layer)
        for a, b, which in lines:
            k = fade_in_out(t, a, b) if a > 0 else (1.0 if t <= b - 0.35 else fade_in_out(t, -1, b))
            if k > 0:
                lay, box = line_layers[which]
                if box:
                    canvas.alpha_composite(with_alpha(lay.crop(box), k), dest=box[:2])
        k = ease((t - end_at) / 0.5)
        if k > 0:
            canvas.alpha_composite(with_alpha(end_layer.crop((x0, y0, x1, y1)), k), dest=(x0, y0))
        if t < 0.3:                                              # in from ink
            canvas = Image.blend(base, canvas, ease(t / 0.3))
        proc.stdin.write(canvas.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"ffmpeg failed on {dest}")


def render(jobs):
    listing = WORK / "jobs.json"
    listing.write_text(json.dumps([dict(j, html=str(j["html"]), png=str(j["png"])) for j in jobs]))
    subprocess.run(["node", str(ROOT / "tools/instagram/render.cjs"), str(listing)], check=True)


# ---------------------------------------------------------------- words to post with them
def copy_for(slug, info, who):
    p = PROPS[slug]
    spec = ADS[slug]
    city = "Rochester" if slug == "charlotte-square" else p["city"]
    if p.get("external"):
        offer = f"See the floor plans and rents at {link_for(slug).split('?')[0].replace('https://www.', '').rstrip('/')}."
        desc = "1–3 bedrooms · parking included"
    else:
        units = p["units"]
        if len(units) == 1:
            b = units[0]["beds"]
            offer = f"One home open now: {'a studio' if b == 0 else f'a {b}-bedroom'} at {build.money(units[0]['rent'])} a month."
        else:
            beds = sorted({u["beds"] for u in units})
            what = " and ".join("studios" if b == 0 else f"{b}-bedrooms" for b in beds)
            offer = f"{len(units)} homes open now: {what} from {build.money(info['rent'])} a month."
        desc = f"{'From ' if len(units) > 1 else ''}{build.money(info['rent'])}/mo · {info['kinds']}"
    primary = (f"Now renting at {p['name']}, {city}: {spec['pitch']}. {offer} "
               f"Call {who['short']} at {who['phone']} or email {who['email']} to book a tour.")
    alt = (f"Ad for {p['name']} in {city}: a photo from the building with a Now renting stamp, "
           f"{info['facts'].replace(' · ', ', ')}, and Call {who['short']} {who['phone']}.")
    return dict(slug=slug, building=p["name"], headline=f"Now renting: {p['name']}", primary=primary, description=desc,
                button="Learn more", link=link_for(slug), contact=f"{who['name']}, {who['phone']}, {who['email']}", alt=alt)


GUIDE = """# Facebook and Instagram ads: Now renting

One ad per building with homes open, each as a picture and a 15-second video, in two shapes:
`feed` (4:5, 1080 × 1350) for the Facebook and Instagram feeds, and `story` (9:16, 1080 × 1920)
for Stories and Reels. Charlotte Square's ads name {cs}; the rest name {default}.

**Rents and what is open** are the website's list as of **{as_of}**. Make these again after the
list changes (`python3 tools/ads/ads.py`), and pause the ad of any building that fills up.

## Setting up the campaign (Meta Ads Manager)

1. **Create → Leads or Traffic.** On the first screen, under *Special Ad Categories*, choose
   **Housing**. Every rental ad must be in it, or Meta rejects it.
2. **Audience.** Housing ads cannot target by age, gender or ZIP code, and a location must be a
   radius of at least 15 miles: e.g. Rochester + 15 mi for the Rochester buildings, Syracuse +
   15 mi for 121 Park Drive, Geneva + 25 mi for the Geneva ones. Leave detailed targeting broad.
3. **Placements.** Advantage+ placements, then in each ad set the `feed` files for Feeds and the
   `story` files for Stories and Reels (Ads Manager asks for both when you pick "Customize").
4. **One ad set per building**, so each one's spend and results stay apart. Each ad: its picture
   and its video (Ads Manager can rotate them), the primary text, headline, description and
   button below, and its link. The links carry their own campaign tag, so the website's dashboard
   (`/admin/` → Campaigns) shows the visits and enquiries each building's ad brings.
5. **Fair housing.** The words below say what the homes are, never who they are for; keep any
   edits that way. Every picture and video carries the Equal Housing Opportunity mark.

The music is "Day Trips" by HoliznaCC0, dedicated to the public domain (CC0 1.0): free to use in
ads, no credit required.

"""


def main():
    who_all = contacts()
    slugs = [s for s in ADS if PROPS[s].get("external") or PROPS[s]["units"]]
    skipped = [p["name"] for p in build.PROPS if p["slug"] not in slugs and not p.get("external")]
    if ONLY:
        unknown = set(ONLY) - set(ADS)
        if unknown:
            sys.exit(f"No ad for {', '.join(sorted(unknown))}. Buildings: {', '.join(ADS)}")
        slugs = [s for s in slugs if s in ONLY]
    WORK.mkdir(parents=True, exist_ok=True)
    rows = []
    feeds = []
    for slug in slugs:
        spec = ADS[slug]
        info = facts_for(slug, spec)
        who = who_all.get(slug, who_all["default"])
        out = OUT / slug
        out.mkdir(parents=True, exist_ok=True)
        jobs = []
        shots = {}
        for fmt, F in FORMATS.items():
            x0, y0, x1, y1 = F["panel"]
            size = (x1 - x0, y1 - y0)
            hero = f"{slug}-{fmt}-hero.jpg"
            prep_photo(slug, *spec["photos"][0], size, hero)
            shots[fmt] = [prep_photo(slug, f, focus, (size[0] * 1.12, size[1] * 1.12), f"{slug}-{fmt}-shot{i}.jpg")
                          for i, (f, focus) in enumerate(spec["photos"])]
            pages = {"still": ad_html(fmt, slug, info, who, photo=hero), "frame": ad_html(fmt, slug, info, who, layer="frame"),
                     "end": ad_html(fmt, slug, info, who, layer="end")}
            for k, text in enumerate([info["facts"], *spec["lines"]]):
                pages[f"line{k}"] = ad_html(fmt, slug, info, who, layer="line", line=text)
            for name, html in pages.items():
                path = WORK / f"{slug}-{fmt}-{name}.html"
                path.write_text(html)
                jobs.append(dict(html=path, png=WORK / f"{slug}-{fmt}-{name}.png", width=F["W"], height=F["H"], transparent=name != "still"))
        render(jobs)
        for fmt in FORMATS:
            still = Image.open(WORK / f"{slug}-{fmt}-still.png").convert("RGB")
            kit.save_jpeg(still, out / f"{fmt}.jpg", quality=92)
            if fmt == "feed":
                feeds.append((slug, still))
            if VIDEO:
                layers = {"frame": Image.open(WORK / f"{slug}-{fmt}-frame.png").convert("RGBA"),
                          "end": Image.open(WORK / f"{slug}-{fmt}-end.png").convert("RGBA"),
                          "lines": [Image.open(WORK / f"{slug}-{fmt}-line{k}.png").convert("RGBA") for k in range(3)]}
                video(fmt, slug, shots[fmt], layers, out / f"{fmt}.mp4")
        rows.append(copy_for(slug, info, who))
        print(f"{PROPS[slug]['name']}: {', '.join(sorted(f.name for f in out.iterdir()))}")

    # The words, for Ads Manager.
    cs = who_all.get("charlotte-square", who_all["default"])
    md = [GUIDE.format(cs=f"{cs['name']} ({cs['phone']}, {cs['email']})", default=f"{who_all['default']['name']} ({who_all['default']['phone']}, {who_all['default']['email']})",
                       as_of=listed(build.UNITS_AS_OF))]
    if skipped:
        md.append(f"Not included, with nothing open today: {', '.join(skipped)}.\n\n")
    for r in rows:
        md.append(f"""---

## {r['building']}

Files: `{r['slug']}/feed.jpg`, `{r['slug']}/story.jpg`, `{r['slug']}/feed.mp4`, `{r['slug']}/story.mp4`

**Primary text:** {r['primary']}

**Headline:** {r['headline']}

**Description:** {r['description']}

**Button:** {r['button']}

**Link:** {r['link']}

**Alt text:** {r['alt']}

""")
    (OUT / "ads.md").write_text("".join(md))
    with open(OUT / "ads.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    # Every feed ad on one sheet, to look over.
    if feeds:
        cols = 3
        tw, th = 360, 450
        sheet = Image.new("RGB", (cols * tw + (cols + 1) * 16, ((len(feeds) + cols - 1) // cols) * (th + 16) + 16), "#e7e2d6")
        for i, (_, im) in enumerate(feeds):
            sheet.paste(im.resize((tw, th), Image.LANCZOS), (16 + (i % cols) * (tw + 16), 16 + (i // cols) * (th + 16)))
        kit.save_jpeg(sheet, OUT / "overview.jpg", quality=90)

    zpath = OUT / "evolution24-facebook-ads.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(OUT.rglob("*")):
            if f.is_file() and WORK not in f.parents and f != zpath:
                z.write(f, Path("evolution24-facebook-ads") / f.relative_to(OUT))
    print(f"{zpath} {zpath.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
