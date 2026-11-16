#!/usr/bin/env python3
"""A full-size JPG of every photo on the site, for the photo viewer's Download button.

  python3 scripts/downloads.py          # only writes what is missing
  python3 scripts/downloads.py --force  # rewrites every JPG

The site shows AVIF and WebP, which are small and fast but which many people cannot open or
post elsewhere; this writes assets/img/<building>/<building>-<photo>.jpg beside them, one per
photo, at its largest web size (at most 2000px wide). A building's own photo is made from its
original in source/photos/; a unit photo from the leasing team's Drive (whose originals are not
kept in git) from its largest WebP. Like the other sizes, it carries no metadata: phone photos
carry GPS. scripts/photos.py and scripts/unit_photos.py run this when they finish.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "photos"
OUT = ROOT / "assets" / "img"
MAX_W = 2000
QUALITY = 85


def jpg_path(slug, pid):
    return OUT / slug / f"{slug}-{pid}.jpg"


def write(im, dest, width):
    im = im.convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=QUALITY, optimize=True, progressive=True)


def main(force=False):
    made = 0
    # A building's own photos, from their originals.
    manifest = json.loads((SRC / "manifest.json").read_text())
    photos = json.loads((ROOT / "data" / "photos.json").read_text())
    for slug, entries in photos.items():
        originals = {Path(p["file"]).stem: SRC / p["file"] for p in manifest.get(slug, [])}
        for e in entries:
            dest = jpg_path(slug, e["id"])
            if dest.exists() and not force:
                continue
            src = originals.get(e["id"])
            if src and src.exists():
                im = ImageOps.exif_transpose(Image.open(src))
            else:
                im = Image.open(OUT / slug / f"{slug}-{e['id']}-{e['widths'][-1]}.webp")
            write(im, dest, min(MAX_W, e["widths"][-1]))
            made += 1
    # Photos from the Drive, building and unit, from their largest WebP.
    unit = json.loads((ROOT / "data" / "unit-photos.json").read_text())
    for slug, b in unit.items():
        if slug.startswith("_"):
            continue
        entries = list(b["building"]) + [p for sets in b["units"].values() for s in sets for p in s["photos"]]
        for e in entries:
            dest = jpg_path(slug, e["id"])
            if dest.exists() and not force:
                continue
            write(Image.open(OUT / slug / f"{slug}-{e['id']}-{e['widths'][-1]}.webp"), dest, MAX_W)
            made += 1
    total = sum(f.stat().st_size for f in OUT.glob("*/*.jpg")) / 1e6
    print(f"{made} JPGs written; {total:.1f} MB of JPGs for download in all")


if __name__ == "__main__":
    main("--force" in sys.argv)
