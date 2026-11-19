#!/usr/bin/env python3
"""Letterhead templates for Google Docs: one per person, as Word files Google Docs opens natively.

    python3 tools/letterhead/letterhead.py [out-dir]

Default out-dir: tools/letterhead/out. Writes, for each person in PEOPLE:
  <file>.docx   US Letter: a header with the logo and the person's name, email and phone over a tan
                rule; a letter to fill in ([Date], [Recipient]...); a footer with the office's
                address, phone and website, and the Equal Housing Opportunity mark.
  <file>.pdf    the same, to check how it looks.
In Google Drive: New > File upload, then Open with Google Docs (or, with "Convert uploads"
on in Drive's settings, it converts by itself). Then File > Make a copy for each letter, or
keep it as a template. Fonts: Lato for the letter and Cormorant Garamond for the names, both in
Google Docs' own font list, so Docs shows them as designed; the logos are pictures, so they look
the same anywhere.

Needs python-docx, Playwright (to draw the logos) and LibreOffice (only for the PDF previews).
"""
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "out"


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


build = load("build", ROOT / "scripts/build.py")
INK, MUTED, TAN, ACCENT = "151613", "5C5D55", "DEBB92", "8A6232"
ON_LIGHT = ("#b88d5a", "#151613")          # the logo on a light page: tan bars, ink words
OFFICE = build.OFFICE
EVO = dict(
    logo="evolution24",
    footer=f"{build.NAME} · {OFFICE['street']}, {OFFICE['city']}, {OFFICE['region']} {OFFICE['zip']} · {build.PHONE} · evolution24.net",
    sub=None)
CS = PROPS = {p["slug"]: p for p in build.PROPS}["charlotte-square"]
CHARLOTTE = dict(
    logo="charlotte-square",
    footer=f"Charlotte Square · {CS['street']}, {CS['city']}, NY {CS['zip']} · charlottesquareroc.com",
    sub=f"Managed by {build.NAME} · {OFFICE['street']}, {OFFICE['city']}, NY {OFFICE['zip']}")

# Each letterhead: who signs it, and whose header. "lines" are the contact lines under the name.
PEOPLE = [
    dict(file="Evolution24 Letterhead - Vicki", name="Vicki", lines=["vicki@evolution24.net", f"Office {build.PHONE}"], **EVO),
    dict(file="Evolution24 Letterhead - Tesa", name="Tesa", lines=["tesa@evolution24.net", f"Office {build.PHONE}"], **EVO),
    dict(file="Charlotte Square Letterhead - Tatum", name="Tatum Hartmann",
         lines=["tatum@evolution24.net", "585-748-5588"], **CHARLOTTE),
]


# ---------------------------------------------------------------- the pictures
SERIF, SANS = "Cormorant Garamond", "Lato"
GOOGLE_FONTS = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Lato:wght@400;700"


def fonts_css():
    """The two fonts, from Google Fonts, for drawing the Charlotte Square wordmark."""
    return f"@import url('{GOOGLE_FONTS}');"


def pictures(work):
    """The logos and the EHO mark as PNGs at 600 dpi for their printed size, on white."""
    lockup = build.standalone_lockup(ON_LIGHT)
    cs = (f'<div style="display:inline-block;padding:4px 6px;font-family:Lato">'
          f'<div style="font:600 112px/1 \'Cormorant Garamond\';color:#151613;letter-spacing:.005em;white-space:nowrap">'
          f'Charlotte <em style="color:#8a6232;font-weight:500">Square</em></div>'
          f'<div style="margin-top:14px;font:700 18px/1 Lato;letter-spacing:.36em;text-transform:uppercase;color:#8a6232">'
          f'Apartments · Rochester’s East End</div></div>')
    eho = build.EHO.replace('fill="currentColor"', 'fill="#5c5d55"').replace("<svg ", '<svg width="64" height="64" ', 1)
    pages = {
        "evolution24": f'<div style="display:inline-block;width:1116px">{lockup}</div>',
        "charlotte-square": cs,
        "eho": f'<div style="display:inline-block;width:64px;height:64px">{eho}</div>',
    }
    jobs = []
    for name, body in pages.items():
        html = work / f"{name}.html"
        html.write_text(f'<!doctype html><meta charset="utf-8"><style>{fonts_css()}body{{margin:0;background:#fff}}'
                        f'svg{{display:block;width:100%;height:auto}}</style><body>{body}</body>')
        jobs.append((str(html), str(work / f"{name}.png")))
    script = r"""
const pw = require('playwright'); const path = require('path'); const jobs = JSON.parse(process.argv[1]);
(async () => { const b = await pw.chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 3, viewport: { width: 1400, height: 600 } });
  for (const [html, png] of jobs) { await p.goto('file://' + path.resolve(html)); await p.evaluate(() => document.fonts.ready);
    await p.locator('body > div').screenshot({ path: png, omitBackground: false }); }
  await b.close(); })();"""
    import json
    subprocess.run(["node", "-e", script, json.dumps(jobs)], check=True)
    return {name: work / f"{name}.png" for name in pages}


# ---------------------------------------------------------------- the document
def font(run, size, name=SANS, color=INK, bold=False, italic=False):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    run.font.bold = bold
    run.font.italic = italic
    return run


def spacing(p, before=0, after=0, line=None):
    pf = p.paragraph_format
    pf.space_before, pf.space_after = Pt(before), Pt(after)
    if line:
        pf.line_spacing = line
    return p


def border(p, side, color=TAN, size=8, space=6):
    """A rule above or below a paragraph (size in eighths of a point)."""
    ppr = p._p.get_or_add_pPr()
    bdr = ppr.find(qn("w:pBdr"))
    if bdr is None:
        bdr = OxmlElement("w:pBdr")
        ppr.append(bdr)
    el = OxmlElement(f"w:{side}")
    for k, v in (("val", "single"), ("sz", str(size)), ("space", str(space)), ("color", color)):
        el.set(qn(f"w:{k}"), v)
    bdr.append(el)


def no_borders(table):
    tbl = table._tbl
    pr = tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), "nil")
        b.append(e)
    pr.append(b)


def letterhead(person, pics, dest):
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = SANS
    st.element.rPr.rFonts.set(qn("w:eastAsia"), SANS)
    st.font.size = Pt(10.5)
    st.font.color.rgb = RGBColor.from_string(INK)
    st.paragraph_format.space_after = Pt(0)
    st.paragraph_format.line_spacing = 1.25

    sec = doc.sections[0]
    sec.page_width, sec.page_height = Inches(8.5), Inches(11)
    sec.left_margin = sec.right_margin = Inches(1)
    sec.top_margin, sec.bottom_margin = Inches(1.55), Inches(1.05)
    sec.header_distance, sec.footer_distance = Inches(0.45), Inches(0.4)

    # header: logo on the left, the person on the right, a tan rule under both
    hdr = sec.header
    hdr.is_linked_to_previous = False
    t = hdr.add_table(rows=1, cols=2, width=Inches(6.5))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    no_borders(t)
    left, right = t.rows[0].cells
    left.width, right.width = Inches(3.6), Inches(2.9)
    lp = left.paragraphs[0]
    lp.add_run().add_picture(str(pics[person["logo"]]), width=Inches(2.35 if person["logo"] == "evolution24" else 2.45))
    rp = right.paragraphs[0]
    rp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    font(rp.add_run(person["name"]), 17, SERIF, INK, bold=True)
    for line in person["lines"]:
        p = right.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        spacing(p, 1, 0, 1.0)
        font(p.add_run(line), 8.5, color=MUTED)
    # header's own first paragraph (python-docx adds one before the table): make it the rule
    rule = hdr.paragraphs[0]
    hdr._element.remove(rule._p)
    hdr._element.append(rule._p)
    spacing(rule, 4, 0, 1.0)
    font(rule.add_run(""), 2)
    border(rule, "bottom", TAN, 6, 1)

    # footer: rule, address line, (managed by), EHO
    ftr = sec.footer
    ftr.is_linked_to_previous = False
    fp = ftr.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    border(fp, "top", TAN, 6, 8)
    font(fp.add_run(person["footer"]), 8, color=MUTED)
    if person.get("sub"):
        sp = ftr.add_paragraph()
        sp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        spacing(sp, 2, 0, 1.0)
        font(sp.add_run(person["sub"]), 8, color=MUTED)
    ep = ftr.add_paragraph()
    ep.alignment = WD_ALIGN_PARAGRAPH.CENTER
    spacing(ep, 4, 0, 1.0)
    ep.add_run().add_picture(str(pics["eho"]), height=Pt(9))
    font(ep.add_run("  Equal Housing Opportunity"), 7.5, color=MUTED)

    # the letter to fill in
    body = doc.add_paragraph()
    font(body.add_run("[Date]"), 10.5)
    spacing(body, 0, 18)
    for i, line in enumerate(["[Recipient name]", "[Street address]", "[City, State ZIP]"]):
        p = doc.add_paragraph()
        font(p.add_run(line), 10.5)
        if i == 2:
            spacing(p, 0, 18)
    p = doc.add_paragraph()
    font(p.add_run("Dear [Name],"), 10.5)
    spacing(p, 0, 10)
    for text in ["[Your letter begins here. This template keeps the header and footer on every page, so a "
                 "longer letter carries on to a second page on its own.]", "[Second paragraph.]"]:
        p = doc.add_paragraph()
        font(p.add_run(text), 10.5)
        spacing(p, 0, 10)
    p = doc.add_paragraph()
    font(p.add_run("Sincerely,"), 10.5)
    spacing(p, 8, 30)
    p = doc.add_paragraph()
    font(p.add_run(person["name"]), 17, SERIF, bold=True)
    p = doc.add_paragraph()
    font(p.add_run(person["lines"][0]), 9, color=MUTED)
    doc.core_properties.title = person["file"]
    doc.core_properties.author = build.NAME
    doc.save(dest)


def main():
    work = OUT / "work"
    work.mkdir(parents=True, exist_ok=True)
    pics = pictures(work)
    made = []
    for person in PEOPLE:
        dest = OUT / f"{person['file']}.docx"
        letterhead(person, pics, dest)
        made.append(dest)
        print(dest.name)
    soffice = shutil.which("soffice")
    if soffice:
        subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", str(OUT), *map(str, made)],
                       check=True, capture_output=True)


if __name__ == "__main__":
    main()
