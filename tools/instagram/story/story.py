#!/usr/bin/env python3
"""A branded Instagram Story, cut to the beat of a CC0 track, ending on the logo.

    python3 tools/instagram/story/story.py [out-dir]     (default: tools/instagram/out/story)

Writes evolution24-story.mp4 (1080 x 1920, 30 fps, H.264 + AAC, about 20 s), a contact
sheet of frames, and the page it was drawn from. Needs Pillow, numpy, scipy, Playwright
and ffmpeg (on PATH, or `pip install imageio-ffmpeg`).

How it is made:
- The music is "Day Trips" by HoliznaCC0 (album City Slacker), dedicated to the public
  domain under CC0 1.0 (https://freemusicarchive.org/music/holiznacc0/city-slacker/day-trips/).
  It is 90 BPM. The Story starts two bars before the groove comes in, so the title
  plays over the build and the first photo lands on the drop.
- Every cut, word and transition is placed on the beat grid. story.js draws any moment
  of the timeline on its own, so frames are rendered one by one at 60 fps and blended
  in pairs to 30 fps, which gives fast moves a little motion blur.
- The ending jingle (a riser, the impact of the logo landing and a four-note chime in
  the track's key, G major) is synthesised in audio.py, so it is ours to use freely.
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
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "out" / "story"
WORK = OUT / "work"
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

# The montage: one shot every two beats. "trans" is how each shot comes in.
SHOTS = [
    dict(slug="biltmore", file="01-lobby.png", focus=(0.5, 0.5), trans="dot", kb=[1.0, 1.08, 0, -20],
         meta="Furnished studios · Rochester"),
    dict(slug="water-street", file="03-loft-mezzanine.jpg", focus=(0.5, 0.5), trans="strips", kb=[1.1, 1.02, 30, 0],
         meta="Lofts · Downtown Rochester"),
    dict(slug="121-park-drive", file="01-exterior.jpg", focus=(0.45, 0.5), trans="whip", kb=[1.02, 1.1, -30, 0],
         meta="A restored Victorian · Manlius"),
    dict(slug="379-south-main-street", file="02-living-room.jpg", focus=(0.5, 0.5), trans="frame", kb=[1, 1, 0, 0],
         meta="Original fireplaces · Geneva"),
    dict(slug="301-central-avenue", file="03-living-room-sofa.jpg", focus=(0.5, 0.6), trans="diag", kb=[1.12, 1.03, 0, 30],
         meta="Fully renovated · Downtown Rochester"),
    dict(slug="561-south-main-street", file="04-bedroom.jpg", focus=(0.5, 0.45), trans="punch", kb=[1.0, 1.05, 0, -10],
         meta="Pressed-tin ceilings · Geneva"),
]
FLAG = [("charlotte-square", "01-exterior-facade.jpg", (0.55, 0.5)),
        ("charlotte-square", "07-terrace.jpg", (0.5, 0.5)),
        ("charlotte-square", "03-living-room.jpg", (0.5, 0.5))]
FRAME = dict(x=110, y=200, w=860, h=1147)            # the window on paper, for the one framed shot
LOGO_W, LOGO_TOP = 900, 700


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def prep(slug, file, focus, size, name):
    im = ImageOps.exif_transpose(Image.open(ROOT / "source/photos" / slug / file)).convert("RGB")
    im = kit.grade(ImageOps.fit(im, size, Image.LANCZOS, centering=focus))
    im.save(WORK / name, quality=93, subsampling=0)
    return name


def music_file():
    cache = HERE.parent / "out" / "cache" / "day-trips.mp3"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(MUSIC["url"], headers={"User-Agent": "Mozilla/5.0"})
        cache.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    if hashlib.sha1(cache.read_bytes()).hexdigest() != MUSIC["sha1"]:
        sys.exit(f"{cache} is not the expected recording; delete it and run again")
    return cache


def logo_svg():
    """The site's logo, one path per bar and letter, so each can move on its own."""
    fill = {"t": "t", "c": "c"}
    bars = "".join(f'<path class="lg-i {fill[c["cls"]]}" d="{c["d"]}"/>' for c in build.LOGO["icon"])
    words = "".join(f'<path class="lg-w {fill[c["cls"]]}" d="{c["d"]}"/>' for c in build.LOGO["word"])
    return f'<svg id="logo-art" viewBox="0 0 1000 410" style="left:{(1080 - LOGO_W) / 2}px;top:{LOGO_TOP}px;width:{LOGO_W}px">{bars}{words}</svg>'


def icon_bottom():
    ys = [float(v) for c in build.LOGO["icon"] for v in re.findall(r"-?\d+(?:\.\d+)?", c["d"])[1::2]]
    return max(ys)


def page(files, beat, drop, end):
    base_y = LOGO_TOP + LOGO_W / 1000 * icon_bottom()
    rnd = random.Random(24)
    dust = [dict(x=540 + rnd.uniform(-430, 430), vx=rnd.choice((-1, 1)) * rnd.uniform(80, 520),
                 vy=-rnd.uniform(180, 720), r=rnd.uniform(2.5, 6.5), life=rnd.uniform(0.5, 1.0),
                 c=rnd.choice(("#debb92", "#e5e6d3"))) for _ in range(40)]
    data = dict(beat=beat, drop=drop, end=end, fps=FPS, shots=[dict(trans=s["trans"], kb=s["kb"]) for s in SHOTS],
                card=dict(top=470, bottom=530, side=170), baseY=round(base_y, 1), logoW=LOGO_W,
                line1=860, line2=1060, dotR=10, zoomTo=230, dust=dust)
    n = len(SHOTS)
    layers, labels = [], []
    for i, s in enumerate(SHOTS):
        name = build.esc(build.PROPS[[p["slug"] for p in build.PROPS].index(s["slug"])]["name"])
        img = files[f"shot{i}"]
        shade = '<div class="shade"></div>'
        if s["trans"] == "strips":
            strips = "".join(f'<div class="strip" style="left:{k * 216}px"><div class="full" style="left:{-k * 216}px">'
                             f'<img src="{img}" alt="">{shade}</div></div>' for k in range(5))
            layers.append(f'<div class="layer" id="shot{i}">{strips}</div>')
        elif s["trans"] == "frame":
            f = FRAME
            layers.append(f'<div class="layer" id="shot{i}"><div class="bg"></div><div class="win" style="left:{f["x"]}px;top:{f["y"]}px;'
                          f'width:{f["w"]}px;height:{f["h"]}px"><img src="{img}" alt=""></div></div>')
        else:
            if s["trans"] == "diag":
                layers.append(f'<div class="edge" id="edge{i}"></div>')
            layers.append(f'<div class="layer" id="shot{i}"><img src="{img}" alt="">{shade}</div>')
        paper = s["trans"] == "frame"
        top = FRAME["y"] + FRAME["h"] + 52 if paper else 1330
        labels.append(f'<div class="label{" on-paper" if paper else ""}" id="label{i}" style="top:{top}px">'
                      f'<p class="ct"><span>{i + 1:02d}</span><i></i><span>{n:02d}</span></p>'
                      f'<p class="nm">{name}</p><p class="mt">{build.esc(s["meta"])}</p></div>')
    flag = "".join(f'<div class="layer" id="flag{k}"><img src="{files[f"flag{k}"]}" alt=""><div class="shade"></div></div>' for k in range(3))
    flag += (f'<p class="toplab" id="flagtop" style="top:{data["card"]["top"] - 80}px">Our flagship</p>'
             '<div class="label" id="flaglabel" style="top:1330px"><p class="ct"><span>Our flagship</span><i></i></p>'
             '<p class="nm">Charlotte Square</p><p class="mt">charlottesquareroc.com</p></div>')
    intro = f'''<svg id="intro" viewBox="0 0 1080 1920">
  <defs><mask id="homeMask" maskUnits="userSpaceOnUse" x="0" y="0" width="1080" height="1920">
    <rect width="1080" height="1920" fill="black"/>
    <g id="t-maskzoom"><text id="t-home" class="serif it" x="90" y="{data['line2']}" fill="white">home</text><circle id="t-dot" fill="white" r="10"/></g>
  </mask></defs>
  <g id="t-zoom"><g id="t-others">
    <text id="t-lab" class="lab" x="90" y="600">Evolution24 Properties</text>
    <text id="t-an" class="serif" x="90" y="{data['line1']}">An</text>
    <text id="t-evolution" class="serif" x="300" y="{data['line1']}">evolution</text>
    <text id="t-in" class="serif" x="90" y="{data['line2']}">in</text>
    <line id="t-rule" x1="90" x2="990" y1="1150" y2="1150"/>
    <text id="t-cities" class="lab muted" x="90" y="1222">Rochester · Syracuse · Geneva</text>
  </g></g>
  <g id="t-homeg"><g id="t-tanzoom"><text id="t-hometan" class="serif it tan" x="90" y="{data['line2']}">home</text><circle id="t-dottan" class="tanfill" r="10"/></g>
    <image id="t-homeimg" href="{files['shot0']}" x="0" y="0" width="1080" height="1920" preserveAspectRatio="xMidYMid slice" mask="url(#homeMask)"/></g>
</svg>'''
    cta = f'''<div id="cta"><div id="cta-fold"><div id="cta-edge"></div><div id="cta-paper">
  <p id="c-lab" class="clab">Tours &amp; applications</p>
  <p id="c-l1" class="cbig">Let’s find</p>
  <p id="c-l2" class="cbig">your <em>place.</em></p>
  <div id="c-rule"></div>
  <p id="c-url">evolution24.net</p>
  <p id="c-bio" class="clab">Link in bio</p>
  <p id="c-eho">{build.EHO}Equal Housing Opportunity</p>
</div></div></div>'''
    dust_svg = "".join(f'<circle data-i="{k}" r="{d["r"]:.1f}" fill="{d["c"]}" opacity="0"/>' for k, d in enumerate(dust))
    logo = (f'<div id="logo">{logo_svg()}<svg id="fx" viewBox="0 0 1080 1920"><circle id="ring" cx="540" cy="{base_y - 120:.0f}" r="40" fill="none" stroke="#debb92"/>'
            f'<g id="dust">{dust_svg}</g></svg>'
            f'<p id="l-tag">An evolution in <em>home.</em></p><p id="l-url">evolution24.net</p></div>')
    css = (HERE / "story.css").read_text().replace("/*FONTS*/", kit.fonts())
    js = (HERE / "story.js").read_text()
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>'
            f'<svg width="0" height="0" style="position:absolute"><filter id="whip" x="-20%" y="0" width="140%" height="100%">'
            f'<feGaussianBlur id="whipblur" stdDeviation="0 0"/></filter></svg>'
            f'<div id="stage"><div id="cam">{"".join(layers)}{flag}{"".join(labels)}{intro}{cta}<div id="ground"></div>{logo}</div>'
            f'<div id="flash"></div></div>'
            f'<script>window.STORY={json.dumps(data)};</script><script>{js}</script></body></html>')


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    beat = 60 / MUSIC["bpm"]
    drop = MUSIC["bar3"] - MUSIC["bar2"]
    slam = drop + (2 * len(SHOTS) + 8) * beat
    end = round(slam + 4.0, 3)
    files = {}
    for i, s in enumerate(SHOTS):
        size = (round(FRAME["w"] * 1.25), round(FRAME["h"] * 1.25)) if s["trans"] == "frame" else (1350, 2400)
        files[f"shot{i}"] = prep(s["slug"], s["file"], s["focus"], size, f"shot{i}.jpg")
    for k, (slug, file, focus) in enumerate(FLAG):
        files[f"flag{k}"] = prep(slug, file, focus, (1350, 2400), f"flag{k}.jpg")
    (WORK / "story.html").write_text(page(files, beat, drop, end))
    print(f"page written: {len(SHOTS)} shots, drop {drop:.3f}s, logo lands {slam:.3f}s, ends {end:.3f}s")
    if "--page-only" in sys.argv:
        return
    video = WORK / "video.mp4"
    if "--audio-only" not in sys.argv or not video.exists():      # --audio-only: keep the frames, redo the sound
        subprocess.run(["node", str(HERE / "frames.cjs"), str(WORK / "story.html"), str(video), ffmpeg(), str(FPS)], check=True)
    wav = WORK / "audio.wav"
    audio.make(music_file(), wav, ffmpeg(), MUSIC, beat=beat, drop=drop, slam=slam, end=end, shots=SHOTS)
    final = OUT / "evolution24-story.mp4"
    audio.mux(video, wav, final, ffmpeg())
    print(final, f"{final.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
