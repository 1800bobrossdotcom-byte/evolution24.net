#!/usr/bin/env python3
"""Turn the originals in source/photos/ into responsive AVIF and WebP files in assets/img/.

  python3 scripts/photos.py          # only builds what is missing
  python3 scripts/photos.py --force  # rebuilds everything

Originals are never touched. Each photo is rotated per its EXIF orientation,
stripped of all metadata (phone photos carry GPS), and written at up to eight
widths, from 240px thumbnails to 2000px heroes, so a phone never downloads more
than it shows. 1200 and 1400 are there for phones: a full-width photo on a
390-440px screen at 3x needs 1170-1320 pixels, and would otherwise get the 1600. Each width is written twice: AVIF, about a quarter smaller, for every
current browser, and WebP for the rest. Nothing is upscaled: a 600px original
yields 240, 480 and 600px files, not a blurry 1600px one. Dimensions go to
data/photos.json so every <img> can carry width and height and the page never
jumps while loading.

Photos narrower than MIN_WIDTH are recorded as thumbnails and left out of
galleries. They are the only copy the old site served; the originals are needed.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "photos"
OUT = ROOT / "assets" / "img"
WIDTHS = (240, 480, 720, 960, 1200, 1400, 1600, 2000)
MIN_WIDTH = 400
QUALITY = 74          # WebP
AVIF_QUALITY = 50     # looks the same as WebP 74 at about three quarters of the bytes


def main(force=False):
    manifest = json.loads((SRC / "manifest.json").read_text())
    data = {}
    for slug, photos in manifest.items():
        data[slug] = []
        for p in photos:
            src = SRC / p["file"]
            stem = src.stem  # 03-kitchen
            im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
            w, h = im.size
            entry = {"id": stem, "alt": p["alt"], "w": w, "h": h, "thumb": w < MIN_WIDTH and h < MIN_WIDTH * 1.4}
            widths = sorted({min(x, w) for x in WIDTHS})
            entry["widths"] = widths
            (OUT / slug).mkdir(parents=True, exist_ok=True)
            for tw in widths:
                webp, avif = (OUT / slug / f"{slug}-{stem}-{tw}.{ext}" for ext in ("webp", "avif"))
                if webp.exists() and avif.exists() and not force:
                    continue
                small = im.resize((tw, round(h * tw / w)), Image.LANCZOS)
                small.save(webp, "WEBP", quality=QUALITY, method=6)
                small.save(avif, "AVIF", quality=AVIF_QUALITY, speed=6)
            data[slug].append(entry)
    (ROOT / "data" / "photos.json").write_text(json.dumps(data, indent=1) + "\n")
    size = lambda ext: sum(f.stat().st_size for f in OUT.rglob(f"*.{ext}")) / 1e6
    print(f"{sum(len(v) for v in data.values())} photos, {size('avif'):.1f} MB of AVIF, {size('webp'):.1f} MB of WebP")


if __name__ == "__main__":
    main("--force" in sys.argv)
