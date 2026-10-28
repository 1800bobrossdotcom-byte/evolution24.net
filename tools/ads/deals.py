#!/usr/bin/env python3
"""Facebook and Instagram ads for a leasing special, from tools/ads/deals.json: half off the first
month at every building, and a home or two per building at a special rent. Same look, shapes and
videos as ads.py's Now renting ads, which it borrows.

    python3 tools/ads/deals.py [out-dir] [--only special-biltmore,half-off-water-street] [--no-video]

Default out-dir: tools/ads/out/deals. Writes, as ads.py does, a folder of four files per ad
(feed.jpg, story.jpg, feed.mp4, story.mp4), ads.md and ads.csv with each ad's words and how to run
the campaign, overview.jpg, and a zip:
  half-off-every-property/   half off at every building, for the whole area
  special-<slug>/            the building's special-rent home(s)
  half-off-<slug>/           half off at that building

The two deals are not combined: a half-off ad says it does not apply to the special-rent homes,
and a special-rent ad says it does not come with half off. Change deals.json for the next special;
nothing here names a date, a rent or a unit. Who to call comes from contacts.json, as for ads.py.
"""
import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    saved = sys.argv[:]
    sys.argv[1:] = []                    # ads.py reads its own options from argv
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv[:] = saved
    return module


ads = load("ads", HERE / "ads.py")
build, PROPS, ADS = ads.build, ads.PROPS, ads.ADS
ads.OUT, ads.ONLY, ads.VIDEO = ads.options(sys.argv[1:], out=HERE / "out" / "deals")
ads.WORK = ads.OUT / "work"

DEALS = json.loads((HERE / "deals.json").read_text())
UNTIL = dt.date.fromisoformat(DEALS["half_off"]["until"])
SPECIAL = DEALS["special"]
BY = f"{UNTIL:%B} {UNTIL.day}"                   # November 15
BY_SHORT = f"{UNTIL:%b} {UNTIL.day}"             # Nov 15
HALF_STAMP = ("½", "off", f"First month · Sign by {BY_SHORT}")
HALF_END = "Half off your<br><em>first month.</em>"
NOT_SPECIAL = " Not combined with special-rent homes."
EHO = "Equal Housing Opportunity · "

# The words take more room than a Now renting ad's, so the photo is shorter (left, top, right, bottom).
PANELS = {
    "half": {"feed": (0, 0, 1080, 770), "story": (0, 400, 1080, 1105)},
    "special1": {"feed": (0, 0, 1080, 730), "story": (0, 400, 1080, 1075)},
    "special2": {"feed": (0, 0, 1080, 650), "story": (0, 400, 1080, 995)},
}

# The every-building ad: one photo from each part of the area, and the line that goes with each.
EVERY = dict(photos=[("charlotte-square", "07-terrace.jpg", (0.5, 0.45)), ("121-park-drive", "01-exterior.jpg", (0.5, 0.42)),
                     ("379-south-main-street", "09-bedroom-green.jpg", (0.5, 0.45))],
             lines=[f"Leases signed by {BY}", "Rochester, Syracuse and Geneva", "Studios to 3 bedrooms"])


def bedrooms(slug):
    return PROPS[slug]["bedrooms"].replace("1 bedrooms", "1-bedrooms")   # the site's "Studios and 1 bedrooms"


def plain_city(slug):
    return "Rochester" if slug == "charlotte-square" else PROPS[slug]["city"]


def homes(slug):
    """The special-rent homes as (label, detail, rent): detail is the kind of home when the
    website lists it, and anything deals.json adds."""
    listed = {u["unit"]: u for u in PROPS[slug].get("units", [])}
    out = []
    for h in SPECIAL[slug]:
        u = listed.get(h["unit"])
        kind = ("Studio" if u["beds"] == 0 else f"{u['beds']}-bedroom") if u else None
        out.append((f"Unit {h['unit']}", " · ".join(x for x in (kind, h.get("detail")) if x), h["rent"]))
    return out


def half_off(slug, who):
    p = PROPS[slug]
    small = f"{EHO}Half off the first month’s rent on leases signed by {ads.listed(UNTIL.isoformat())}." + (NOT_SPECIAL if slug in SPECIAL else "")
    return dict(key=f"half-off-{slug}", who=who, url=ads.link_for(slug, "half-off"), panel=PANELS["half"],
                photos=[(slug, f, focus) for f, focus in ADS[slug]["photos"]],
                lines=[f"{bedrooms(slug)} · Sign by {BY}", *ADS[slug]["lines"]],
                kicker=f"Now renting · {ads.city(slug)}", name=p["name"], offer="Half off your first month",
                stamp=HALF_STAMP, small=small, end=(f"Leases signed by {BY}", HALF_END))


def special(slug, who):
    rows = homes(slug)
    one = len(rows) == 1
    return dict(key=f"special-{slug}", who=who, url=ads.link_for(slug, "special"), panel=PANELS[f"special{len(rows)}"],
                photos=[(slug, f, focus) for f, focus in ADS[slug]["photos"]],
                lines=["One home at a special rent" if one else f"{len(rows)} homes at special rents", *ADS[slug]["lines"]],
                kicker=f"Special rent · {ads.city(slug)}", name=PROPS[slug]["name"], units=rows,
                stamp=(SPECIAL[slug][0]["unit"], "unit", "Special rent") if one else (str(len(rows)), "homes", "Special rent"),
                small=f"{EHO}Special rent as of {ads.listed(DEALS['as_of'])}, while available. Not combined with half off the first month.",
                end=(f"Special rent · {rows[0][0]}" if one else f"Special rents · Units {' and '.join(r[0][5:] for r in rows)}",
                     "Let’s find<br>your <em>place.</em>"))


def every(who):
    return dict(key="half-off-every-property", who=who, photos=EVERY["photos"], lines=EVERY["lines"],
                url=f"{build.SITE}/properties/?utm_source=facebook&utm_medium=paid_social&utm_campaign=half-off",
                kicker="Limited time · Every Evolution24 property", name="Half off your first month",
                stamp=HALF_STAMP, small=f"{EHO}Half off the first month’s rent on leases signed by {ads.listed(UNTIL.isoformat())}.{NOT_SPECIAL}",
                end=("Every Evolution24 property", HALF_END))


# ---------------------------------------------------------------- words to post with them
def unit_words(label, detail, rent):
    return f"{label}{f' ({detail.lower()})' if detail else ''} at {build.money(rent)} a month"


def row(ad, title, headline, primary, description, alt):
    who = ad["who"]
    return dict(key=ad["key"], ad=title, headline=headline, primary=primary, description=description, button="Learn more",
                link=ad["url"], contact=f"{who['name']}, {who['phone']}, {who['email']}", alt=alt)


def call(who):
    return f"Call {who['short']} at {who['phone']} or email {who['email']} to book a tour."


def half_off_copy(ad, slug):
    p, who = PROPS[slug], ad["who"]
    terms = f"Offer for leases signed by {ads.listed(UNTIL.isoformat())}" + ("; not combined with special-rent homes." if slug in SPECIAL else ".")
    return row(ad, f"Half off: {p['name']}", f"Half off your first month at {p['name']}",
               f"Half off your first month at {p['name']}, {plain_city(slug)}: {ADS[slug]['pitch']}. Sign a lease by {BY} and "
               f"your first month’s rent is half off. {call(who)} {terms}",
               f"Sign by {BY_SHORT} · {bedrooms(slug)}",
               f"Ad for {p['name']} in {plain_city(slug)}: a photo from the building with a stamp reading half off, the words "
               f"Half off your first month, {ad['lines'][0]}, and Call {who['short']} {who['phone']}.")


def special_copy(ad, slug):
    p, who = PROPS[slug], ad["who"]
    rows = ad["units"]
    said = " and ".join(unit_words(*r) for r in rows)
    headline = (f"{rows[0][0]} at {p['name']}: {build.money(rows[0][2])} a month" if len(rows) == 1
                else f"{p['name']}: special rents from {build.money(min(r[2] for r in rows))}")
    return row(ad, f"Special rent: {p['name']}", headline,
               f"Special rent at {p['name']}, {plain_city(slug)}: {said}. Come see {ADS[slug]['pitch']}. {call(who)} "
               f"Special rent as of {ads.listed(DEALS['as_of'])}, while available; not combined with half off the first month.",
               "Special rent · while available",
               f"Ad for {p['name']} in {plain_city(slug)}: a photo from the building with a Special rent stamp, "
               f"{'; '.join(f'{r[0]}, {build.money(r[2])} a month' for r in rows)}, and Call {who['short']} {who['phone']}.")


def every_copy(ad):
    who = ad["who"]
    return row(ad, "Half off: every property", "Half off your first month",
               f"Half off your first month at every Evolution24 property, in Rochester, Syracuse and Geneva: studios to "
               f"three-bedroom apartments, from downtown lofts to restored Victorians. Sign a lease by {BY} and your first "
               f"month’s rent is half off. {call(who)} Offer for leases signed by {ads.listed(UNTIL.isoformat())}; not combined "
               f"with special-rent homes.",
               f"Every property · sign by {BY_SHORT}",
               f"Ad for Evolution24 Properties: a photo of Charlotte Square’s terrace with a stamp reading half off, the words "
               f"Half off your first month, leases signed by {BY}, and Call {who['short']} {who['phone']}.")


GUIDE = """# Facebook and Instagram ads: half off the first month, and special rents

Two deals, never combined:

- **Half off the first month’s rent** on leases signed by **{until}**, at every building.
  `half-off-every-property` covers them all; `half-off-<building>` is one building's.
- **Special rents**, as of {as_of}, while available: `special-<building>`. {specials}

Each is a picture and a 15-second video in two shapes: `feed` (4:5) for the Facebook and Instagram
feeds and `story` (9:16) for Stories and Reels. Charlotte Square's ads name {cs}; the rest name
{default}.

## Running them (Meta Ads Manager)

1. **Housing.** As with the Now renting ads: *Special Ad Categories → Housing*, no targeting by
   age, gender or ZIP code, and a radius of at least 15 miles.
2. **End date: {until}, 11:59 pm.** Set it on the campaign, so nothing still says half off after
   the deadline. Pause the Now renting ads meanwhile (their rents are as listed {listed}), and turn
   them back on after.
3. **One ad set per building**, with its half-off ad and its special-rent ad together, so Meta
   shows whichever does better. `half-off-every-property` gets its own ad set, aimed at Rochester,
   Syracuse and Geneva together.
4. **Links** carry their own campaign tags (`half-off-<building>`, `special-<building>`), so the
   website's dashboard (`/admin/` → Campaigns) shows what each ad brings.
{website}6. **Fair housing.** The words say what the homes and deals are, never who they are for; keep any
   edits that way. Every picture and video carries the Equal Housing Opportunity mark.

{skipped}The music is "Day Trips" by HoliznaCC0 (CC0 1.0): free to use in ads, no credit required.

"""


def main():
    who_all = ads.contacts()
    slugs = [s for s in ADS if PROPS[s].get("external") or PROPS[s]["units"]]
    missing = sorted(set(SPECIAL) - set(ADS))
    if missing:
        sys.exit(f"deals.json names {', '.join(missing)}, which have no photos or lines in ads.py's ADS")
    who = lambda s: who_all.get(s, who_all["default"])
    made = [(every(who_all["default"]), None, every_copy)]
    made += [(special(s, who(s)), s, special_copy) for s in ADS if s in SPECIAL]
    made += [(half_off(s, who(s)), s, half_off_copy) for s in slugs]
    keys = [ad["key"] for ad, _, _ in made]
    if ads.ONLY and set(ads.ONLY) - set(keys):
        sys.exit(f"No ad named {', '.join(sorted(set(ads.ONLY) - set(keys)))}. Ads: {', '.join(keys)}")
    ads.WORK.mkdir(parents=True, exist_ok=True)
    for ad, _, _ in made:
        if not ads.ONLY or ad["key"] in ads.ONLY:
            ads.make(ad)

    cs = who("charlotte-square")
    skipped = [p["name"] for p in build.PROPS if p["slug"] not in slugs and not p.get("external")]
    guide = GUIDE.format(
        until=ads.listed(UNTIL.isoformat()), as_of=ads.listed(DEALS["as_of"]), listed=ads.listed(build.UNITS_AS_OF), website="{website}",
        specials="; ".join(f"{PROPS[s]['name']}: " + ", ".join(f"{l} at {build.money(r)}" for l, _, r in homes(s)) for s in SPECIAL) + ".",
        cs=f"{cs['name']} ({cs['phone']}, {cs['email']})",
        default=f"{who_all['default']['name']} ({who_all['default']['phone']}, {who_all['default']['email']})",
        skipped=(f"No building ad for {' or '.join(skipped)}, with nothing listed open; the every-property ad covers them.\n\n"
                 if skipped else ""))
    # A special-rent home the website lists at another rent: someone who clicks through sees that one.
    stale = [f"{PROPS[s]['name']}’s unit {h['unit']} at {build.money(u['rent'])}" for s in SPECIAL for h in SPECIAL[s]
             for u in PROPS[s].get("units", []) if u["unit"] == h["unit"] and u["rent"] != h["rent"]]
    if stale:
        guide = guide.replace("{website}", f"""5. **The website** lists rents as of {ads.listed(build.UNITS_AS_OF)} (Rent Manager's sync keeps them current
   once it is switched on), so someone who clicks through may see a different rent from the ad's:
   {", ".join(stale)}. Answer with the special rent; the ads say "as of {ads.listed(DEALS['as_of'])}".
""")
    guide = guide.replace("{website}", "")
    rows = [copy(ad) if slug is None else copy(ad, slug) for ad, slug, copy in made]
    ads.package(guide, rows, "evolution24-half-off-ads.zip")


if __name__ == "__main__":
    main()
