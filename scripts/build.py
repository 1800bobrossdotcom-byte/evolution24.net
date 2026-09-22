#!/usr/bin/env python3
"""Build evolution24.net: every page, the crawl files and the security headers.

    python3 scripts/photos.py   # when photos change
    python3 scripts/build.py    # always; writes the site into the repo root

Facts live in data/properties.json; photo sizes and alt text in data/photos.json
(written by photos.py from source/photos/manifest.json). Edit those, or the
constants below, never the generated HTML.
"""
import datetime as dt
import base64
import hashlib
import html
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- constants
SITE = "https://evolution24.net"          # the old site's canonical host; keep it
NAME = "Evolution24 Properties"
PHONE = "585-245-3071"
PHONE_TEL = "+15852453071"
EMAIL = "tesacoleman9@gmail.com"          # the address the old site published
OFFICE = {"street": "176 N Water Street", "city": "Rochester", "region": "NY", "zip": "14604"}
PORTAL = "https://evolution.twa.rentmanager.com/"
APPLY_PROPERTY = "https://evolution.twa.rentmanager.com/ApplyNow?locations=&propertyID={}"
APPLY_UNIT = "https://evolution.twa.rentmanager.com/ApplyNow?locations=&unitID={}"
FOUNDED = 2024
BUILD_DATE = dt.date.today().isoformat()
PET_DEPOSIT, PET_FEE = 300, 45

DATA = json.loads((ROOT / "data" / "properties.json").read_text())
PHOTOS = json.loads((ROOT / "data" / "photos.json").read_text())
PROPS = DATA["properties"]
REGIONS = DATA["regions"]
UNITS_AS_OF = DATA["units_as_of"]
BY_SLUG = {p["slug"]: p for p in PROPS}

FAQS = [
    ("How do I report a maintenance issue?",
     f'If your issue is an emergency, contact your property manager right away. If it is not an emergency, submit a maintenance request through <a href="{PORTAL}" rel="noopener">Tenant Web Access</a>.',
     "If your issue is an emergency, contact your property manager right away. If it is not an emergency, submit a maintenance request through Tenant Web Access."),
    ("How do I pay rent?",
     f'Rent can be paid by check, by money order, or electronically through <a href="{PORTAL}" rel="noopener">Tenant Web Access</a>. We do not accept cash for rent payments.',
     "Rent can be paid by check, by money order, or electronically through Tenant Web Access. We do not accept cash for rent payments."),
    ("What is your pet policy?",
     f"We allow up to two pets per apartment, with a ${PET_DEPOSIT} non-refundable pet deposit and a ${PET_FEE} monthly fee for each pet.",
     f"We allow up to two pets per apartment, with a ${PET_DEPOSIT} non-refundable pet deposit and a ${PET_FEE} monthly fee for each pet."),
    ("Do you offer extra storage?",
     "Additional storage varies by property. If you are interested, ask the property manager during your application.",
     "Additional storage varies by property. If you are interested, ask the property manager during your application."),
    ("How do I apply?",
     f'Every property and every available apartment on this site has an Apply button that opens our secure application. You can also start from the <a href="/properties/">properties page</a> or call us on <a href="tel:{PHONE_TEL}">{PHONE}</a>.',
     f"Every property and every available apartment on this site has an Apply button that opens our secure application. You can also call us on {PHONE}."),
    ("Where are your properties?",
     "In and around three cities in upstate New York: Rochester, Syracuse (including Manlius) and Geneva in the Finger Lakes.",
     "In and around three cities in upstate New York: Rochester, Syracuse (including Manlius) and Geneva in the Finger Lakes."),
]

# ---------------------------------------------------------------- helpers
esc = lambda s: html.escape(str(s), quote=True)


def money(n):
    return f"${n:,.0f}"


def fmt_date(iso):
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%B %Y')}"


def photo(slug, pid):
    for p in PHOTOS[slug]:
        if p["id"] == pid:
            return p
    raise KeyError(f"{slug}/{pid}")


def gallery_photos(slug):
    return [p for p in PHOTOS[slug] if not p["thumb"]]


def src(slug, p, w):
    return f"/assets/img/{slug}/{slug}-{p['id']}-{w}.webp"


def srcset(slug, p):
    return ", ".join(f"{src(slug, p, w)} {w}w" for w in p["widths"])


def img(slug, pid, sizes="100vw", cls="", eager=False, alt=None, fit=960):
    p = photo(slug, pid) if isinstance(pid, str) else pid
    w = max([x for x in p["widths"] if x <= fit] or [p["widths"][0]])
    a = p["alt"] if alt is None else alt
    attrs = [f'src="{src(slug, p, w)}"', f'srcset="{srcset(slug, p)}"', f'sizes="{sizes}"',
             f'width="{p["w"]}"', f'height="{p["h"]}"', f'alt="{esc(a)}"']
    attrs.append('fetchpriority="high"' if eager else 'loading="lazy"')
    attrs.append('decoding="async"')
    if cls:
        attrs.append(f'class="{cls}"')
    return f"<img {' '.join(attrs)}>"


def beds_label(u):
    return "Studio" if u["beds"] == 0 else f"{u['beds']} bed"


def unit_type(u):
    parts = [beds_label(u)]
    if u.get("baths"):
        parts.append(f"{u['baths']} bath")
    return " · ".join(parts)


def unit_tag(u):
    return "studio" if u["beds"] == 0 else f"b{u['beds']}"


ALL_UNITS = sorted(((p, u) for p in PROPS for u in p["units"]), key=lambda x: x[1]["rent"])
RENT_FROM = min(u["rent"] for _, u in ALL_UNITS)


def prop_rent_from(p):
    if p["units"]:
        return min(u["rent"] for u in p["units"])
    if p.get("rent_range"):
        return p["rent_range"][0]
    return None


def prop_url(p):
    return f"/properties/{p['slug']}/"


def full_addr(p):
    return f"{p['street']}, {p['city']}, NY {p['zip']}"


def maps_q(p):
    return re.sub(r"\s+", "+", f"{p['street'].replace('–', '-')}, {p['city']}, NY {p['zip']}")


# ---------------------------------------------------------------- icons
def icon(name):
    paths = {
        "arrow": '<path d="M4 12h15M13 6l6 6-6 6"/>',
        "arrow-l": '<path d="M20 12H5M11 6l-6 6 6 6"/>',
        "close": '<path d="M6 6l12 12M18 6L6 18"/>',
        "phone": '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
        "key": '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
        "wrench": '<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L2 10l8-8z" transform="scale(.9) translate(1 1)"/>',
        "card": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
        "paw": '<circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M12 12c-3 0-5.5 4-5.5 6s2 2 5.5 1 5.5 1 5.5-1-2.5-6-5.5-6z"/>',
        "box": '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
        "mail": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
        "pin": '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
        "ext": '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
        "grid": '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    }
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>'


EHO = ('<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 3 2 13h3v15h22V13h3zM9 16h14v3H9zm0 6h14v3H9z" fill-rule="evenodd"/></svg>')

# ---------------------------------------------------------------- logo
# The logo is traced from the owner's PSD (source/logo/) — one path per bar and
# per letter, so each can be animated on its own. Coordinates are in a
# 1000 × 410 box, the PSD at one-sixth scale.
LOGO_SRC = json.loads((ROOT / "source" / "logo" / "logo_vec.json").read_text())


def _scale(d):
    return re.sub(r"-?\d+(?:\.\d+)?", lambda m: f"{float(m.group()) / 6:.1f}".rstrip("0").rstrip("."), d)


LOGO = {"icon": [], "word": []}
for layer, cls in (("Icon cream", "c"), ("Icon tan", "t")):
    for c in LOGO_SRC[layer]["comps"]:
        LOGO["icon"].append({"cls": cls, "d": _scale(c["d"]), "x": c["bbox"][0], "y": c["bbox"][1]})
for layer, cls in (("Wordmark tan", "t"), ("Wordmark 24 cream", "c")):
    for c in LOGO_SRC[layer]["comps"]:
        LOGO["word"].append({"cls": cls, "d": _scale(c["d"]), "x": c["bbox"][0]})
LOGO["icon"].sort(key=lambda c: (c["x"], -c["y"]))
LOGO["word"].sort(key=lambda c: c["x"])
for i, c in enumerate(LOGO["icon"]):
    c["id"] = f"lgi{i}"
for i, c in enumerate(LOGO["word"]):
    c["id"] = f"lgw{i}"
LINE1 = [c for c in LOGO["word"] if c["x"] < 3300]   # EVOLUTION24
LINE2 = [c for c in LOGO["word"] if c["x"] >= 3300]  # PROPERTIES


def logo_defs():
    paths = "".join(f'<path id="{c["id"]}" d="{c["d"]}"/>' for c in LOGO["icon"] + LOGO["word"])
    return f'<svg class="logo-defs" aria-hidden="true" focusable="false"><defs>{paths}</defs></svg>'


def _uses(items, cls, start=0):
    return "".join(f'<use href="#{c["id"]}" class="{cls} lg-{c["cls"]} d{start + i}"/>' for i, c in enumerate(items))


def logo_stacked(title=True):
    t = f"<title>{NAME}</title>" if title else ""
    return (f'<svg viewBox="0 0 1000 410" role="img" aria-label="{NAME}">{t}'
            f'{_uses(LOGO["icon"], "lg-piece")}{_uses(LOGO["word"], "lg-word")}</svg>')


def logo_lockup():
    # Mark on the left, the two words stacked to its right.
    k = 1.35
    top = (274 - (44 * 2 + 22) * k) / 2
    return ('<svg viewBox="0 0 1116 274" aria-hidden="true" focusable="false">'
            f'<g transform="translate(-318 -7)">{_uses(LOGO["icon"], "lg-piece")}</g>'
            f'<g transform="translate(420 {top:.1f}) scale({k}) translate(-6 -360)">{_uses(LINE1, "lg-word")}</g>'
            f'<g transform="translate(420 {top + 66 * k:.1f}) scale({k}) translate(-562 -360)">{_uses(LINE2, "lg-word", len(LINE1))}</g>'
            '</svg>')


def logo_mark(cls="cta-mark"):
    return (f'<svg class="{cls}" viewBox="318 7 364 276" aria-hidden="true" focusable="false">'
            + "".join('<use href="#%s" class="lg-%s"/>' % (c["id"], c["cls"]) for c in LOGO["icon"]) + '</svg>')


def standalone_logo(kind, colors=("#debb92", "#e5e6d3"), bg=None):
    """A self-contained SVG file (favicon, og image source, downloads)."""
    t, c = colors
    fill = {"t": t, "c": c}
    b = f'<rect x="-100" y="-100" width="1300" height="700" fill="{bg}"/>' if bg else ""
    if kind == "mark":
        body = "".join(f'<path fill="{fill[x["cls"]]}" d="{x["d"]}"/>' for x in LOGO["icon"])
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="310 0 380 290">{b}{body}</svg>'
    body = "".join(f'<path fill="{fill[x["cls"]]}" d="{x["d"]}"/>' for x in LOGO["icon"] + LOGO["word"])
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 410">{b}{body}</svg>'


# ---------------------------------------------------------------- page shell
HEAD_SCRIPT = ("document.documentElement.classList.add('js');"
               "try{if(!sessionStorage.getItem('e24-intro')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)"
               "{document.documentElement.classList.add('is-intro');sessionStorage.setItem('e24-intro','1')}}catch(e){}")
HEAD_HASH = "sha256-" + base64.b64encode(hashlib.sha256(HEAD_SCRIPT.encode()).digest()).decode()
CSP_BASE = ("default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self' mailto:; "
            f"script-src 'self' '{HEAD_HASH}'; style-src 'self'; img-src 'self' data:; font-src 'self'; "
            "connect-src 'self'; frame-src https://www.google.com https://maps.google.com; manifest-src 'self'; "
            "upgrade-insecure-requests")
CSP_HEADER = CSP_BASE + "; frame-ancestors 'none'"

NAV = [("Properties", "/properties/"), ("Available now", "/properties/#available"), ("About", "/about-us/"), ("FAQs", "/faqs/"), ("Contact", "/contact-us/")]


def asset_version(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()[:10]


def org_node():
    return {
        "@type": "RealEstateAgent",
        "@id": f"{SITE}/#organization",
        "name": NAME,
        "url": f"{SITE}/",
        "logo": f"{SITE}/assets/img/logo-512.png",
        "image": f"{SITE}/assets/img/og.png",
        "telephone": PHONE_TEL.replace("+1", "+1-").replace("5852453071", "585-245-3071"),
        "email": EMAIL,
        "foundingDate": str(FOUNDED),
        "description": "Family-owned property management company with apartments in Rochester, Syracuse, Manlius and Geneva, New York.",
        "address": {"@type": "PostalAddress", "streetAddress": OFFICE["street"], "addressLocality": OFFICE["city"],
                    "addressRegion": OFFICE["region"], "postalCode": OFFICE["zip"], "addressCountry": "US"},
        "areaServed": [{"@type": "City", "name": n} for n in ("Rochester", "Syracuse", "Manlius", "Geneva")],
        "sameAs": ["https://www.charlottesquareroc.com/"],
    }


def website_node():
    return {"@type": "WebSite", "@id": f"{SITE}/#website", "url": f"{SITE}/", "name": NAME,
            "publisher": {"@id": f"{SITE}/#organization"}, "inLanguage": "en-US"}


def crumbs_node(url, trail):
    items = [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + u} for i, (n, u) in enumerate(trail)]
    return {"@type": "BreadcrumbList", "@id": f"{SITE}{url}#breadcrumb", "itemListElement": items}


def page(*, url, title, desc, body, graph=(), crumbs=None, og_image=None, preload=None, page_type="WebPage", dark_header=True, extra_head=""):
    canonical = SITE + url
    og = og_image or f"{SITE}/assets/img/og.png"
    trail = crumbs or [("Home", "/")]
    nodes = [website_node(), org_node(),
             {"@type": page_type, "@id": canonical + "#webpage", "url": canonical, "name": title, "description": desc,
              "isPartOf": {"@id": f"{SITE}/#website"}, "about": {"@id": f"{SITE}/#organization"},
              "breadcrumb": {"@id": canonical + "#breadcrumb"}, "inLanguage": "en-US", "dateModified": BUILD_DATE},
             crumbs_node(url, trail), *graph]
    ld = json.dumps({"@context": "https://schema.org", "@graph": nodes}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    pre = ""
    if preload:
        slug, p = preload
        pre = (f'<link rel="preload" as="image" href="{src(slug, p, 960)}" imagesrcset="{srcset(slug, p)}" '
               f'imagesizes="100vw" fetchpriority="high">')
    css_v, js_v = asset_version("assets/css/main.css"), asset_version("assets/js/main.js")
    current = lambda u: ' aria-current="page"' if (u == url or (u != "/" and url.startswith(u) and "#" not in u)) else ""
    nav = "".join(f'<a href="{u}"{current(u)}>{n}</a>' for n, u in NAV)
    drawer = "".join(f'<a class="d-link i{i}" href="{u}">{n}</a>' for i, (n, u) in enumerate(NAV))
    return f"""<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>{HEAD_SCRIPT}</script>
<meta http-equiv="Content-Security-Policy" content="{CSP_BASE}">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{canonical}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#151613">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{NAME}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{og}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/assets/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/instrument-serif-latin.woff2" as="font" type="font/woff2" crossorigin>
{pre}<link rel="stylesheet" href="/assets/css/main.css?v={css_v}">
<script src="/assets/js/main.js?v={js_v}" defer></script>
{extra_head}<script type="application/ld+json">{ld}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{logo_defs()}
<div class="intro" aria-hidden="true">{logo_stacked(False)}<span class="intro-line"></span></div>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/" aria-label="{NAME}, home">{logo_lockup()}</a>
    <nav class="nav" aria-label="Main">{nav}</nav>
    <div class="header-cta">
      <a class="btn" href="{PORTAL}" rel="noopener">Residents</a>
      <button class="menu-btn" type="button" aria-label="Menu" aria-controls="drawer" aria-expanded="false"><span></span><span></span></button>
    </div>
  </div>
</header>
<div class="drawer" id="drawer">
  {drawer}
  <div class="d-foot">
    <a class="btn btn--solid" href="{PORTAL}" rel="noopener">Resident portal</a>
    <a href="tel:{PHONE_TEL}">{PHONE}</a>
    <span>{OFFICE['street']}, {OFFICE['city']}, NY {OFFICE['zip']}</span>
  </div>
</div>
<main id="main">
{body}
</main>
{footer()}
</body>
</html>
"""


def footer():
    by_region = ""
    for key, r in REGIONS.items():
        links = "".join(f'<li><a href="{prop_url(p)}">{esc(p["name"])}</a></li>' for p in PROPS if p["region"] == key)
        by_region += f'<div><h2>{esc(r["name"])}</h2><ul>{links}</ul></div>'
    return f"""<footer class="site-footer">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <a href="/" aria-label="{NAME}, home">{logo_stacked(False)}</a>
        <p>A family-owned property management company with apartments across Rochester, Syracuse and Geneva, New York.</p>
        <p><a href="tel:{PHONE_TEL}">{PHONE}</a><br><a href="mailto:{EMAIL}">{EMAIL}</a><br>{OFFICE['street']}, {OFFICE['city']}, NY {OFFICE['zip']}</p>
      </div>
      {by_region}
    </div>
    <div class="foot-legal">
      <span class="eho">{EHO} Equal Housing Opportunity</span>
      <span><a href="{PORTAL}" rel="noopener">Resident portal</a> · <a href="/faqs/">FAQs</a> · <a href="/privacy/">Privacy &amp; fair housing</a></span>
      <span>© {dt.date.today().year} {NAME}</span>
    </div>
  </div>
</footer>"""


def split_lines(text, i0=0):
    """'An evolution|in *home*.' → masked lines that rise in turn."""
    out = []
    for i, line in enumerate(text.split("|")):
        line = re.sub(r"\*(.+?)\*", r"<em>\1</em>", line)
        out.append(f'<span class="line"><span data-rise class="i{i0 + i}">{line}</span></span>')
    return "".join(out)


# ---------------------------------------------------------------- components
def card(p, i=0, sizes="(max-width: 760px) 100vw, (max-width: 1200px) 50vw, 33vw"):
    n = len(p["units"])
    tags = [p["region"]] + (["available"] if n else []) + sorted({unit_tag(u) for u in p["units"]})
    badge = (f'<span class="badge badge--live">{n} available</span>' if n
             else '<span class="badge">Visit site</span>' if p.get("external")
             else '<span class="badge">Join the waitlist</span>')
    rf = prop_rent_from(p)
    meta = []
    if p.get("bedrooms"):
        meta.append(esc(p["bedrooms"]))
    if rf:
        meta.append(f"From <b>{money(rf)}</b>")
    return f"""<a class="card i{i % 3}" href="{prop_url(p)}" data-tags="{' '.join(tags)}" data-reveal>
  <div class="card-media">{img(p['slug'], p['card'], sizes, alt='')}{badge}<span class="card-go">{icon('arrow')}</span></div>
  <div class="card-body">
    <span class="kicker">{esc(p['city'])}, NY</span>
    <h3>{esc(p['name'])}</h3>
    <p>{esc(p['street'])}</p>
    <div class="card-meta">{' · '.join(f'<span>{m}</span>' for m in meta)}</div>
  </div>
</a>"""


def units_table(rows, show_prop=True, group="units"):
    trs = []
    for p, u in rows:
        prop_cell = (f'<td class="u-prop"><a href="{prop_url(p)}">{esc(p["name"])}</a><small>{esc(p["city"])}</small></td>'
                     if show_prop else "")
        size = f'{u["sqft"]:,} sq ft' if u.get("sqft") else "—"
        note = f' · {esc(u["note"])}' if u.get("note") else ""
        trs.append(f"""<tr data-tags="{unit_tag(u)} {p['region']}">
  {prop_cell}<td data-k="Unit">{esc(u['unit'])}</td><td>{unit_type(u)}{note}</td><td data-k="">{size}</td>
  <td class="u-rent">{money(u['rent'])}<small>/mo</small></td>
  <td class="u-act"><a class="btn" href="{APPLY_UNIT.format(u['uid'])}" rel="noopener" aria-label="Apply for unit {esc(u['unit'])} at {esc(p['name'])}">Apply {icon('arrow')}</a></td>
</tr>""")
    head_prop = "<th>Property</th>" if show_prop else ""
    return f"""<table class="units" data-filter-items="{group}">
<caption>Availability and rents as listed on {fmt_date(UNITS_AS_OF)}. Applications confirm the current rent and move-in date.</caption>
<thead><tr>{head_prop}<th>Unit</th><th>Type</th><th>Size</th><th>Rent</th><th><span class="sr-only">Apply</span></th></tr></thead>
<tbody>{''.join(trs)}</tbody></table>
<p class="lead" data-filter-empty="{group}" hidden>Nothing of that size is open right now. <a href="/contact-us/">Tell us what you are looking for</a> and we will be in touch.</p>"""


def unit_filters(rows, group="units"):
    tags = {}
    for _, u in rows:
        tags[unit_tag(u)] = tags.get(unit_tag(u), 0) + 1
    order = ["studio", "b1", "b2", "b3"]
    names = {"studio": "Studios", "b1": "1 bed", "b2": "2 bed", "b3": "3 bed"}
    chips = [f'<button class="chip" type="button" data-value="all" aria-pressed="true">All <small>{len(rows)}</small></button>']
    chips += [f'<button class="chip" type="button" data-value="{t}" aria-pressed="false">{names[t]} <small>{tags[t]}</small></button>' for t in order if t in tags]
    return f'<div class="filters" data-filter-group="{group}" role="group" aria-label="Filter by size">{"".join(chips)}</div>'


def emph(t):
    return re.sub(r"[*](.+?)[*]", r"<em>\1</em>", t)


def building_index():
    """Every building as one balanced, clickable line under the home hero."""
    items = []
    for i, p in enumerate(PROPS):
        n = len(p["units"])
        status = f"{n} open" if n else ("Own site" if p.get("external") else "Waitlist")
        items.append(f'<li data-reveal class="i{i}"><a href="{prop_url(p)}" data-tip="{esc(p["city"])} · {status}">{esc(p["name"])}</a></li>')
    return "\n      ".join(items)


def cta_block(title="Find your *place*.", text=None):
    text = text or f"Call the office, send us a note, or start an application online. We are a small team and we answer."
    return f"""<section class="section cta ink">
  {logo_mark()}
  <div class="wrap cta-inner">
    <p class="label" data-reveal>Talk to us</p>
    <h2 data-reveal class="i1">{emph(title)}</h2>
    <p class="lead" data-reveal>{text}</p>
    <div class="cta-row" data-reveal>
      <a class="big" href="tel:{PHONE_TEL}">{PHONE}</a>
      <a class="btn btn--solid" href="/contact-us/">Send a message {icon('arrow')}</a>
      <a class="btn" href="/properties/#available">See what’s available</a>
    </div>
  </div>
</section>"""


def page_hero(label, h1, lead, trail):
    crumbs = "".join(f'<li><a href="{u}">{esc(n)}</a></li>' if i < len(trail) - 1 else f'<li aria-current="page">{esc(n)}</li>'
                     for i, (n, u) in enumerate(trail))
    return f"""<section class="page-hero on-ink">
  {logo_mark()}
  <div class="wrap">
    <ol class="crumbs">{crumbs}</ol>
    <p class="label">{label}</p>
    <h1>{split_lines(h1)}</h1>
    {f'<p class="lead">{lead}</p>' if lead else ''}
  </div>
</section>"""


# ---------------------------------------------------------------- pages
def home():
    n_units = len(ALL_UNITS)
    slides = [("561-south-main-street", "03-bedroom-tin-ceiling"), ("301-central-avenue", "11-bedroom-sunlit"),
              ("charlotte-square", "01-exterior-facade"), ("water-street", "07-lobby"), ("561-south-main-street", "02-studio-living")]
    slide_html, dots = "", ""
    for i, (s, pid) in enumerate(slides):
        p, prop = photo(s, pid), BY_SLUG[s]
        cap = esc(f'<a href="{prop_url(prop)}">{esc(prop["name"])}</a> · {esc(prop["city"])}')
        slide_html += (f'<div class="hero-slide{" is-active" if i == 0 else ""}" data-caption="{cap}">'
                       f'{img(s, p, "100vw", eager=i == 0, fit=2000)}</div>')
        dots += f'<button type="button" class="{"is-active" if i == 0 else ""}" aria-label="Show photo {i + 1}"></button>'
    first = BY_SLUG[slides[0][0]]

    regions = ""
    for ri, (key, r) in enumerate(REGIONS.items()):
        items = ""
        for p in [p for p in PROPS if p["region"] == key]:
            n = len(p["units"])
            av = (f'<span class="avail">{n} open</span>' if n else
                  '<span class="avail avail--none">Waitlist</span>' if not p.get("external") else
                  '<span class="avail avail--none">Own site</span>')
            items += (f'<li><a href="{prop_url(p)}">{img(p["slug"], p["card"], "72px", alt="", fit=480)}'
                      f'<span><strong>{esc(p["name"])}</strong><small>{esc(p["street"])}</small></span>{av}</a></li>')
        count = sum(1 for p in PROPS if p["region"] == key)
        regions += f"""<div class="region" data-reveal>
  <span class="region-num">0{ri + 1}</span>
  <div class="region-text"><h3>{esc(r['name'])}</h3><p>{esc(r['blurb'])}</p><p><a class="link" href="/properties/?region={key}">{count} {'property' if count == 1 else 'properties'} {icon('arrow')}</a></p></div>
  <ul class="region-list">{items}</ul>
</div>"""

    band_a = [("biltmore", "01-lobby"), ("379-south-main-street", "02-living-room"), ("121-park-drive", "01-exterior"),
              ("301-central-avenue", "04-kitchen"), ("561-south-main-street", "06-gas-range"), ("379-south-main-street", "09-bedroom-green"),
              ("145-south-fitzhugh-street", "15-studio-bedroom"), ("water-street", "03-loft-mezzanine")]
    band_b = [("121-park-drive", "02-porch-view"), ("301-central-avenue", "08-bedroom-brick"), ("biltmore", "03-entrance"),
              ("379-south-main-street", "01-aerial"), ("145-south-fitzhugh-street", "09-kitchen-red-fridge"), ("561-south-main-street", "01-exterior"),
              ("181-st-paul-street", "01-exterior"), ("301-central-avenue", "12-shower-marble")]
    band = lambda xs: "".join(img(s, pid, "(max-width: 700px) 60vw, 30vw", fit=960) for s, pid in xs)

    body = f"""<section class="hero on-ink" aria-label="Introduction">
  <div class="hero-media">{slide_html}</div>
  <div class="hero-dots">{dots}</div>
  <p class="hero-caption"><a href="{prop_url(first)}">{esc(first['name'])}</a> · {esc(first['city'])}</p>
  <div class="wrap hero-inner">
    <h1>{split_lines('An evolution|in *home*.')}</h1>
    <div class="hero-foot">
      <div>
        <p class="lead i2" data-rise>Apartments with character across Rochester, Syracuse and Geneva, New York, from a family-owned company that picks up the phone.</p>
        <div class="hero-actions"><a class="btn btn--solid" href="/properties/">Find a home {icon('arrow')}</a><a class="btn" href="/properties/#available">{n_units} available now</a></div>
      </div>
      <div class="hero-stats">
        <div class="stat"><b data-count="{len(PROPS)}">{len(PROPS)}</b><span>Properties</span></div>
        <div class="stat"><b data-count="3">3</b><span>Regions</span></div>
        <div class="stat"><b data-count="{n_units}">{n_units}</b><span>Available now</span></div>
        <div class="stat"><b data-count="{RENT_FROM}" data-pre="$">{money(RENT_FROM)}</b><span>Rents from</span></div>
      </div>
    </div>
  </div>
</section>
<nav class="index" aria-label="Our buildings">
  <div class="wrap">
    <p class="label" data-reveal>Our buildings</p>
    <div class="index-clip"><ul class="index-list" role="list">
      {building_index()}
    </ul></div>
  </div>
</nav>

<section class="section" id="regions">
  <div class="wrap">
    <div class="section-head">
      <div><p class="label" data-reveal>Where we are</p><h2 data-reveal class="i1">Three cities, <em>one family.</em></h2></div>
      <p class="lead i2" data-reveal>Downtown lofts and East End classics in Rochester, a restored Victorian outside Syracuse, and houses above Seneca Lake in Geneva. Every one managed by the people who own it.</p>
    </div>
    <div class="regions">{regions}</div>
  </div>
</section>

<section class="band ink" aria-label="Inside our homes">
  <div class="band-track band-track--a">{band(band_a)}</div>
  <div class="band-track band-track--b">{band(band_b)}</div>
</section>

<section class="section" id="available">
  <div class="wrap">
    <div class="section-head">
      <div><p class="label" data-reveal>Available now</p><h2 data-reveal class="i1">{n_units} homes, <em>ready.</em></h2></div>
      <p class="lead i2" data-reveal>Studios from {money(RENT_FROM)} to three bedrooms above Seneca Lake. Pick one and apply online in a few minutes.</p>
    </div>
    <div data-reveal>{unit_filters(ALL_UNITS)}{units_table(ALL_UNITS)}</div>
  </div>
</section>

<section class="section ink">
  <div class="wrap split">
    <div class="split-media">
      <div class="frame" data-reveal="clip">{img('biltmore', '01-lobby', '(max-width: 860px) 100vw, 45vw', fit=1600)}</div>
      <div class="frame frame--small i2" data-reveal="clip">{img('121-park-drive', '01-exterior', '(max-width: 860px) 46vw, 22vw', fit=960)}</div>
    </div>
    <div>
      <p class="label" data-reveal>About us</p>
      <h2 data-reveal class="i1">Small by design. <em>Hands-on</em> by nature.</h2>
      <p class="lead" data-reveal>Evolution24 Properties was founded in {FOUNDED} by a husband-and-wife duo with a passion for property management. What began as an Airbnb venture now spans apartment buildings and houses in Rochester, Syracuse and Geneva.</p>
      <p data-reveal>As a family-owned company we keep things approachable: real people, quick answers, and homes we would be happy to live in ourselves.</p>
      <ul class="facts" data-reveal>
        <li><b>{FOUNDED}</b><span>Founded</span></li>
        <li><b>Family</b><span>Owned and operated</span></li>
        <li><b>{len(PROPS)}</b><span>Properties</span></li>
        <li><b>3</b><span>Upstate regions</span></li>
      </ul>
      <a class="btn" href="/about-us/" data-reveal>Our story {icon('arrow')}</a>
    </div>
  </div>
</section>

<section class="section" id="residents">
  <div class="wrap">
    <div class="section-head">
      <div><p class="label" data-reveal>Residents</p><h2 data-reveal class="i1">Everything in <em>one portal.</em></h2></div>
      <p class="lead i2" data-reveal>Pay rent, request maintenance and keep track of your lease through Tenant Web Access, any time of day.</p>
    </div>
    <div class="tiles">
      <a class="tile" href="{PORTAL}" rel="noopener" data-reveal>{icon('card')}<h3>Pay rent</h3><p>Pay online in the portal, or by check or money order. We don’t accept cash.</p></a>
      <a class="tile i1" href="{PORTAL}" rel="noopener" data-reveal>{icon('wrench')}<h3>Maintenance</h3><p>Submit a work order online. For an emergency, call your property manager right away.</p></a>
      <a class="tile i2" href="/faqs/" data-reveal>{icon('paw')}<h3>Pets welcome</h3><p>Up to two per home: ${PET_DEPOSIT} non-refundable deposit and ${PET_FEE} a month per pet.</p></a>
      <a class="tile i3" href="/faqs/" data-reveal>{icon('box')}<h3>Storage</h3><p>Extra storage at some properties. Ask when you apply.</p></a>
    </div>
  </div>
</section>
{cta_block()}"""
    desc = (f"Family-owned apartments in Rochester, Syracuse, Manlius and Geneva, NY. Studios to 3 bedrooms, "
            f"{n_units} available now from {money(RENT_FROM)} a month.")
    faq_graph = []
    return page(url="/", title="Apartments in Rochester, Syracuse & Geneva, NY | Evolution24", desc=desc, body=body,
                preload=(slides[0][0], photo(*slides[0])), graph=faq_graph)


def properties_index():
    chips = [('all', 'All', len(PROPS))] + [(k, r["name"], sum(1 for p in PROPS if p["region"] == k)) for k, r in REGIONS.items()]
    chips.append(("available", "Available now", sum(1 for p in PROPS if p["units"])))
    chip_html = "".join(f'<button class="chip" type="button" data-value="{k}" aria-pressed="{str(k == "all").lower()}">{esc(n)} <small>{c}</small></button>' for k, n, c in chips)
    cards = "".join(card(p, i) for i, p in enumerate(PROPS))
    items = [{"@type": "ListItem", "position": i + 1, "url": SITE + prop_url(p), "name": p["name"]} for i, p in enumerate(PROPS)]
    body = f"""{page_hero('Properties', f'{len(PROPS)} places|to call *home*.', f'Every Evolution24 property in Rochester, Syracuse, Manlius and Geneva. {len(ALL_UNITS)} apartments are available now, from {money(RENT_FROM)} a month.', [('Home', '/'), ('Properties', '/properties/')])}
<section class="section section--tight">
  <div class="wrap">
    <div class="filters" data-filter-group="props" role="group" aria-label="Filter properties">{chip_html}</div>
    <div class="cards" data-filter-items="props">{cards}</div>
  </div>
</section>
<section class="section ink" id="available">
  <div class="wrap">
    <div class="section-head">
      <div><p class="label" data-reveal>Available now</p><h2 data-reveal class="i1">{len(ALL_UNITS)} homes, <em>ready.</em></h2></div>
      <p class="lead" data-reveal>Sorted by rent. Every Apply button opens our secure application for that exact apartment.</p>
    </div>
    <div data-reveal>{unit_filters(ALL_UNITS, 'all-units')}{units_table(ALL_UNITS, group='all-units')}</div>
  </div>
</section>
{cta_block('Not seeing *the one?*', 'New apartments open up all the time. Tell us what you need, where and when, and we will let you know first.')}"""
    graph = [{"@type": "ItemList", "@id": f"{SITE}/properties/#list", "name": "Evolution24 properties", "numberOfItems": len(PROPS), "itemListElement": items}]
    # Region pre-filter from the home page's links (?region=geneva) — handled without inline script.
    return page(url="/properties/", title=f"Apartments for Rent: All {len(PROPS)} Properties | Evolution24",
                desc=f"Browse {len(PROPS)} Evolution24 apartment properties in Rochester, Syracuse, Manlius and Geneva, NY. {len(ALL_UNITS)} units available now from {money(RENT_FROM)}/mo.",
                body=body, graph=graph, page_type="CollectionPage", crumbs=[("Home", "/"), ("Properties", "/properties/")])


def property_page(p):
    slug, url = p["slug"], prop_url(p)
    photos = gallery_photos(slug)
    cover = photo(slug, p["cover"])
    n = len(p["units"])
    rf = prop_rent_from(p)
    trail = [("Home", "/"), ("Properties", "/properties/"), (p["name"], url)]
    crumbs = "".join(f'<li><a href="{u}">{esc(nm)}</a></li>' if i < 2 else f'<li aria-current="page">{esc(nm)}</li>' for i, (nm, u) in enumerate(trail))
    pills = [f'<span>{esc(p["type"])}</span>', f'<span>{esc(p["area"])}</span>']
    if p.get("bedrooms"):
        pills.append(f'<span>{esc(p["bedrooms"])}</span>')
    if n:
        pills.insert(0, f'<span class="live">{n} available now</span>')
    if p.get("external"):
        actions = (f'<a class="btn btn--solid" href="{p["external"]}" rel="noopener">Visit {esc(p["name"])} {icon("ext")}</a>'
                   f'<a class="btn" href="tel:{re.sub(r"[^0-9]", "", p["leasing"]["phone"])}">Call leasing</a>')
    else:
        actions = (f'<a class="btn btn--solid" href="{APPLY_PROPERTY.format(p["pid"])}" rel="noopener">Apply now {icon("arrow")}</a>'
                   + (f'<a class="btn" href="#units">See {n} available</a>' if n else f'<a class="btn" href="/contact-us/?property={esc(slug)}">Join the waitlist</a>'))

    # Gallery: up to five in a mosaic whose layout depends on how many there are;
    # every photo is one click away in the lightbox.
    shown = photos[:5]
    layout = {1: ["g-f"], 2: ["g-a", "g-b"], 3: ["g-a", "g-b", "g-f"], 4: ["g-a", "g-b", "g-h", "g-h"]}.get(len(shown), ["g-a", "g-b", "g-c", "g-c", "g-c"])
    tiles = ""
    for i, ph in enumerate(shown):
        more = f'<span class="more">+{len(photos) - 5} more</span>' if i == 4 and len(photos) > 5 else ""
        sizes = "(max-width: 700px) 100vw, 58vw" if i < 2 or layout[i] == "g-f" else "(max-width: 700px) 50vw, 34vw"
        tiles += f'<button type="button" data-index="{i}" aria-label="Open photo {i + 1} of {len(photos)}: {esc(ph["alt"])}" data-reveal="clip" class="{layout[i]} i{i % 4}">{img(slug, ph, sizes, alt="", fit=1600 if i < 2 else 960)}{more}</button>'
    gdata = json.dumps([{"src": src(slug, ph, ph["widths"][-1]), "srcset": srcset(slug, ph), "alt": ph["alt"], "w": ph["w"], "h": ph["h"]} for ph in photos]).replace("</", "<\\/")

    facts = [("Address", esc(full_addr(p))), ("Type", esc(p["type"]))]
    if p.get("bedrooms"):
        facts.append(("Homes", esc(p["bedrooms"])))
    if p.get("rent_range"):
        facts.append(("Rent", f'{money(p["rent_range"][0])} – {money(p["rent_range"][1])} <small>(as of {fmt_date(p["rent_as_of"])})</small>'))
    elif rf:
        facts.append(("Rent", f"From {money(rf)} a month"))
    if p.get("leasing"):
        l = p["leasing"]
        facts.append(("Leasing", f'{esc(l["name"])}, <a href="tel:+1{re.sub(r"[^0-9]", "", l["phone"])}">{esc(l["phone"])}</a><br><small>{esc(l["hours"])}</small>'))
    else:
        facts.append(("Office", f'<a href="tel:{PHONE_TEL}">{PHONE}</a>'))
    dl = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in facts)
    amen = "".join(f"<li>{esc(a)}</li>" for a in p["amenities"])

    if n:
        units = f"""<section class="section ink" id="units">
  <div class="wrap">
    <div class="section-head">
      <div><p class="label" data-reveal>Available now</p><h2 data-reveal class="i1">{n} {'home' if n == 1 else 'homes'} at <em>{esc(p['name'])}.</em></h2></div>
      <p class="lead" data-reveal>Choose an apartment to start its application. Questions first? Call {PHONE}.</p>
    </div>
    <div data-reveal>{units_table([(p, u) for u in sorted(p['units'], key=lambda u: u['rent'])], show_prop=False, group='p-units')}</div>
  </div>
</section>"""
    elif p.get("external"):
        units = f"""<section class="section ink" id="units"><div class="wrap split">
  <div><p class="label" data-reveal>Leasing</p><h2 data-reveal class="i1">{esc(p['name'])} has its <em>own home</em> online.</h2>
  <p class="lead" data-reveal>Floor plans, amenities, the neighborhood and tour requests live on the building’s own site. Leasing is {esc(p['leasing']['name'])}, {esc(p['leasing']['phone'])}, {esc(p['leasing']['hours'])}.</p>
  <a class="btn btn--solid" data-reveal href="{p['external']}" rel="noopener">Go to charlottesquareroc.com {icon('ext')}</a></div>
  <div class="split-media"><div class="frame" data-reveal="clip">{img(slug, '07-terrace', '(max-width: 860px) 100vw, 45vw')}</div></div>
</div></section>"""
    else:
        units = f"""<section class="section ink" id="units"><div class="wrap">
  <p class="label" data-reveal>Availability</p><h2 data-reveal class="i1">Fully leased, <em>for now.</em></h2>
  <p class="lead" data-reveal>Nothing is open at {esc(p['name'])} today. Tell us what you are looking for and we will let you know as soon as something comes up.</p>
  <div class="hero-actions" data-reveal><a class="btn btn--solid" href="/contact-us/?property={esc(slug)}">Join the waitlist {icon('arrow')}</a><a class="btn" href="/properties/#available">See what’s available elsewhere</a></div>
</div></section>"""

    others = [o for o in PROPS if o["region"] == p["region"] and o is not p][:3]
    if len(others) < 3:
        others += [o for o in PROPS if o["region"] != p["region"] and o["units"]][: 3 - len(others)]
    embed = f"https://maps.google.com/maps?q={maps_q(p)}&output=embed&z=15"
    body = f"""<section class="p-hero on-ink">
  {img(slug, cover, '100vw', eager=True, alt='', fit=2000)}
  <div class="wrap">
    <ol class="crumbs">{crumbs}</ol>
    <p class="label">{esc(p['city'])}, New York</p>
    <h1>{split_lines(esc(p['name']))}</h1>
    <p class="addr">{esc(full_addr(p))}</p>
    <div class="p-hero-row"><div class="p-pills">{''.join(pills)}</div><div class="hero-actions">{actions}</div></div>
  </div>
</section>
<section class="section">
  <div class="wrap p-intro">
    <div>
      <p class="label" data-reveal>The building</p>
      <p class="desc" data-reveal>{esc(p['desc'])}</p>
    </div>
    <aside class="p-side" data-reveal>
      <dl class="dl">{dl}</dl>
      {f'<ul class="amen">{amen}</ul>' if amen else ''}
    </aside>
  </div>
</section>
<section class="section section--tight" aria-label="Photos">
  <div class="wrap">
    <div class="section-head"><div><p class="label" data-reveal>Photos</p><h2 data-reveal class="i1">A look <em>inside.</em></h2></div>
    {f'<p><button class="btn" type="button" data-open-gallery>{icon("grid")} All {len(photos)} photos</button></p>' if len(photos) > 1 else ''}</div>
    <div class="gallery" data-gallery>{tiles}</div>
  </div>
</section>
{units}
<section class="section section--tight">
  <div class="wrap">
    <p class="label" data-reveal>Location</p>
    <div class="map-slot on-ink" data-map="{esc(embed)}" data-title="Map of {esc(full_addr(p))}" data-reveal>
      <div class="map-grid"></div>
      <div class="map-pin">{icon('pin')}<p>{esc(full_addr(p))}</p>
        <div class="hero-actions"><button class="btn" type="button">Show the map</button><a class="btn" href="https://www.google.com/maps/dir/?api=1&amp;destination={maps_q(p)}" rel="noopener">Directions {icon('ext')}</a></div>
      </div>
    </div>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <div class="section-head"><div><p class="label" data-reveal>Keep looking</p><h2 data-reveal class="i1">More <em>nearby.</em></h2></div></div>
    <div class="cards">{''.join(card(o, i) for i, o in enumerate(others))}</div>
  </div>
</section>
{cta_block()}
<div class="lightbox" role="dialog" aria-modal="true" aria-label="Photos of {esc(p['name'])}" inert>
  <div class="lb-top"><span class="lb-count"></span><button class="lb-btn lb-close" type="button" aria-label="Close photos">{icon('close')}</button></div>
  <div class="lb-stage"><img alt=""><button class="lb-btn lb-prev" type="button" aria-label="Previous photo">{icon('arrow-l')}</button><button class="lb-btn lb-next" type="button" aria-label="Next photo">{icon('arrow')}</button></div>
  <p class="lb-cap"></p>
</div>
<script type="application/json" id="gallery-data">{gdata}</script>"""

    # Structured data: the building, its address, its photos, and what is open now.
    node = {
        "@type": "ApartmentComplex" if p["type"] in ("Apartment building", "Apartment community") else "Residence",
        "@id": SITE + url + "#property",
        "name": p["name"],
        "description": p["desc"],
        "url": p.get("external") or SITE + url,
        "address": {"@type": "PostalAddress", "streetAddress": p["street"], "addressLocality": p["city"], "addressRegion": "NY",
                    "postalCode": p["zip"], "addressCountry": "US"},
        "image": [SITE + src(slug, ph, ph["widths"][-1]) for ph in photos[:6]],
        "hasMap": f"https://www.google.com/maps/search/?api=1&query={maps_q(p)}",
        "amenityFeature": [{"@type": "LocationFeatureSpecification", "name": a, "value": True} for a in p["amenities"]],
        "containedInPlace": {"@type": "City", "name": f"{p['city']}, New York"},
        "provider": {"@id": f"{SITE}/#organization"},
    }
    if p["type"] == "Apartment community":
        node["numberOfAccommodationUnits"] = 72
        node["telephone"] = "+1-585-748-5588"
    if n:
        node["numberOfAvailableAccommodationUnits"] = n
        node["containsPlace"] = [{"@type": "Apartment", "name": f"{p['name']} unit {u['unit']}",
                                  "numberOfBedrooms": u["beds"], "numberOfRooms": max(1, u["beds"] + 1),
                                  **({"numberOfBathroomsTotal": u["baths"]} if u.get("baths") else {}),
                                  **({"floorSize": {"@type": "QuantitativeValue", "value": u["sqft"], "unitCode": "FTK"}} if u.get("sqft") else {})}
                                 for u in p["units"]]
    if rf:
        hi = p["rent_range"][1] if p.get("rent_range") else max(u["rent"] for u in p["units"])
        node["priceRange"] = f"{money(rf)}–{money(hi)} per month" if hi != rf else f"{money(rf)} per month"
    title_bits = f"{p['name']} Apartments, {p['city']} NY"
    title = f"{title_bits} | Evolution24" if len(title_bits) < 44 else title_bits
    what = p.get("bedrooms", "Apartments").replace("–", " to ")
    avail = f"{n} available from {money(rf)}/mo." if n else ("Rents from " + money(rf) + "/mo." if rf else "Join the waitlist.")
    desc = f"{what} at {p['street']}, {p['city']}, NY, managed by Evolution24. {avail}"
    if len(desc) < 120:
        desc += " Photos, amenities and online applications."
    return page(url=url, title=title, desc=desc[:158], body=body, graph=[node], crumbs=trail,
                og_image=SITE + src(slug, cover, 1600 if 1600 in cover["widths"] else cover["widths"][-1]),
                preload=(slug, cover))


def about():
    stops = "".join(f'<div class="stop"><h3>{esc(r["name"])}</h3><p>{esc(r["blurb"])}</p></div>' for r in REGIONS.values())
    body = f"""{page_hero('About us', 'An evolution|in *home*.', f'Founded in {FOUNDED} by a husband-and-wife duo with a passion for property management.', [('Home', '/'), ('About us', '/about-us/')])}
<section class="section">
  <div class="wrap split">
    <div>
      <p class="label" data-reveal>Our story</p>
      <h2 data-reveal class="i1">From one rental to <em>{len(PROPS)} properties.</em></h2>
      <p class="lead" data-reveal>Evolution24 Properties began as an Airbnb venture. It grew into a portfolio of apartment buildings and houses across the Syracuse, Rochester and Geneva areas.</p>
      <p data-reveal>As a family-owned organization we are committed to a hands-on, approachable management style, and to going above and beyond on communication and service for our residents. We renovate with care, keep what makes an old building special, and answer when you call.</p>
    </div>
    <div class="split-media">
      <div class="frame" data-reveal="clip">{img('379-south-main-street', '02-living-room', '(max-width: 860px) 100vw, 45vw')}</div>
      <div class="frame frame--small i2" data-reveal="clip">{img('water-street', '01-exterior', '(max-width: 860px) 46vw, 22vw')}</div>
    </div>
  </div>
</section>
<section class="section ink">
  <div class="wrap">
    <p class="label" data-reveal>Where we are</p>
    <h2 data-reveal class="i1">Rochester, Syracuse <em>and Geneva.</em></h2>
    <div class="route">{stops}</div>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <div class="section-head"><div><p class="label" data-reveal>How we work</p><h2 data-reveal class="i1">What you can <em>expect.</em></h2></div></div>
    <div class="tiles">
      <div class="tile" data-reveal>{icon('phone')}<h3>Real people</h3><p>You deal with the owners and a small team, not a call center.</p></div>
      <div class="tile i1" data-reveal>{icon('wrench')}<h3>Quick repairs</h3><p>Work orders go straight to us through the resident portal.</p></div>
      <div class="tile i2" data-reveal>{icon('key')}<h3>Cared-for homes</h3><p>Fully renovated apartments that keep their original character.</p></div>
      <div class="tile i3" data-reveal>{icon('paw')}<h3>Pet friendly</h3><p>Up to two pets per home, with a clear, simple pet policy.</p></div>
    </div>
  </div>
</section>
{cta_block()}"""
    return page(url="/about-us/", title="About Evolution24 Properties | Family-Owned, Upstate NY",
                desc=f"Evolution24 Properties is a family-owned property manager founded in {FOUNDED}, with apartments in Rochester, Syracuse, Manlius and Geneva, New York.",
                body=body, page_type="AboutPage", crumbs=[("Home", "/"), ("About us", "/about-us/")])


def faqs():
    items = "".join(f'<details data-reveal><summary>{esc(q)}<span class="pm" aria-hidden="true"></span></summary><div class="ans"><p>{a}</p></div></details>' for q, a, _ in FAQS)
    graph = [{"@type": "FAQPage", "@id": f"{SITE}/faqs/#faq", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": plain}} for q, _, plain in FAQS]}]
    body = f"""{page_hero('FAQs', 'Questions,|*answered.*', 'Rent, repairs, pets and storage. If yours is not here, call us.', [('Home', '/'), ('FAQs', '/faqs/')])}
<section class="section">
  <div class="wrap"><div class="faq">{items}</div></div>
</section>
<section class="section section--tight ink">
  <div class="wrap">
    <div class="tiles">
      <a class="tile" href="{PORTAL}" rel="noopener">{icon('key')}<h3>Resident portal</h3><p>Pay rent and submit work orders in Tenant Web Access.</p></a>
      <a class="tile" href="tel:{PHONE_TEL}">{icon('phone')}<h3>{PHONE}</h3><p>Call the office.</p></a>
      <a class="tile" href="mailto:{EMAIL}">{icon('mail')}<h3>Email</h3><p>{EMAIL}</p></a>
    </div>
  </div>
</section>"""
    return page(url="/faqs/", title="Resident FAQs: Rent, Repairs & Pets | Evolution24 Properties",
                desc=f"How to pay rent, report maintenance, our pet policy (up to two pets, ${PET_DEPOSIT} deposit, ${PET_FEE}/mo) and extra storage at Evolution24 Properties.",
                body=body, graph=graph, crumbs=[("Home", "/"), ("FAQs", "/faqs/")])


def contact():
    opts = "".join(f'<option value="{esc(p["slug"])}">{esc(p["name"])}, {esc(p["city"])}</option>' for p in PROPS)
    body = f"""{page_hero('Contact', 'Let’s find|your *place*.', 'Questions about an apartment, a tour, or your lease. Call, email, or send a note below.', [('Home', '/'), ('Contact', '/contact-us/')])}
<section class="section">
  <div class="wrap contact-grid">
    <form class="form" id="contact-form" data-to="{EMAIL}" action="mailto:{EMAIL}" method="post" enctype="text/plain" novalidate data-reveal>
      <div class="field"><label for="c-first">First name</label><input id="c-first" name="first" autocomplete="given-name" required></div>
      <div class="field"><label for="c-last">Last name</label><input id="c-last" name="last" autocomplete="family-name" required></div>
      <div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="c-phone">Phone</label><input id="c-phone" name="phone" type="tel" autocomplete="tel"></div>
      <div class="field field--full"><label for="c-property">Property</label><select id="c-property" name="property"><option value="">Any, or not sure yet</option>{opts}</select></div>
      <div class="field field--full"><label for="c-message">Message</label><textarea id="c-message" name="message" maxlength="1000" required></textarea><span class="count" aria-live="polite"></span></div>
      <p class="form-note">Sending opens your own email app with the message filled in. Nothing is stored on this website.</p>
      <div><button class="btn btn--solid" type="submit">Send message {icon('arrow')}</button></div>
      <p class="form-status" role="status"></p>
    </form>
    <div class="contact-cards" data-reveal>
      <div><h3>Call</h3><a class="big" href="tel:{PHONE_TEL}">{PHONE}</a></div>
      <div><h3>Email</h3><p><a href="mailto:{EMAIL}">{EMAIL}</a></p></div>
      <div><h3>Office</h3><p>{OFFICE['street']}<br>{OFFICE['city']}, NY {OFFICE['zip']}</p></div>
      <div><h3>Residents</h3><p>Pay rent and request maintenance in <a href="{PORTAL}" rel="noopener">Tenant Web Access</a>.</p></div>
      <div><h3>Charlotte Square</h3><p>Leasing: Vicki Barone, <a href="tel:+15857485588">(585) 748-5588</a></p></div>
    </div>
  </div>
</section>"""
    graph = [{"@type": "ContactPoint", "@id": f"{SITE}/contact-us/#contact", "telephone": "+1-585-245-3071", "email": EMAIL,
              "contactType": "customer service", "areaServed": "US-NY", "availableLanguage": "English"}]
    return page(url="/contact-us/", title="Contact Evolution24 Properties | 585-245-3071",
                desc=f"Contact Evolution24 Properties about an apartment in Rochester, Syracuse or Geneva, NY. Call {PHONE}, email us, or visit {OFFICE['street']}, Rochester.",
                body=body, graph=graph, page_type="ContactPage", crumbs=[("Home", "/"), ("Contact", "/contact-us/")])


def privacy():
    body = f"""{page_hero('Privacy &amp; fair housing', 'Plain *terms.*', '', [('Home', '/'), ('Privacy', '/privacy/')])}
<section class="section"><div class="wrap prose">
<h2>Fair housing</h2>
<p>{NAME} is an Equal Housing Opportunity provider. We do not discriminate on the basis of race, color, religion, sex, disability, familial status or national origin, nor on any basis protected by New York State law, including age, sexual orientation, gender identity or expression, marital status, military status, and lawful source of income.</p>
<h2>What this website collects</h2>
<p>Nothing. This site sets no cookies, runs no analytics and loads nothing from third parties. The contact form does not send anything to us or store anything: it opens your own email app with your message filled in, and you choose whether to send it.</p>
<p>Maps are only loaded from Google when you press “Show the map”, and are then subject to Google’s privacy policy. Applications and resident accounts are handled by our property management software, Rent Manager, in Tenant Web Access.</p>
<h2>Accessibility</h2>
<p>We want this site to work for everyone, including with a screen reader, a keyboard alone or reduced motion. If something is hard to use, call <a href="tel:{PHONE_TEL}">{PHONE}</a> or email <a href="mailto:{EMAIL}">{EMAIL}</a> and we will help and fix it.</p>
<h2>Contact</h2>
<p>{NAME}, {OFFICE['street']}, {OFFICE['city']}, NY {OFFICE['zip']}.</p>
</div></section>"""
    return page(url="/privacy/", title="Privacy, Accessibility & Fair Housing | Evolution24 Properties",
                desc="Evolution24 Properties is an Equal Housing Opportunity provider. This site sets no cookies and runs no analytics. Our privacy and accessibility statement.",
                body=body, crumbs=[("Home", "/"), ("Privacy", "/privacy/")])


def not_found():
    body = f"""<section class="nf ink"><div>
  <p class="label">404</p>
  <h1>{split_lines('This door is *locked.*')}</h1>
  <p class="lead">The page you wanted has moved or never existed. Try one of these instead.</p>
  <div class="hero-actions"><a class="btn btn--solid" href="/properties/">All properties {icon('arrow')}</a><a class="btn" href="/">Home</a></div>
</div></section>"""
    out = page(url="/404.html", title="Page not found | Evolution24 Properties", desc="This page could not be found.", body=body)
    return out.replace('<meta name="robots" content="index, follow, max-image-preview:large">', '<meta name="robots" content="noindex">')


# ---------------------------------------------------------------- legacy URLs
# WordPress served each building at /property-detail/?pid=N and each unit at
# /unit-detail/?uid=N. Hosts cannot redirect on a query string portably, so
# these stubs do it in a tiny script (assets/js/legacy.js); _redirects adds real
# 301s for the path-only URLs.
LEGACY_PIDS = {str(p["pid"]): prop_url(p) for p in PROPS}
LEGACY_UIDS = {str(u["uid"]): prop_url(p) + "#units" for p in PROPS for u in p["units"]}
REDIRECTS = [("/careers/", "/about-us/"), ("/home/", "/"), ("/feed/", "/"), ("/comments/feed/", "/")]


def legacy_stub(kind):
    table = LEGACY_PIDS if kind == "pid" else LEGACY_UIDS
    return f"""<!doctype html>
<html lang="en-US"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{CSP_BASE}">
<title>Moved | {NAME}</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="{SITE}/properties/">
<script src="/assets/js/legacy.js?v={asset_version('assets/js/legacy.js')}" defer data-param="{kind}" data-map='{json.dumps(table)}'></script>
<meta http-equiv="refresh" content="3; url=/properties/">
</head><body><p>This page has moved. <a href="/properties/">See all properties</a>.</p></body></html>
"""


def redirect_stub(to):
    return f"""<!doctype html>
<html lang="en-US"><head><meta charset="utf-8"><title>Moved | {NAME}</title>
<meta name="robots" content="noindex, follow"><link rel="canonical" href="{SITE}{to}">
<meta http-equiv="refresh" content="0; url={to}"></head>
<body><p>This page has moved to <a href="{to}">{SITE}{to}</a>.</p></body></html>
"""


# ---------------------------------------------------------------- crawl files
def sitemap(urls):
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">']
    for u, imgs in urls:
        out.append(f"  <url><loc>{SITE}{u}</loc><lastmod>{BUILD_DATE}</lastmod>")
        for loc, cap in imgs:
            out.append(f"    <image:image><image:loc>{SITE}{loc}</image:loc><image:caption>{html.escape(cap, quote=False)}</image:caption></image:image>")
        out.append("  </url>")
    out.append("</urlset>")
    return "\n".join(out) + "\n"


def llms():
    lines = [f"# {NAME}", "",
             f"> Family-owned property management company, founded {FOUNDED}, with apartments in Rochester, Syracuse, Manlius and Geneva, New York.", "",
             "## Contact",
             f"- Office: {OFFICE['street']}, {OFFICE['city']}, NY {OFFICE['zip']}",
             f"- Phone: {PHONE}",
             f"- Email: {EMAIL}",
             f"- Residents pay rent and request maintenance at {PORTAL}",
             f"- Pets: up to two per apartment; ${PET_DEPOSIT} non-refundable deposit and ${PET_FEE} a month per pet.",
             "- Rent is paid by check, money order or online. Cash is not accepted.", "",
             f"## Properties ({len(PROPS)})"]
    for p in PROPS:
        n = len(p["units"])
        bit = f"{n} available, from {money(prop_rent_from(p))}/mo" if n else ("see " + p["external"] if p.get("external") else "fully leased")
        lines.append(f"- [{p['name']}]({SITE}{prop_url(p)}): {full_addr(p)}. {p.get('bedrooms', p['type'])}. {bit}.")
    lines += ["", f"## Available apartments (as of {fmt_date(UNITS_AS_OF)})"]
    for p, u in ALL_UNITS:
        size = f", {u['sqft']} sq ft" if u.get("sqft") else ""
        lines.append(f"- {p['name']}, {p['city']}: unit {u['unit']}, {unit_type(u)}{size}, {money(u['rent'])}/mo. Apply: {APPLY_UNIT.format(u['uid'])}")
    lines += ["", "## Notes", "- Availability changes daily; the application confirms the current rent and move-in date.",
              "- Charlotte Square (50 Charlotte Street) has its own site at https://www.charlottesquareroc.com/ with leasing by Vicki Barone, (585) 748-5588."]
    return "\n".join(lines) + "\n"


# One list of headers and one of cache rules, written out in each host's dialect
# (_headers for Cloudflare Pages / Netlify, vercel.json for Vercel) so they cannot drift.
SECURITY_HEADERS = [
    ("Content-Security-Policy", CSP_HEADER),
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Permissions-Policy", "accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), "
                           "gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"),
]
YEAR = "public, max-age=31536000, immutable"   # CSS/JS carry ?v=<content hash>, so a change is a new URL
CACHE_RULES = [("/assets/css/", YEAR), ("/assets/js/", YEAR), ("/assets/fonts/", YEAR), ("/assets/img/", "public, max-age=2592000")]
VERCEL_HOST = "evolution24-net.vercel.app"     # Vercel's own alias for the production deployment


def headers():
    out = ["# Cloudflare Pages / Netlify. Generated by scripts/build.py — edit the generator.", "/*"]
    out += [f"  {k}: {v}" for k, v in SECURITY_HEADERS]
    out.append("  Strict-Transport-Security: max-age=31536000; includeSubDomains")
    for prefix, value in CACHE_RULES:
        out += ["", f"{prefix}*", f"  Cache-Control: {value}"]
    return "\n".join(out) + "\n"


def vercel_json():
    """Vercel ignores _headers and _redirects; this is the same policy in its dialect.
    Vercel sets Strict-Transport-Security itself, so it is not repeated here."""
    redirects = [{"source": "/(.*)", "has": [{"type": "host", "value": "www.evolution24.net"}],
                  "destination": "https://evolution24.net/$1", "permanent": True}]
    for a, b in REDIRECTS:
        redirects += [{"source": a.rstrip("/"), "destination": b, "permanent": True},
                      {"source": a, "destination": b, "permanent": True}]
    redirects += [{"source": "/wp-admin/(.*)", "destination": "/", "permanent": True},
                  {"source": "/wp-login.php", "destination": "/", "permanent": True}]
    headers = [{"source": "/(.*)", "headers": [{"key": k, "value": v} for k, v in SECURITY_HEADERS]}]
    headers += [{"source": f"{prefix}(.*)", "headers": [{"key": "Cache-Control", "value": value}]} for prefix, value in CACHE_RULES]
    # The vercel.app alias duplicates the real domain; keep it out of search results.
    headers.append({"source": "/(.*)", "has": [{"type": "host", "value": VERCEL_HOST}],
                    "headers": [{"key": "X-Robots-Tag", "value": "noindex"}]})
    return json.dumps({"$schema": "https://openapi.vercel.sh/vercel.json", "trailingSlash": True,
                       "redirects": redirects, "headers": headers}, indent=1) + "\n"


def redirects_file():
    lines = ["# Cloudflare Pages / Netlify. Generated by scripts/build.py — edit REDIRECTS there.",
             "# www → apex (the old site's canonical host)",
             "https://www.evolution24.net/* https://evolution24.net/:splat 301!"]
    lines += [f"{a} {b} 301" for a, b in REDIRECTS]
    lines += [f"{a.rstrip('/')} {b} 301" for a, b in REDIRECTS]
    lines += ["/about-us /about-us/ 301", "/contact-us /contact-us/ 301", "/faqs /faqs/ 301", "/properties /properties/ 301",
              "/wp-admin/* / 301", "/wp-login.php / 301"]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- write
def write(rel, text):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def css_utilities():
    """--d and --i per element, as classes, because the CSP forbids style="" attributes."""
    css = ["/* GENERATED by scripts/build.py: stagger utilities (the CSP forbids inline style attributes). */"]
    css += [f".d{i}{{--d:{i}}}" for i in range(40)]
    css += [f".i{i}{{--i:{i}}}" for i in range(12)]
    return "\n".join(css) + "\n"


def main():
    # stagger utilities live in their own block at the end of main.css
    main_css = ROOT / "assets/css/main.css"
    text = main_css.read_text().split("/* GENERATED by scripts/build.py")[0].rstrip() + "\n\n" + css_utilities()
    main_css.write_text(text)

    write("index.html", home())
    write("properties/index.html", properties_index())
    for p in PROPS:
        write(f"properties/{p['slug']}/index.html", property_page(p))
    write("about-us/index.html", about())
    write("faqs/index.html", faqs())
    write("contact-us/index.html", contact())
    write("privacy/index.html", privacy())
    write("404.html", not_found())
    write("property-detail/index.html", legacy_stub("pid"))
    write("unit-detail/index.html", legacy_stub("uid"))
    for a, b in REDIRECTS:
        if a.endswith("/") and "feed" not in a and a != "/home/":
            write(a.strip("/") + "/index.html", redirect_stub(b))

    # crawl surface
    urls = [("/", [(src(s, photo(s, i), 1600 if 1600 in photo(s, i)["widths"] else photo(s, i)["widths"][-1]), photo(s, i)["alt"])
                   for s, i in (("561-south-main-street", "03-bedroom-tin-ceiling"), ("biltmore", "01-lobby"))]),
            ("/properties/", [])]
    for p in PROPS:
        urls.append((prop_url(p), [(src(p["slug"], ph, ph["widths"][-1]), ph["alt"]) for ph in gallery_photos(p["slug"])]))
    urls += [("/about-us/", []), ("/faqs/", []), ("/contact-us/", []), ("/privacy/", [])]
    write("sitemap.xml", sitemap(urls))
    write("robots.txt", f"User-agent: *\nAllow: /\nDisallow: /property-detail/\nDisallow: /unit-detail/\n\n"
                        "# Assistants that answer 'apartments near me' are a referral channel.\n"
                        "User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\n"
                        "User-agent: Google-Extended\nAllow: /\n\n"
                        f"Sitemap: {SITE}/sitemap.xml\n")
    write("llms.txt", llms())
    write("_headers", headers())
    write("_redirects", redirects_file())
    write("vercel.json", vercel_json())
    write("site.webmanifest", json.dumps({"name": NAME, "short_name": "Evolution24", "start_url": "/", "display": "standalone",
                                         "background_color": "#151613", "theme_color": "#151613",
                                         "icons": [{"src": "/assets/img/logo-192.png", "sizes": "192x192", "type": "image/png"},
                                                   {"src": "/assets/img/logo-512.png", "sizes": "512x512", "type": "image/png"}]}, indent=1) + "\n")
    expires = (dt.date.today() + dt.timedelta(days=365)).isoformat()
    write(".well-known/security.txt", f"Contact: {SITE}/contact-us/\nExpires: {expires}T00:00:00.000Z\nPreferred-Languages: en\nCanonical: {SITE}/.well-known/security.txt\n")
    write(".nojekyll", "")

    # logo files
    write("favicon.svg", standalone_logo("mark", bg=None).replace('viewBox="310 0 380 290"', 'viewBox="300 -40 400 370"'))
    write("assets/img/logo.svg", standalone_logo("full"))
    write("assets/img/logo-on-light.svg", standalone_logo("full", colors=("#b88d5a", "#151613")))
    write("assets/img/mark.svg", standalone_logo("mark"))
    print(f"built {len(PROPS) + 7} pages, {len(ALL_UNITS)} units, sitemap with {sum(len(i) for _, i in urls)} images")


if __name__ == "__main__":
    main()
