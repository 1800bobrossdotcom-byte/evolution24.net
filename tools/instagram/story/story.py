#!/usr/bin/env python3
"""Branded video, cut to the beat of a CC0 track, ending on the logo slam.

    python3 tools/instagram/story/story.py [out-dir] [--format story|landscape] [--page-only] [--audio-only]

Makes two cuts of the same 20 seconds, on the same beat grid and soundtrack:
  evolution24-story.mp4       1080 x 1920, for Instagram and Facebook Stories
  evolution24-landscape.mp4   1920 x 1080, for the Facebook feed, a page's cover video, YouTube
Default out-dir: tools/instagram/out/story. Needs Pillow, numpy, scipy, Playwright and ffmpeg
(on PATH, or `pip install imageio-ffmpeg`).

How it is made:
- The music is "Day Trips" by HoliznaCC0 (album City Slacker), dedicated to the public
  domain under CC0 1.0 (https://freemusicarchive.org/music/holiznacc0/city-slacker/day-trips/).
  It is 90 BPM. The video starts two bars before the groove comes in, so the title
  plays over the build and the first photo lands on the drop.
- Every cut, word and transition sits on the beat grid. story.js draws any moment of
  the timeline on its own, so frames are rendered one by one at 60 fps and blended in
  pairs to 30 fps, which gives fast moves a little motion blur.
- The jingle (a riser, the impact as the logo lands and a four-note chime in the track's
  key, G major) is synthesised in audio.py, so it is ours to use freely.
- Tall frames take the photos full screen. Wide frames put tall photos beside their
  words, and use wide photos full screen.
"""
import hashlib
import json
import random
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
ARGS = [a for a in sys.argv[1:] if not a.startswith("--") and a not in ("story", "landscape")]
OUT = Path(ARGS[0]).resolve() if ARGS else HERE.parent / "out" / "story"
sys.argv[1:] = [a for a in sys.argv[1:] if a.startswith("--") or a in ("story", "landscape")]   # make.py reads argv too
sys.path.insert(0, str(HERE.parent))
import make as kit                                   # noqa: E402  the grid's grade, fonts and the site's logo
import audio                                         # noqa: E402

build = kit.build
FPS = 60
MUSIC = dict(
    url="https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/"
        "8mlLtuhQCO7ohFxygnQb39fJBNNxM2iTjr6Bdrff.mp3",
    page="https://freemusicarchive.org/music/holiznacc0/city-slacker/day-trips/",
    sha1="c92ff1e145ccf1e2fd28ac1a237c703093a08279",
    bpm=90.048, bar2=7.977, bar3=10.642,             # measured: the build starts at bar 2, the groove at bar 3
)
FULL = "full"


def box(x, y, w, h):
    return dict(x=x, y=y, w=w, h=h)


# Each format: the frame, the title, the six montage shots, the flagship, the page and the logo.
# A shot's "panel" is where its photo sits; "full" fills the frame. "bg" colours the rest.
# "label" places its name: top-left corner and which background it sits on.
FORMATS = {
    "story": dict(
        W=1080, H=1920, strips=5, titleX=90, lab=600, line1=860, line2=1060, rule=1150, cities=1222,
        shots=[
            dict(slug="biltmore", file="01-lobby.png", focus=(0.5, 0.5), trans="dot", kb=[1.0, 1.08, 0, -20],
                 meta="Furnished studios · Rochester", panel=FULL, label=(90, 1330)),
            dict(slug="water-street", file="03-loft-mezzanine.jpg", focus=(0.5, 0.5), trans="strips", kb=[1.1, 1.02, 30, 0],
                 meta="Lofts · Downtown Rochester", panel=FULL, label=(90, 1330)),
            dict(slug="121-park-drive", file="01-exterior.jpg", focus=(0.45, 0.5), trans="whip", kb=[1.02, 1.1, -30, 0],
                 meta="A restored Victorian · Manlius", panel=FULL, label=(90, 1330)),
            dict(slug="379-south-main-street", file="02-living-room.jpg", focus=(0.5, 0.5), trans="frame", kb=[1, 1, 0, 0],
                 meta="Original fireplaces · Geneva", panel=box(110, 200, 860, 1147), bg="paper", label=(90, 1399)),
            dict(slug="301-central-avenue", file="03-living-room-sofa.jpg", focus=(0.5, 0.6), trans="diag", kb=[1.12, 1.03, 0, 30],
                 meta="Fully renovated · Downtown Rochester", panel=FULL, label=(90, 1330)),
            dict(slug="561-south-main-street", file="04-bedroom.jpg", focus=(0.5, 0.45), trans="punch", kb=[1.0, 1.05, 0, -10],
                 meta="Pressed-tin ceilings · Geneva", panel=FULL, label=(90, 1330)),
        ],
        flag=[("01-exterior-facade.jpg", (0.55, 0.5)), ("07-terrace.jpg", (0.5, 0.5)), ("03-living-room.jpg", (0.5, 0.5))],
        card=dict(top=470, bottom=530, side=170), flagLabel=(90, 1330),
        cta=dict(lab=700, l1=760, l2=950, rule=1202, url=1240, bio=1376, eho=1610, more="Link in bio"),
        logoW=900, logoTop=700, tag=1150, url=1262,
    ),
    "landscape": dict(
        W=1920, H=1080, strips=8, titleX=160, lab=330, line1=560, line2=740, rule=820, cities=886,
        shots=[
            dict(slug="biltmore", file="01-lobby.png", focus=(0.5, 0.5), trans="dot", kb=[1.0, 1.07, 0, -12],
                 meta="Furnished studios · Rochester", panel=box(0, 0, 900, 1080), bg="ink", label=(1010, 420)),
            dict(slug="water-street", file="03-loft-mezzanine.jpg", focus=(0.5, 0.5), trans="strips", kb=[1.08, 1.0, 0, 0],
                 meta="Lofts · Downtown Rochester", panel=box(1020, 0, 900, 1080), bg="ink", label=(160, 420)),
            dict(slug="121-park-drive", file="01-exterior.jpg", focus=(0.45, 0.46), trans="whip", kb=[1.02, 1.09, -30, 0],
                 meta="A restored Victorian · Manlius", panel=FULL, label=(160, 720)),
            dict(slug="379-south-main-street", file="02-living-room.jpg", focus=(0.5, 0.5), trans="frame", kb=[1, 1, 0, 0],
                 meta="Original fireplaces · Geneva", panel=box(160, 130, 615, 820), bg="paper", label=(880, 420)),
            dict(slug="301-central-avenue", file="03-living-room-sofa.jpg", focus=(0.5, 0.62), trans="diag", kb=[1.1, 1.02, 20, 0],
                 meta="Fully renovated · Downtown Rochester", panel=FULL, label=(160, 720)),
            dict(slug="561-south-main-street", file="03-bedroom-tin-ceiling.jpg", focus=(0.5, 0.4), trans="punch", kb=[1.0, 1.05, 0, -8],
                 meta="Pressed-tin ceilings · Geneva", panel=FULL, label=(160, 720)),
        ],
        flag=[("01-exterior-facade.jpg", (0.55, 0.5)), ("05-lobby-lounge.jpg", (0.5, 0.5)), ("04-kitchen.jpg", (0.5, 0.5))],
        card=dict(top=170, bottom=170, side=520), flagLabel=(160, 720),
        cta=dict(lab=236, l1=290, l2=480, rule=730, url=768, bio=900, eho=990, more=f"Or call {build.PHONE}"),
        logoW=860, logoTop=210, tag=640, url=748,
    ),
}


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def music_file():
    cache = HERE.parent / "out" / "cache" / "day-trips.mp3"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(MUSIC["url"], headers={"User-Agent": "Mozilla/5.0"})
        cache.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    if hashlib.sha1(cache.read_bytes()).hexdigest() != MUSIC["sha1"]:
        sys.exit(f"{cache} is not the expected recording; delete it and run again")
    return cache


def prep(work, slug, file, focus, size, name):
    im = ImageOps.exif_transpose(Image.open(ROOT / "source/photos" / slug / file)).convert("RGB")
    im = kit.grade(ImageOps.fit(im, (round(size[0]), round(size[1])), Image.LANCZOS, centering=focus))
    im.save(work / name, quality=93, subsampling=0)
    return name


def icon_bottom():
    ys = [float(v) for c in build.LOGO["icon"] for v in re.findall(r"-?\d+(?:\.\d+)?", c["d"])[1::2]]
    return max(ys)


def panel_of(F, s):
    return box(0, 0, F["W"], F["H"]) if s["panel"] == FULL else s["panel"]


def layer_inner(F, s, img):
    """A shot's picture: an optional background, and the photo in its panel."""
    p = panel_of(F, s)
    bg = f'<div class="bg {s["bg"]}"></div>' if s.get("bg") else ""
    shade = '<div class="shade"></div>' if s["panel"] == FULL else ""
    return (f'{bg}<div class="panel" style="left:{p["x"]}px;top:{p["y"]}px;width:{p["w"]}px;height:{p["h"]}px">'
            f'<img src="{img}" alt="">{shade}</div>')


def label_html(id_, x, y, F, count, name, meta, on_paper):
    return (f'<div class="label{" on-paper" if on_paper else ""}" id="{id_}" style="left:{x}px;top:{y}px;width:{F["W"] - x - 60}px">'
            f'{count}<p class="nm">{name}</p><p class="mt">{build.esc(meta)}</p></div>')


def page(F, files, beat, drop, end):
    W, H = F["W"], F["H"]
    base_y = F["logoTop"] + F["logoW"] / 1000 * icon_bottom()
    rnd = random.Random(24)
    dust = [dict(x=W / 2 + rnd.uniform(-F["logoW"] * 0.48, F["logoW"] * 0.48), vx=rnd.choice((-1, 1)) * rnd.uniform(80, 520),
                 vy=-rnd.uniform(180, 720), r=rnd.uniform(2.5, 6.5), life=rnd.uniform(0.5, 1.0),
                 c=rnd.choice(("#debb92", "#e5e6d3"))) for _ in range(40)]
    data = dict(W=W, H=H, beat=beat, drop=drop, end=end, fps=FPS, titleX=F["titleX"], fontSize=176,
                shots=[dict(trans=s["trans"], kb=s["kb"]) for s in F["shots"]],
                card=F["card"], baseY=round(base_y, 1), logoW=F["logoW"],
                line1=F["line1"], line2=F["line2"], dotR=10, zoomTo=230, dust=dust)
    n = len(F["shots"])
    layers, labels = [], []
    for i, s in enumerate(F["shots"]):
        name = build.esc(build.PROPS[[p["slug"] for p in build.PROPS].index(s["slug"])]["name"])
        inner = layer_inner(F, s, files[f"shot{i}"])
        if s["trans"] == "strips":
            sw = W // F["strips"]
            strips = "".join(f'<div class="strip" style="left:{k * sw}px;width:{sw}px"><div class="full" style="left:{-k * sw}px">{inner}</div></div>'
                             for k in range(F["strips"]))
            layers.append(f'<div class="layer" id="shot{i}">{strips}</div>')
        else:
            if s["trans"] == "diag":
                layers.append(f'<div class="edge" id="edge{i}"></div>')
            layers.append(f'<div class="layer" id="shot{i}">{inner}</div>')
        count = f'<p class="ct"><span>{i + 1:02d}</span><i></i><span>{n:02d}</span></p>'
        labels.append(label_html(f"label{i}", *s["label"], F, count, name, s["meta"], s.get("bg") == "paper"))
    flag = "".join(f'<div class="layer" id="flag{k}"><div class="panel" style="left:0;top:0;width:{W}px;height:{H}px">'
                   f'<img src="{files[f"flag{k}"]}" alt=""><div class="shade"></div></div></div>' for k in range(3))
    flag += (f'<p class="toplab" id="flagtop" style="top:{F["card"]["top"] - 80}px">Our flagship</p>'
             + label_html("flaglabel", *F["flagLabel"], F, '<p class="ct"><span>Our flagship</span><i></i></p>',
                          "Charlotte Square", "charlottesquareroc.com", False))
    p0 = panel_of(F, F["shots"][0])
    tx = F["titleX"]
    intro = f'''<svg id="intro" viewBox="0 0 {W} {H}">
  <defs><mask id="homeMask" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
    <rect width="{W}" height="{H}" fill="black"/>
    <g id="t-maskzoom"><text id="t-home" class="serif it" x="{tx}" y="{F['line2']}" fill="white">home</text><circle id="t-dot" fill="white" r="10"/></g>
  </mask></defs>
  <g id="t-zoom"><g id="t-others">
    <text id="t-lab" class="lab" x="{tx}" y="{F['lab']}">Evolution24 Properties</text>
    <text id="t-an" class="serif" x="{tx}" y="{F['line1']}">An</text>
    <text id="t-evolution" class="serif" x="{tx + 210}" y="{F['line1']}">evolution</text>
    <text id="t-in" class="serif" x="{tx}" y="{F['line2']}">in</text>
    <line id="t-rule" x1="{tx}" x2="{W - tx}" y1="{F['rule']}" y2="{F['rule']}"/>
    <text id="t-cities" class="lab muted" x="{tx}" y="{F['cities']}">Rochester · Syracuse · Geneva</text>
  </g></g>
  <g id="t-homeg"><g id="t-tanzoom"><text id="t-hometan" class="serif it tan" x="{tx}" y="{F['line2']}">home</text><circle id="t-dottan" class="tanfill" r="10"/></g>
    <image id="t-homeimg" href="{files['shot0']}" x="{p0['x']}" y="{p0['y']}" width="{p0['w']}" height="{p0['h']}" preserveAspectRatio="xMidYMid slice" mask="url(#homeMask)"/></g>
</svg>'''
    c = F["cta"]
    cta = f'''<div id="cta"><div id="cta-fold"><div id="cta-edge"></div><div id="cta-paper">
  <p id="c-lab" class="clab" style="top:{c['lab']}px">Tours &amp; applications</p>
  <p id="c-l1" class="cbig" style="top:{c['l1']}px">Let’s find</p>
  <p id="c-l2" class="cbig" style="top:{c['l2']}px">your <em>place.</em></p>
  <div id="c-rule" style="top:{c['rule']}px"></div>
  <p id="c-url" style="top:{c['url']}px">evolution24.net</p>
  <p id="c-bio" class="clab" style="top:{c['bio']}px">{build.esc(c['more'])}</p>
  <p id="c-eho" style="top:{c['eho']}px">{build.EHO}Equal Housing Opportunity</p>
</div></div></div>'''
    dust_svg = "".join(f'<circle data-i="{k}" r="{d["r"]:.1f}" fill="{d["c"]}" opacity="0"/>' for k, d in enumerate(dust))
    bars = "".join(f'<path class="lg-i {x["cls"]}" d="{x["d"]}"/>' for x in build.LOGO["icon"])
    words = "".join(f'<path class="lg-w {x["cls"]}" d="{x["d"]}"/>' for x in build.LOGO["word"])
    logo = (f'<div id="logo"><svg id="logo-art" viewBox="0 0 1000 410" style="left:{(W - F["logoW"]) / 2}px;top:{F["logoTop"]}px;width:{F["logoW"]}px">{bars}{words}</svg>'
            f'<svg id="fx" viewBox="0 0 {W} {H}"><circle id="ring" cx="{W / 2}" cy="{base_y - 120:.0f}" r="40" fill="none" stroke="#debb92"/>'
            f'<g id="dust">{dust_svg}</g></svg>'
            f'<p id="l-tag" style="top:{F["tag"]}px">An evolution in <em>home.</em></p><p id="l-url" style="top:{F["url"]}px">evolution24.net</p></div>')
    css = (HERE / "story.css").read_text().replace("/*FONTS*/", kit.fonts())
    css += f":root{{--W:{W}px;--H:{H}px;--padX:{F['titleX']}px}} #cam{{transform-origin:{W / 2}px {H / 2}px}}"
    js = (HERE / "story.js").read_text()
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>'
            f'<svg width="0" height="0" style="position:absolute"><filter id="whip" x="-20%" y="0" width="140%" height="100%">'
            f'<feGaussianBlur id="whipblur" stdDeviation="0 0"/></filter></svg>'
            f'<div id="stage"><div id="cam">{"".join(layers)}{flag}{"".join(labels)}{intro}{cta}<div id="ground"></div>{logo}</div>'
            f'<div id="flash"></div></div>'
            f'<script>window.STORY={json.dumps(data)};</script><script>{js}</script></body></html>')


def timing(n_shots):
    beat = 60 / MUSIC["bpm"]
    drop = MUSIC["bar3"] - MUSIC["bar2"]
    slam = drop + (2 * n_shots + 8) * beat
    return beat, drop, slam, round(slam + 4.0, 3)


def make_page(name, F):
    work = OUT / "work" / name
    work.mkdir(parents=True, exist_ok=True)
    beat, drop, slam, end = timing(len(F["shots"]))
    files = {}
    for i, s in enumerate(F["shots"]):
        p = panel_of(F, s)
        files[f"shot{i}"] = prep(work, s["slug"], s["file"], s["focus"], (p["w"] * 1.25, p["h"] * 1.25), f"shot{i}.jpg")
    for k, (file, focus) in enumerate(F["flag"]):
        files[f"flag{k}"] = prep(work, "charlotte-square", file, focus, (F["W"] * 1.25, F["H"] * 1.25), f"flag{k}.jpg")
    (work / "story.html").write_text(page(F, files, beat, drop, end))
    print(f"{name}: {F['W']}x{F['H']}, drop {drop:.3f}s, logo lands {slam:.3f}s, ends {end:.3f}s")
    return work


def main():
    names = [a for a in sys.argv[1:] if a in FORMATS] or (
        [sys.argv[sys.argv.index("--format") + 1]] if "--format" in sys.argv else list(FORMATS))
    works = {name: make_page(name, FORMATS[name]) for name in names}
    if "--page-only" in sys.argv:
        return
    beat, drop, slam, end = timing(len(FORMATS["story"]["shots"]))
    wav = OUT / "work" / "audio.wav"
    audio.make(music_file(), wav, ffmpeg(), MUSIC, beat=beat, drop=drop, slam=slam, end=end, shots=FORMATS["story"]["shots"])
    for name, work in works.items():
        video = work / "video.mp4"
        if "--audio-only" not in sys.argv or not video.exists():      # --audio-only: keep the frames, redo the sound
            subprocess.run(["node", str(HERE / "frames.cjs"), str(work / "story.html"), str(video), ffmpeg(), str(FPS)], check=True)
        final = OUT / f"evolution24-{name}.mp4"
        audio.mux(video, wav, final, ffmpeg())
        print(final, f"{final.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
