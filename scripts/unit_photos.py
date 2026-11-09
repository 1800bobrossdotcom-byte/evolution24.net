#!/usr/bin/env python3
"""Photos of each unit, from the leasing team's Google Drive folder, for the website.

  python3 scripts/unit_photos.py --fetch   # download the folder into source/drive/, then build
  python3 scripts/unit_photos.py           # build from what source/drive/ already has

The Drive folder (data/drive.json: "folder", shared as "Anyone with the link can view") is
the source: source/drive/ mirrors it and is not kept in git. Each photo is rotated per its
EXIF, stripped of all metadata (phone photos carry GPS), and written as AVIF and WebP at
WIDTHS into assets/img/<building>/, like the buildings' own photos (scripts/photos.py).
data/unit-photos.json then says which unit has which photos, for scripts/build.py.

How a folder is read (data/drive.json has the details):
  <Building>/<Unit> [notes]/photo.jpg    a unit of that building, e.g. "Water Street/402RV"
  <Unit> [notes]/photo.jpg               a unit of the "top_level" building (181 St. Paul)
  <Building> Exterior/photo.jpg          the building itself (any folder in "building")
A folder's first word is the unit ("2D move out" is 2D). "Furnished" or "Unfurnished" in
the rest of its name makes a separate set for that unit; other words there are the team's
own notes and are not shown. Folders in "skip" (the commercial space) are left out, and so
are videos. data/unit-photo-notes.json can give a photo its alt text, or leave it out
("skip": true, with "why"), by its path in the Drive folder; a key ending in / is a whole
folder; "_cover" names the photo each folder's set opens on.

Needs: pip install gdown pillow-heif (gdown for --fetch, pillow-heif for iPhone HEIC files).
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:          # HEIC photos are then skipped, and named
    pillow_heif = None

ROOT = Path(__file__).resolve().parent.parent
DRIVE = ROOT / "source" / "drive"
OUT = ROOT / "assets" / "img"
CONFIG = json.loads((ROOT / "data" / "drive.json").read_text())
NOTES_FILE = ROOT / "data" / "unit-photo-notes.json"
DATA_FILE = ROOT / "data" / "unit-photos.json"
WIDTHS = (480, 960, 1600)    # a thumbnail, a phone, a large screen: the lightbox is all they need
QUALITY = 74
AVIF_QUALITY = 50
PHOTO = re.compile(r"\.(jpe?g|png|heic|heif|webp)$", re.I)
SETS = {"furnished": "Furnished", "unfurnished": "Unfurnished"}


def fetch():
    """Mirror the Drive folder into source/drive/: what is new is downloaded, the rest kept."""
    import gdown   # noqa: PLC0415 - only needed here
    url = f"https://drive.google.com/drive/folders/{CONFIG['folder']}"
    listing = json.loads(subprocess.run([sys.executable, "-m", "gdown", "--json", "--no-cookies", url],
                                        check=True, capture_output=True, text=True).stdout)
    got = 0
    for item in listing:
        path = item["path"]
        if path.lower().endswith(".mp4") or path.split("/")[0] in CONFIG["skip"]:
            continue
        dest = DRIVE / path
        if dest.exists() and dest.stat().st_size:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        gdown.download(item["url"], str(dest), quiet=True)
        got += 1
    (DRIVE / "listing.json").write_text(json.dumps(listing, indent=1) + "\n")
    print(f"Drive: {len(listing)} files listed, {got} downloaded")


def building_of(name):
    """The building a folder name means, or None: its name, street or slug, case and dots aside."""
    plain = lambda s: re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
    n = plain(name)
    for alias, slug in CONFIG["buildings"].items():
        if n == plain(alias):
            return slug
    return None


def placed(rel):
    """(building, unit or None, set label or None) for a photo's path in the Drive folder."""
    parts = rel.split("/")
    folders = parts[:-1]
    if not folders or folders[0] in CONFIG["skip"]:
        return None
    if folders[0] in CONFIG.get("building", {}):
        return CONFIG["building"][folders[0]], None, None
    slug = building_of(folders[0])
    if slug:
        folders = folders[1:]
        if not folders:
            return slug, None, None
    else:
        slug = CONFIG["top_level"]
    words = folders[0].split()
    unit = words[0].upper()
    label = next((SETS[w.lower()] for w in words[1:] if w.lower() in SETS), None)
    return slug, unit, label


def photo_id(slug, unit, rel):
    tag = hashlib.sha1(rel.encode()).hexdigest()[:8]
    return f"u-{re.sub(r'[^a-z0-9]+', '', (unit or 'building').lower())}-{tag}"


NAMES = {p["slug"]: p["name"] for p in json.loads((ROOT / "data" / "properties.json").read_text())["properties"]}


def default_alt(rel, slug, unit, label, n, total):
    building = NAMES.get(slug, slug)
    room = Path(rel).stem
    room = "" if re.match(r"^(img|dsc|pxl|ptsc)[_-]?\d", room, re.I) else re.sub(r"\s*\d+$", "", room).strip().capitalize()
    where = f"unit {unit}" + (f" ({label.lower()})" if label else "") if unit else "the building"
    return f"{room}, {where}, {building}" if room else f"{building}, {where}: photo {n} of {total}"


def build():
    notes = json.loads(NOTES_FILE.read_text()) if NOTES_FILE.exists() else {}
    files = sorted(p for p in DRIVE.rglob("*") if p.is_file() and p.name != "listing.json")
    groups = {}
    skipped = []
    for f in files:
        rel = f.relative_to(DRIVE).as_posix()
        where = placed(rel)
        folder_off = any(k.endswith("/") and rel.startswith(k) and v.get("skip") for k, v in notes.items() if isinstance(v, dict))
        if not where or folder_off or (notes.get(rel) or {}).get("skip"):
            continue
        if not PHOTO.search(f.name):
            try:                              # a photo saved without its extension ("Kitchen")
                Image.open(f).verify()
            except Exception:                 # noqa: BLE001 - not a picture: name it and move on
                skipped.append(rel)
                continue
        groups.setdefault(where, []).append((rel, f))

    data = {}
    made = 0
    for (slug, unit, label), items in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1] or "", kv[0][2] or "")):
        (OUT / slug).mkdir(parents=True, exist_ok=True)
        entries = []
        for n, (rel, f) in enumerate(items, 1):
            try:
                im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
            except Exception as err:          # noqa: BLE001 - e.g. HEIC without pillow-heif
                skipped.append(f"{rel} ({str(err)[:60]})")
                continue
            w, h = im.size
            pid = photo_id(slug, unit, rel)
            widths = sorted({min(x, w) for x in WIDTHS})
            for tw in widths:
                webp, avif = (OUT / slug / f"{slug}-{pid}-{tw}.{ext}" for ext in ("webp", "avif"))
                if webp.exists() and avif.exists():
                    continue
                small = im.resize((tw, round(h * tw / w)), Image.LANCZOS)
                small.save(webp, "WEBP", quality=QUALITY, method=6)
                small.save(avif, "AVIF", quality=AVIF_QUALITY, speed=6)
                made += 1
            alt = (notes.get(rel) or {}).get("alt") or default_alt(rel, slug, unit, label, n, len(items))
            entries.append({"id": pid, "alt": alt, "w": widths[-1], "h": round(h * widths[-1] / w), "widths": widths,
                            "drive": rel})
        covers = {f"{folder}/{name}" for folder, name in (notes.get("_cover") or {}).items()}
        entries.sort(key=lambda e: e["drive"] not in covers)      # the cover first, the rest as they were
        b = data.setdefault(slug, {"building": [], "units": {}})
        if unit:
            b["units"].setdefault(unit, []).append({"set": label, "photos": entries})
        else:
            b["building"].extend(entries)

    about = ("GENERATED by scripts/unit_photos.py from the leasing team's Google Drive folder (data/drive.json): "
             "each building's own photos ('building') and each unit's sets of photos ('units'), as assets/img/ has them.")
    DATA_FILE.write_text(json.dumps({"_about": about, **data}, indent=1, ensure_ascii=False) + "\n")
    count = sum(len(s["photos"]) for b in data.values() for sets in b["units"].values() for s in sets) \
        + sum(len(b["building"]) for b in data.values())
    print(f"{count} photos for {sum(len(b['units']) for b in data.values())} units; {made} image files written")
    for s in skipped:
        print("left out:", s)


if __name__ == "__main__":
    if "--fetch" in sys.argv:
        fetch()
    build()
