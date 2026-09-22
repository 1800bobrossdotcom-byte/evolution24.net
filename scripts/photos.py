#!/usr/bin/env python3
"""Turn the originals in source/photos/ into responsive WebP files in assets/img/.

  python3 scripts/photos.py          # only builds what is missing
  python3 scripts/photos.py --force  # rebuilds everything

Originals are never touched. Each photo is rotated per its EXIF orientation,
stripped of all metadata (phone photos carry GPS), and written at up to three
widths. Nothing is upscaled: a 600px original yields a 480px and a 600px file,
not a blurry 1600px one. Dimensions go to data/photos.json so every <img> can
carry width and height and the page never jumps while loading.

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
WIDTHS = (480, 960, 1600, 2000)
MIN_WIDTH = 400
QUALITY = 74


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
                dst = OUT / slug / f"{slug}-{stem}-{tw}.webp"
                if dst.exists() and not force:
                    continue
                th = round(h * tw / w)
                im.resize((tw, th), Image.LANCZOS).save(dst, "WEBP", quality=QUALITY, method=6)
            data[slug].append(entry)
    (ROOT / "data" / "photos.json").write_text(json.dumps(data, indent=1) + "\n")
    total = sum(f.stat().st_size for f in OUT.rglob("*.webp"))
    print(f"{sum(len(v) for v in data.values())} photos, {total / 1e6:.1f} MB of WebP")


if __name__ == "__main__":
    main("--force" in sys.argv)
