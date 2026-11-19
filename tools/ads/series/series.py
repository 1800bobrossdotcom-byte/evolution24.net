#!/usr/bin/env python3
"""A series of six motion-graphic video ads for one building, for Facebook and Instagram.

    python3 tools/ads/series/series.py [145-south-fitzhugh-street] [out-dir] [--only now-renting,details] [--stills-only]

Default out-dir: tools/ads/out/series/<slug>. For each ad, in both shapes:
  <ad>-feed.mp4    1080 x 1350 (4:5), 15 s, Facebook and Instagram feeds
  <ad>-story.mp4   1080 x 1920 (9:16), 15 s, Stories and Reels (words kept out of the app's top and bottom bars)
  <ad>-feed.jpg, <ad>-story.jpg   a still from the middle, for the thumbnail or a picture ad
and overview.jpg (every ad's still on one sheet), ads.md (each ad's words to post, its link and how
to set the campaign up) and a zip of the lot.

How they are made: series.js draws any moment of an ad on its own from the description here, so
the story kit's frames.cjs renders the frames one by one at 60 fps and blends them to 30 (a little
motion blur on fast moves). Photos are the building's own, graded like the Instagram kit. The
soundtrack is made in music.py from sine waves and noise, a different key and progression for each
ad, with a swoosh on each moving transition, a tick as words and boxes land and a hit and chime
under the end card; it is ours, with no licence to track.

What is open and its rent come from data/properties.json, the website's "Available now" list, and
every ad says when the rents were listed and carries the Equal Housing Opportunity mark. The words
say what the homes are, never who they are for (Meta's Housing ad category, and the fair housing
rules). Run it again when the list changes.
"""
import datetime as dt
import importlib.util
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import music  # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    saved = sys.argv[:]
    sys.argv[1:] = []
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv[:] = saved
    return module


ARGS = sys.argv[1:]
build = load("build", ROOT / "scripts/build.py")
kit = load("kit", ROOT / "tools/instagram/make.py")
PROPS = {p["slug"]: p for p in build.PROPS}

FPS = 60
SECONDS = 15.0
BEAT = music.BEAT                  # 0.625 s at 96 BPM: every cut and word sits on this grid
END_AT = 18 * BEAT                 # 11.25 s: the end card
FORMATS = {"feed": dict(W=1080, H=1350), "story": dict(W=1080, H=1920)}
# Stories keep their top and bottom ~250 px clear of the app's own bars: words placed against the
# top of a feed ad move down 230 px in a story, those against its bottom 320 (so they end above
# the bottom bar), and those in the middle 285.
SHIFT = {"top": 230, "mid": 285, "bottom": 320}


def facts(slug):
    p = PROPS[slug]
    units = p["units"]
    studios = [u for u in units if u["beds"] == 0]
    ones = [u for u in units if u["beds"] == 1]
    low = lambda us: min(u["rent"] for u in us) if us else None
    sq = lambda us: max((u.get("sqft") or 0) for u in us) if us else 0
    return dict(n=len(units), low=low(units), studios=len(studios), studio_low=low(studios), studio_sqft=sq(studios),
                ones=len(ones), one_low=low(ones), one_sqft=sq(ones),
                listed=dt.date.fromisoformat(build.UNITS_AS_OF))


def money(v):
    return build.money(v)


def listed(d):
    return f"{d.strftime('%b')} {d.day}, {d.year}"


# ---------------------------------------------------------------- the six ads
def series(slug):
    """Six ads for 145 South Fitzhugh, each a different idea and a different motion."""
    f = facts(slug)
    T = BEAT
    shots = lambda *ss: [dict(zip(("file", "t0", "trans", "d", "kb", "focus"), s)) for s in ss]
    price = lambda v, pre="from": dict(anim="count", kind="price", pre=pre, to=v, frm=round(v * 0.72, -1))
    parking = "Off-street parking · On-site laundry"
    open_s = f"{f['studios']} open now" if f["studios"] != 1 else "1 open now"
    open_1 = f"{f['ones']} open now" if f["ones"] != 1 else "1 open now"
    ads = []

    # 1. Now renting: the building's headline, the stamp, the rent counting up.
    ads.append(dict(
        key="now-renting", title="Now renting", key_="A", prog=0, drums=0,
        shade="full",
        shots=shots(("15-studio-bedroom.jpg", 0, "cut", 0.01, [1.14, 1.0, 0, 0], (0.5, 0.5)),
                    ("02-living-room.jpg", 6 * T, "diag", 0.55, [1.0, 1.1, 0, -10], (0.5, 0.55)),
                    ("09-kitchen-red-fridge.jpg", 10 * T, "wipeU", 0.5, [1.1, 1.0, 10, 0], (0.6, 0.5)),
                    ("01-exterior.jpg", 14 * T, "iris", 0.6, [1.0, 1.12, 0, -10], (0.5, 0.5))),
        items=[
            dict(anim="stamp", kind="stamp", x=780, y=60, at="top", t0=0.35, d=0.6, big=str(f["n"]), small="homes", ring="Now renting"),
            dict(anim="slide", kind="text", cls="kicker", html="Now renting · Rochester", x=70, y=760, at="bottom", t0=0.5),
            dict(anim="rise", kind="lines", cls="big", lines=["145 South", "<em>Fitzhugh</em>"], x=70, y=800, at="bottom", t0=0.7, d=0.7),
            dict(anim="words", kind="words", cls="facts", text="Studios and 1-bedrooms, just outside downtown.", x=70, y=1035, w=940, at="bottom", t0=1.9, t1=9.4),
            dict(price(f["low"]), x=70, y=1100, at="bottom", t0=4.0, d=0.9),
            dict(anim="words", kind="words", cls="facts", text=parking + ".", x=70, y=1035, w=940, at="bottom", t0=9.8, t1=END_AT),
        ],
        end=("Tours by appointment", "Book a <em>tour.</em>"),
        copy=dict(
            primary=f"Now renting at 145 South Fitzhugh: modern studios and 1-bedroom apartments on a quiet street just outside downtown Rochester, from {money(f['low'])} a month. Off-street parking and on-site laundry. Book a tour.",
            headline=f"Studios & 1-beds from {money(f['low'])}/mo",
            description="145 South Fitzhugh St, Rochester"),
    ))

    # 2. Room by room: a fast tour on the beat, every room named, a bar across the top of the two kinds of home.
    rooms = [("13-studio-living.jpg", "Living room"), ("14-studio-kitchen.jpg", "Kitchen"), ("15-studio-bedroom.jpg", "Bedroom"),
             ("17-studio-bathroom.jpg", "Bathroom"), ("02-living-room.jpg", "Living room"), ("09-kitchen-red-fridge.jpg", "Kitchen"),
             ("16-studio-bedroom-2.jpg", "Bedroom"), ("10-bathroom-2.jpg", "Bathroom")]
    trans = ["slideL", "wipeU", "zoom", "diag", "slideL", "iris", "wipeR", "slideU"]
    kbs = [[1.08, 1.0, 0, 0], [1.0, 1.08, 0, 0], [1.1, 1.02, -12, 0], [1.0, 1.08, 0, 10]]
    tour = [(file, 2 * T + i * 2 * T, trans[i], 0.42, kbs[i % 4], (0.5, 0.5)) for i, (file, _) in enumerate(rooms)]
    room_items = []
    for i, (file, name) in enumerate(rooms):
        t0 = 2 * T + i * 2 * T
        room_items.append(dict(anim="pop", kind="pill", html=f"<i>{i + 1:02d}</i>{name}", x=70, y=1000, at="bottom",
                               t0=t0 + 0.12, t1=t0 + 2 * T - 0.2, d=0.4))
    ads.append(dict(
        key="room-by-room", title="Room by room", key_="F", prog=1, drums=2,
        shade="full", bg="ink",
        shots=shots(*tour),
        items=[
            dict(anim="slide", kind="text", cls="kicker", html="145 South Fitzhugh · Rochester", x=70, y=470, at="mid", t0=0.05, t1=2 * T - 0.25, d=0.4),
            dict(anim="rise", kind="lines", cls="huge", lines=["Take the", "<em>tour.</em>"], x=70, y=520, at="mid", t0=0.12, t1=2 * T - 0.25, d=0.5),
            dict(anim="bar", kind="bar", segs=["Studios", "1-bedrooms"], marks=[2 * T, 10 * T], x=70, y=180, w=940, at="top", t0=2 * T, t1=END_AT),
            dict(anim="rise", kind="lines", cls="mid", lines=[f"Studios <em>from {money(f['studio_low'])}</em>"], x=70, y=1085, at="bottom", t0=2 * T + 0.2, t1=10 * T - 0.25),
            dict(anim="rise", kind="lines", cls="mid", lines=[f"1-bedrooms <em>from {money(f['one_low'])}</em>"], x=70, y=1085, at="bottom", t0=10 * T + 0.2, t1=END_AT),
            *room_items,
        ],
        end=("Seen enough?", "Come see it <em>in person.</em>"),
        copy=dict(
            primary=f"Take the tour of 145 South Fitzhugh, room by room. Studios from {money(f['studio_low'])} and 1-bedrooms from {money(f['one_low'])} a month, just outside downtown Rochester. Book a tour to see it in person.",
            headline="Take the tour, room by room",
            description=f"Studios from {money(f['studio_low'])} · 1-beds from {money(f['one_low'])}"),
    ))

    # 3. Studios: the photo above, the words below, the photos wiping across each other.
    split = {"feed": dict(x=0, y=0, w=1080, h=760), "story": dict(x=0, y=0, w=1080, h=1110)}
    ads.append(dict(
        key="studios", title="Studios", key_="D", prog=2, drums=0,
        shade="top", bg="ink",
        shots=[dict(s, box=split) for s in shots(
            ("13-studio-living.jpg", 0, "iris", 0.6, [1.12, 1.0, 0, 0], (0.5, 0.5)),
            ("21-studio-kitchen-2.jpg", 6 * T, "wipeL", 0.5, [1.0, 1.1, 0, 0], (0.5, 0.5)),
            ("16-studio-bedroom-2.jpg", 10 * T, "wipeR", 0.5, [1.1, 1.0, 0, 0], (0.5, 0.45)),
            ("24-studio-bathroom-2.jpg", 14 * T, "wipeU", 0.5, [1.0, 1.08, 0, 0], (0.5, 0.5)))],
        items=[
            dict(anim="pop", kind="pill", html="Studio apartments", x=70, y=(660, 1010), t0=0.9, d=0.45),
            dict(anim="rise", kind="lines", cls="big", lines=["Your own", "<em>place.</em>"], x=70, y=(800, 1160), t0=0.4, d=0.7),
            dict(price(f["studio_low"]), x=560, y=(860, 1220), t0=2.2, d=0.9),
            dict(anim="rule", kind="rule", x=70, y=(1050, 1430), w=940, t0=3.4, d=0.8),
            dict(anim="up", kind="text", cls="facts", html=f"About {f['studio_sqft']} sq ft · {open_s}", x=70, y=(1090, 1470), t0=3.7, t1=8.2),
            dict(anim="up", kind="text", cls="facts", html=parking, x=70, y=(1090, 1470), t0=8.5, t1=END_AT),
        ],
        end=("Studios from " + money(f["studio_low"]), "Make it <em>yours.</em>"),
        copy=dict(
            primary=f"Studio apartments at 145 South Fitzhugh, about {f['studio_sqft']} sq ft, from {money(f['studio_low'])} a month: modern kitchens and bathrooms on a quiet street just outside downtown Rochester. {open_s.capitalize()}. Book a tour.",
            headline=f"Studios from {money(f['studio_low'])}/mo",
            description="145 South Fitzhugh St, Rochester"),
    ))

    # 4. 1-bedrooms: light, framed, the photos pushing in from the side.
    inset = {"feed": dict(x=60, y=160, w=960, h=690), "story": dict(x=60, y=300, w=960, h=860)}
    ads.append(dict(
        key="one-bedrooms", title="1-bedrooms", key_="G", prog=3, drums=1,
        shade=None, bg="paper", paper=True, lockup=(dict(x=100, y=200), dict(x=100, y=340)),
        shots=[dict(s, box=inset, round=True) for s in shots(
            ("02-living-room.jpg", 0, "slideU", 0.6, [1.1, 1.0, 0, 0], (0.5, 0.55)),
            ("08-living-room-3.jpg", 6 * T, "slideL", 0.5, [1.0, 1.08, 0, 0], (0.5, 0.5)),
            ("09-kitchen-red-fridge.jpg", 10 * T, "slideL", 0.5, [1.08, 1.0, 0, 0], (0.6, 0.5)),
            ("10-bathroom-2.jpg", 14 * T, "slideL", 0.5, [1.0, 1.08, 0, 0], (0.5, 0.5)))],
        items=[
            dict(anim="pop", kind="pill", html="1-bedroom apartments", x=100, y=(760, 1070), t0=0.9, d=0.45),
            dict(anim="slide", kind="text", cls="kicker", html="145 South Fitzhugh · Rochester", x=60, y=(900, 1205), t0=0.5),
            dict(anim="rise", kind="lines", cls="big", lines=["Room to <em>breathe.</em>"], x=60, y=(945, 1250), t0=0.7, d=0.7),
            dict(price(f["one_low"]), x=60, y=(1075, 1380), t0=2.4, d=0.9),
            dict(anim="up", kind="text", cls="facts", html=f"About {f['one_sqft']} sq ft · {open_1}", x=60, y=(1218, 1530), t0=3.8, t1=8.2),
            dict(anim="up", kind="text", cls="facts", html=parking, x=60, y=(1218, 1530), t0=8.5, t1=END_AT),
        ],
        end=("1-bedrooms from " + money(f["one_low"]), "Come take a <em>look.</em>"),
        copy=dict(
            primary=f"1-bedroom apartments at 145 South Fitzhugh, about {f['one_sqft']} sq ft, from {money(f['one_low'])} a month, on a quiet street just outside downtown Rochester. Off-street parking and on-site laundry. {open_1.capitalize()}. Book a tour.",
            headline=f"1-bedrooms from {money(f['one_low'])}/mo",
            description="145 South Fitzhugh St, Rochester"),
    ))

    # 5. The details: a checklist that ticks itself off on the beat.
    ticks = ["Off-street parking", "On-site laundry", "Extra storage available", "Modern kitchens"]
    ads.append(dict(
        key="details", title="The details", key_="E", prog=4, drums=0,
        shade="heavy",
        shots=shots(("19-studio-living-2.jpg", 0, "fade", 0.4, [1.12, 1.02, 0, 0], (0.5, 0.5)),
                    ("20-studio-living-3.jpg", 6 * T, "diag", 0.55, [1.02, 1.1, 0, 0], (0.5, 0.5)),
                    ("21-studio-kitchen-2.jpg", 12 * T, "wipeL", 0.5, [1.1, 1.0, 0, 0], (0.5, 0.5))),
        items=[
            dict(anim="slide", kind="text", cls="kicker", html="145 South Fitzhugh", x=70, y=330, at="top", t0=0.3),
            dict(anim="rise", kind="lines", cls="big", lines=["The good", "<em>stuff.</em>"], x=70, y=375, at="top", t0=0.45, d=0.7),
            *[dict(anim="tick", kind="tick", text=w, x=70, y=690 + i * 96, at="top", t0=3 * T + i * 2 * T, d=0.6) for i, w in enumerate(ticks)],
            dict(price(f["low"]), x=70, y=1105, at="top", t0=12 * T, d=0.9),
        ],
        end=("Studios & 1-bedrooms", "Let’s find your <em>place.</em>"),
        copy=dict(
            primary=f"The details at 145 South Fitzhugh: off-street parking, on-site laundry, extra storage available and modern kitchens. Studios and 1-bedrooms from {money(f['low'])} a month, just outside downtown Rochester. Book a tour.",
            headline="Parking, laundry, storage: sorted",
            description=f"Studios & 1-beds from {money(f['low'])}/mo"),
    ))

    # 6. Where it is: the pin drops on the building, the address types itself, then inside.
    ads.append(dict(
        key="location", title="Where it is", key_="C", prog=5, drums=1,
        shade="full",
        shots=shots(("01-exterior.jpg", 0, "zoom", 0.7, [1.0, 1.14, 0, 0], (0.5, 0.5)),
                    ("13-studio-living.jpg", 10 * T, "wipeU", 0.5, [1.1, 1.0, 0, 0], (0.5, 0.5)),
                    ("15-studio-bedroom.jpg", 14 * T, "diag", 0.55, [1.0, 1.1, 0, 0], (0.5, 0.5))),
        items=[
            dict(anim="pin", kind="pin", x=480, y=250, at="top", t0=0.3, t1=10 * T - 0.3),
            dict(anim="type", kind="type", text="145 South Fitzhugh Street", x=70, y=755, at="bottom", t0=1.0, d=1.1, t1=10 * T - 0.3),
            dict(anim="rise", kind="lines", cls="big", lines=["Just outside", "<em>downtown.</em>"], x=70, y=810, at="bottom", t0=2 * T + 0.3, d=0.7, t1=10 * T - 0.3),
            dict(anim="words", kind="words", cls="facts", text="Close to shopping, dining and hospitals.", x=70, y=1045, w=940, at="bottom", t0=5.0, t1=10 * T - 0.3),
            dict(anim="slide", kind="text", cls="kicker", html="Studios & 1-bedrooms", x=70, y=850, at="bottom", t0=10 * T + 0.3),
            dict(price(f["low"]), x=70, y=895, at="bottom", t0=10 * T + 0.5, d=0.9),
            dict(anim="words", kind="words", cls="facts", text=parking + ".", x=70, y=1045, w=940, at="bottom", t0=13 * T, t1=END_AT),
        ],
        end=("145 South Fitzhugh St · Rochester", "Your next <em>address?</em>"),
        copy=dict(
            primary=f"145 South Fitzhugh Street: modern studios and 1-bedrooms just outside downtown Rochester, close to shopping, dining and hospitals, from {money(f['low'])} a month. Off-street parking and on-site laundry. Book a tour.",
            headline="Just outside downtown Rochester",
            description=f"Studios & 1-beds from {money(f['low'])}/mo"),
    ))
    return ads, f


# ---------------------------------------------------------------- the page
def ypos(item, fmt):
    y = item["y"]
    if isinstance(y, tuple):
        return y[0] if fmt == "feed" else y[1]
    return y if fmt == "feed" else y + SHIFT[item.get("at", "bottom")]


def stamp_svg(big, small, ring):
    ring = " · ".join([ring] * max(1, 48 // (len(ring) + 3))) + " · "
    return ('<svg class="stamp" viewBox="0 0 300 300" aria-hidden="true">'
            '<defs><path id="ring" d="M150 150m-112 0a112 112 0 1 1 224 0a112 112 0 1 1-224 0"/></defs>'
            '<circle cx="150" cy="150" r="148" class="disc"/><circle cx="150" cy="150" r="84" class="rul"/>'
            f'<text class="ringt"><textPath href="#ring" textLength="700" lengthAdjust="spacing">{ring}</textPath></text>'
            f'<text x="150" y="168" class="count">{build.esc(big)}</text><text x="150" y="200" class="unit">{build.esc(small)}</text></svg>')


def item_html(i, it, fmt, paper):
    x, y = it["x"], ypos(it, fmt)
    style = f"left:{x}px;top:{y}px" + (f";width:{it['w']}px" if it.get("w") else "")
    k = it["kind"]
    cls = "item" + (" on-paper" if paper else "")
    if k == "lines":
        inner = "".join(f'<div class="ln"><span>{ln}</span></div>' for ln in it["lines"])
        return f'<div class="{cls} {it["cls"]}" id="item{i}" style="{style}">{inner}</div>'
    if k == "words":
        inner = " ".join(f'<span class="w">{build.esc(w)}</span>' for w in it["text"].split())
        return f'<div class="{cls} {it["cls"]}" id="item{i}" style="{style}">{inner}</div>'
    if k == "text":
        return f'<div class="{cls} {it["cls"]}" id="item{i}" style="{style}">{it["html"]}</div>'
    if k == "pill":
        return f'<div class="{cls}" id="item{i}" style="{style}"><span class="pill">{it["html"]}</span></div>'
    if k == "price":
        return (f'<div class="{cls} price" id="item{i}" style="{style}"><span class="pre">{build.esc(it["pre"])}</span>'
                f'<span class="num">{money(it["to"])}</span><small>/mo</small></div>')
    if k == "rule":
        return f'<div class="{cls} rule" id="item{i}" style="{style}"></div>'
    if k == "type":
        return (f'<div class="{cls} typed" id="item{i}" style="{style}" data-text="{build.esc(it["text"])}">'
                f'<span class="tt"></span><span class="caret"></span></div>')
    if k == "tick":
        return (f'<div class="{cls} tick" id="item{i}" style="{style}"><span class="box"><svg viewBox="0 0 40 40">'
                f'<path class="mark" d="M9 21l7 7 15-16"/></svg></span><span class="ttx">{build.esc(it["text"])}</span></div>')
    if k == "stamp":
        return f'<div class="{cls} center" id="item{i}" style="{style}">{stamp_svg(it["big"], it["small"], it["ring"])}</div>'
    if k == "pin":
        return (f'<div class="{cls} pin center" id="item{i}" style="{style};width:120px;height:160px"><svg viewBox="0 0 120 160" width="120" height="160">'
                '<circle class="ring" cx="60" cy="150" r="20"/><circle class="ring" cx="60" cy="150" r="20"/><circle class="ring" cx="60" cy="150" r="20"/>'
                '<g class="pinhead"><path d="M60 150C60 150 18 92 18 58a42 42 0 0 1 84 0c0 34-42 92-42 92z"/><circle cx="60" cy="58" r="16"/></g></svg></div>')
    if k == "bar":
        segs = "".join(f'<span class="seg">{build.esc(s)}</span>' for s in it["segs"])
        return (f'<div class="{cls} barw" id="item{i}" style="{style}"><div class="segs">{segs}</div>'
                f'<div class="bar"><div class="fill"></div></div></div>')
    raise ValueError(k)


def page(ad, fmt, files, f, slug):
    F = FORMATS[fmt]
    W, H = F["W"], F["H"]
    paper = ad.get("paper", False)
    shots_html = []
    data_shots = []
    for i, s in enumerate(ad["shots"]):
        b = s.get("box", {}).get(fmt) if s.get("box") else None
        b = b or dict(x=0, y=0, w=W, h=H)
        nxt = ad["shots"][i + 1] if i + 1 < len(ad["shots"]) else None
        t1 = nxt["t0"] + nxt["d"] if nxt else SECONDS
        shots_html.append(f'<div class="shot{" round" if s.get("round") else ""}" id="shot{i}" '
                          f'style="left:{b["x"]}px;top:{b["y"]}px;width:{b["w"]}px;height:{b["h"]}px"><img src="{files[i]}" alt=""></div>')
        data_shots.append(dict(t0=s["t0"], t1=t1, d=s["d"], trans=s["trans"], kb=s["kb"]))
    items_html, data_items = [], []
    for i, it in enumerate(ad["items"]):
        items_html.append(item_html(i, it, fmt, paper))
        d = {k: it[k] for k in ("anim", "t0", "t1", "d", "stagger", "rot", "marks") if k in it}
        if it["anim"] == "count":
            d.update({"from": it["frm"], "to": it["to"]})
        data_items.append(d)
    lock = ad.get("lockup")
    lx, ly = ((lock[0]["x"], lock[0]["y"]) if fmt == "feed" else (lock[1]["x"], lock[1]["y"])) if lock else (70, 56 if fmt == "feed" else 286)
    lockup = build.standalone_lockup().replace("<svg ", f'<svg class="lockup" style="left:{lx}px;top:{ly}px" ', 1)
    eho_y = H - 62 if fmt == "feed" else 1622
    small = f"Equal Housing Opportunity · Rents as listed {listed(f['listed'])}"
    chrome = (f'<div id="chrome" class="{"on-paper-chrome" if paper else ""}">{lockup}'
              f'<p class="eho" style="left:{60 if paper else 70}px;top:{eho_y}px">{build.EHO}<span>{small}</span></p></div>')
    end_lab, end_big = ad["end"]
    url = build.SITE.replace("https://", "") + build.prop_url(PROPS[slug]).rstrip("/")
    endmark = build.standalone_logo("mark", kit.ON_LIGHT).replace("<svg ", '<svg id="endmark" ', 1)
    end = (f'<div id="end">{endmark}<p class="eitem e-lab">{build.esc(end_lab)}</p><p class="eitem e-big">{end_big}</p>'
           f'<div class="eitem e-rule"></div><p class="eitem e-phone">{build.esc(build.PHONE)}</p>'
           f'<p class="eitem e-url">{build.esc(url)}</p>'
           f'<p class="eitem e-small">{build.EHO}<span>{build.esc(small)}</span></p></div>')
    bg = f'<div class="bg {ad.get("bg", "ink")}"></div>'
    shade = f'<div class="shade {ad["shade"]}"></div>' if ad.get("shade") else ""
    data = dict(W=W, H=H, end=SECONDS, endAt=END_AT, shots=data_shots, items=data_items)
    css = (HERE / "series.css").read_text().replace("/*FONTS*/", kit.fonts()) + f":root{{--W:{W}px;--H:{H}px}}"
    js = (HERE / "series.js").read_text()
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>'
            f'<div id="stage">{bg}{"".join(shots_html)}{shade}{chrome}{"".join(items_html)}{end}</div>'
            f'<script>window.STORY={json.dumps(data)};</script><script>{js}</script></body></html>')


def prep(work, slug, s, fmt, i):
    F = FORMATS[fmt]
    b = (s.get("box") or {}).get(fmt) or dict(w=F["W"], h=F["H"])
    zoom = max(s["kb"][0], s["kb"][1]) * 1.06
    size = (round(b["w"] * zoom), round(b["h"] * zoom))
    im = ImageOps.exif_transpose(Image.open(ROOT / "source/photos" / slug / s["file"])).convert("RGB")
    im = kit.grade(ImageOps.fit(im, size, Image.LANCZOS, centering=s.get("focus") or (0.5, 0.5)))
    name = f"{fmt}-{i}-{Path(s['file']).stem}.jpg"
    im.save(work / name, quality=93, subsampling=0)
    return name


def cues(ad):
    out = []
    moving = {"wipeL", "wipeR", "wipeU", "wipeD", "iris", "diag", "slideL", "slideU", "zoom", "drop"}
    for s in ad["shots"]:
        if s["trans"] in moving and s["t0"] > 0.05:
            out.append((s["t0"] + s["d"] * 0.35, "whoosh"))
    for it in ad["items"]:
        if it["anim"] in ("pop", "stamp"):
            out.append((it["t0"] + 0.08, "pop"))
        elif it["anim"] == "tick":
            out.append((it["t0"] + 0.05, "pop"))
            out.append((it["t0"] + 0.32, "tick"))
        elif it["anim"] == "pin":
            out.append((it["t0"] + 0.45, "pop"))
        elif it["anim"] == "count":
            out.append((it["t0"] + it.get("d", 0.55) * 0.9, "tick"))
        elif it["anim"] in ("rise", "slide") and it["t0"] > 0.3:
            out.append((it["t0"] + 0.02, "tick"))
    return out


def ffmpeg():
    return shutil.which("ffmpeg") or sys.exit("needs ffmpeg")


def stills(jobs):
    """Each (html, png, t): the frame at t, as a picture."""
    script = r"""
const pw = require('playwright'); const path = require('path');
const jobs = JSON.parse(process.argv[1]);
(async () => { const b = await pw.chromium.launch();
  for (const j of jobs) { const p = await b.newPage({ viewport: { width: j.W, height: j.H } });
    await p.goto('file://' + path.resolve(j.html)); await p.evaluate(() => window.ready());
    await p.evaluate((t) => window.render(t), j.t); await p.screenshot({ path: j.png, type: 'jpeg', quality: 92 }); await p.close(); }
  await b.close(); })();"""
    subprocess.run(["node", "-e", script, json.dumps(jobs)], check=True)


GUIDE = """# {name}: a series of six video ads

Six 15-second ads, each in two shapes: `-feed.mp4` (4:5) for the Facebook and Instagram feeds and
`-story.mp4` (9:16) for Stories and Reels. Each has a still (`.jpg`) for its thumbnail. Rents as
listed {listed}: run `python3 tools/ads/series/series.py` again when the website's list changes, and
pause the series if the building fills up.

## Setting it up in Ads Manager

- **Special ad category: Housing.** Meta requires it for rentals: no targeting by age, gender or
  ZIP code, and a location radius of at least 15 miles (Rochester, NY). The words say what the
  homes are, never who they are for; keep any edits that way.
- **One campaign, one ad set, six ads**, so Meta can find which works best. Placements:
  Advantage+; give each ad its feed video and its story video ("Customise media per placement").
- **Button:** Learn more. **Link:** each ad's own, below: its `utm_campaign` shows each ad
  separately on the website dashboard's Campaigns panel.
- **Sound:** the soundtracks are made for these ads and owned by Evolution24, so nothing needs
  licensing, and Meta will not mute them for music rights.

"""


def main():
    skip = {ARGS[ARGS.index("--only") + 1]} if "--only" in ARGS and ARGS.index("--only") + 1 < len(ARGS) else set()
    pos = [a for a in ARGS if not a.startswith("--") and a not in skip]
    slug = next((a for a in pos if a in PROPS), "145-south-fitzhugh-street")
    rest = [a for a in pos if a not in PROPS]
    out = Path(rest[0]).resolve() if rest else ROOT / "tools/ads/out/series" / slug
    only = None
    if "--only" in ARGS:
        only = ARGS[ARGS.index("--only") + 1].split(",")
    work = out / "work"
    work.mkdir(parents=True, exist_ok=True)
    ads, f = series(slug)
    if only:
        ads = [a for a in ads if a["key"] in only]
    still_jobs, made = [], []
    for n, ad in enumerate(ads, 1):
        tag = f"{[a['key'] for a in series(slug)[0]].index(ad['key']) + 1:02d}-{ad['key']}"
        wav = work / f"{tag}.wav"
        music.make(wav, cues(ad), key=ad["key_"], prog=ad["prog"], drums=ad["drums"], end_at=END_AT, seconds=SECONDS,
                   seed=n)
        for fmt in FORMATS:
            files = [prep(work, slug, s, fmt, i) for i, s in enumerate(ad["shots"])]
            html = work / f"{tag}-{fmt}.html"
            html.write_text(page(ad, fmt, files, f, slug))
            still_jobs.append(dict(html=str(html), png=str(out / f"{tag}-{fmt}.jpg"), t=8.6, **FORMATS[fmt]))
            if "--stills-only" in ARGS:
                continue
            silent = work / f"{tag}-{fmt}.mp4"
            subprocess.run(["node", str(ROOT / "tools/instagram/story/frames.cjs"), str(html), str(silent), ffmpeg(), str(FPS)], check=True)
            final = out / f"{tag}-{fmt}.mp4"
            subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-i", str(silent), "-i", str(wav), "-map", "0:v", "-map", "1:a",
                            "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=9", "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
                            "-movflags", "+faststart", "-shortest", str(final)], check=True)
            print(final.name, f"{final.stat().st_size // 1024} KB", flush=True)
        made.append((tag, ad))
    stills(still_jobs)
    # overview: every ad's feed still, two rows of three
    thumbs = [Image.open(out / f"{tag}-feed.jpg") for tag, _ in made]
    if thumbs:
        tw, th = 360, 450
        sheet = Image.new("RGB", (tw * min(3, len(thumbs)) + 40 * (min(3, len(thumbs)) + 1), (th + 70) * ((len(thumbs) + 2) // 3) + 40), (21, 22, 19))
        d = ImageDraw.Draw(sheet)
        for k, (im, (tag, ad)) in enumerate(zip(thumbs, made)):
            x, y = 40 + (k % 3) * (tw + 40), 40 + (k // 3) * (th + 70)
            sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y))
            d.text((x, y + th + 12), f"{tag}  {ad['title']}", fill=(222, 187, 146))
        sheet.save(out / "overview.jpg", quality=90)
    # words to post
    p = PROPS[slug]
    lines = [GUIDE.format(name=p["name"], listed=listed(f["listed"]))]
    for tag, ad in made:
        link = f"{build.SITE}{build.prop_url(p)}?utm_source=facebook&utm_medium=paid_social&utm_campaign=series-{slug}-{ad['key']}"
        c = ad["copy"]
        lines.append(f"## {tag}: {ad['title']}\n\nFiles: `{tag}-feed.mp4`, `{tag}-story.mp4`\n\n"
                     f"- **Primary text:** {c['primary']}\n- **Headline:** {c['headline']}\n- **Description:** {c['description']}\n"
                     f"- **Button:** Learn more\n- **Link:** {link}\n")
    (out / "ads.md").write_text("\n".join(lines))
    if "--stills-only" not in ARGS:
        z = out / f"{slug}-ad-series.zip"
        with zipfile.ZipFile(z, "w", zipfile.ZIP_STORED) as zf:
            for fp in sorted(out.iterdir()):
                if fp.is_file() and fp.suffix in (".mp4", ".jpg", ".md"):
                    zf.write(fp, fp.name)
        print(z, f"{z.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
