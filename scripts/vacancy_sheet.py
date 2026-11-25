#!/usr/bin/env python3
"""What the lease worksheet says is vacant, building by building, for the availability sync.

    python3 scripts/vacancy_sheet.py LEASE-WORKSHEETS.xlsx [--date 2026-11-24]

Reads the leasing team's "LEASE WORKSHEETS" workbook (exported from Google Sheets as .xlsx) and
writes data/vacancy-sheet.json: for each building with a tab, the units that are vacant now with
the rent to advertise (the tab's "Total Amount Due", or "Total Rent charged"), its bedrooms, baths
and size where the tab has them, and whether it is furnished ("-F"), and the day it was read. Only those leave the workbook: never a tenant's name, phone or payments.
scripts/availability.mjs then lists exactly those units, at those rents (Rent Manager gives size
and bedrooms, and the rent where the cell is blank), while the file is at most STALE_DAYS old
(see there), so the worksheet, which the team updates every day before Rent Manager, decides
what the website shows and what it costs.

A unit is vacant when its tenant cell says VACANT. A name there means it is taken, even while
the months still say VACANT (a new lease is entered there first). Only when the tenant cell is
blank does the most recent month with anything in it decide: VACANT, within the last three
months, is vacant. Parking, garages, storage and offices are left out. A unit marked Commercial (in its "# of
Beds" or beside its number) is kept, as commercial space: the website lists it apart from homes.
Google Sheets turned some unit numbers into dates ("1-3" became 1 March); they are read back.
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "vacancy-sheet.json"

# Each building's tab. "block": the heading row a building's units follow, when two share a tab.
TABS = {
    "301-central-avenue": dict(tab="301 Central 2026"),
    "water-street": dict(tab="168-176 N Water St 2026"),
    "145-south-fitzhugh-street": dict(tab="145 S Fitzhugh 2026"),
    "181-st-paul-street": dict(tab="179-189 St Paul 2026"),
    "biltmore": dict(tab="357 Alexander St 2025-2026"),
    "2215-james-street": dict(tab="2215 James 2026"),
    "121-park-drive": dict(tab="121 Park 2026"),
    "31-genesee-street": dict(tab="31 Gen/379 Main 2025-2026", block=None, until="379 Main"),
    "379-south-main-street": dict(tab="31 Gen/379 Main 2025-2026", block="379 Main"),
    "561-south-main-street": dict(tab="561 Main 2026"),
}
NOT_A_HOME = re.compile(r"spot|garage|parking|storage|office|airbnb|total", re.I)    # never listed
COMMERCIAL = re.compile(r"commercial", re.I)          # listed, as commercial space, not as a home
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def vacant(c):
    return isinstance(c, str) and "vacan" in c.lower()


def unit_name(v):
    """The unit as the team typed it, undoing Sheets' dates: 1 March 2024 was "1-3"."""
    if v is None:
        return ""
    if isinstance(v, (dt.datetime, dt.date)):
        return f"{v.day}-{v.month}"
    s = str(v).strip()
    return s[:-2] if re.fullmatch(r"\d+\.0", s) else s


def layout(v):
    """(beds, baths) from "# of Beds": 2, "1B/1B", "2B/1Ba", "1 bed/1ba", "Studio"; None where it says neither."""
    if isinstance(v, (int, float)):
        return (int(v), None) if 0 <= v <= 6 else (None, None)
    s = str(v or "").strip().lower()
    if s.startswith("studio"):
        m = re.search(r"/\s*(\d+(?:\.5)?)\s*b", s)
        return 0, (float(m[1]) if m else None)
    m = re.match(r"(\d)\s*(?:b|bed|br)?\w*\s*(?:/\s*(\d+(?:\.5)?)\s*b)?", s)
    return (int(m[1]), float(m[2]) if m[2] else None) if m else (None, None)


def month_of(h):
    """1-12 for a month column's heading ("November", "2025-11-01", "PAID August 2025"), else None."""
    if isinstance(h, (dt.datetime, dt.date)):
        return h.month
    s = str(h or "").strip().lower()
    for i, m in enumerate(MONTHS):
        if re.match(rf"(paid\s+)?{m}", s):              # "March", "PAID August 2025"; not "Max Market"
            return i + 1
    return None


def find_tab(wb, name):
    plain = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    for ws in wb.worksheets:
        if plain(ws.title) == plain(name):
            return ws
    raise SystemExit(f"No tab named {name!r} in the workbook.")


def read_building(ws, spec, today):
    rows = [list(r) + [None] * 60 for r in ws.iter_rows(values_only=True)]
    start, stop = 0, len(rows)
    if spec.get("block"):
        start = next(i for i, r in enumerate(rows) if spec["block"].lower() in str(r[0] or "").lower())
    if spec.get("until"):
        stop = next((i for i, r in enumerate(rows) if spec["until"].lower() in str(r[0] or "").lower()), len(rows))
    rows = rows[start:stop]
    # The heading row: the first naming a tenant column ("Tenant Name", or St. Paul's "First Name").
    who = lambda c: re.search(r"tenant|first name", str(c or ""), re.I)
    h = next(i for i, r in enumerate(rows[:6]) if any(who(c) for c in r))
    head = rows[h]
    tenant = next(j for j, c in enumerate(head) if who(c))
    total = next((j for j, c in enumerate(head) if re.search(r"total (amount due|rent)", str(c or ""), re.I)), None)
    beds = next((j for j, c in enumerate(head) if re.search(r"beds?\b", str(c or ""), re.I)), None)   # "Commercial" there: a shop
    sqft = next((j for j, c in enumerate(head) if re.search(r"sq\.? ?ft", str(c or ""), re.I)), None)
    months = [(j, month_of(c)) for j, c in enumerate(head) if j > tenant and month_of(c)]
    recent = {(today.month - k - 1) % 12 + 1 for k in range(3)}          # this month and the two before
    out, seen = [], {}
    for r in rows[h + 1:]:
        name = unit_name(r[0])
        rent = r[total] if total is not None and isinstance(r[total], (int, float)) and r[total] > 0 else None
        if name in seen and seen[name] is not None and seen[name].get("rent") is None and rent:
            seen[name]["rent"] = round(rent)              # a unit listed twice: the first row with a rent
        if (not name or name.lower().startswith("unit") or name in seen
                or any(NOT_A_HOME.search(str(c or "")) for c in [name, *r[1:tenant]])):
            continue
        seen[name] = None
        filled = [(m, r[j]) for j, m in months if r[j] not in (None, "")]
        last_month, last = filled[-1] if filled else (None, None)
        # The tenant cell decides: VACANT is vacant, a name is taken (a new lease is entered there
        # first, before its months are). Only a blank one falls back to the latest month.
        blank = r[tenant] is None or str(r[tenant]).strip() == ""
        if vacant(r[tenant]) or (blank and vacant(last) and last_month in recent):
            shop = any(COMMERCIAL.search(str(c or "")) for c in [name, *r[1:tenant], r[beds] if beds is not None else ""])
            b, ba = layout(r[beds]) if beds is not None and not shop else (None, None)
            size = r[sqft] if sqft is not None and isinstance(r[sqft], (int, float)) and 150 <= r[sqft] <= 5000 else None
            seen[name] = {"unit": name, "rent": round(rent) if rent else None, "beds": b, "baths": ba,
                          "sqft": round(size) if size else None, "furnished": bool(re.search(r"\d\s*-?\s*F$", name, re.I)),
                          "commercial": shop}
            out.append(seen[name])
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit(__doc__)
    day = sys.argv[sys.argv.index("--date") + 1] if "--date" in sys.argv else dt.date.today().isoformat()
    today = dt.date.fromisoformat(day)
    wb = openpyxl.load_workbook(args[0], data_only=True, read_only=True)
    buildings = {slug: read_building(find_tab(wb, spec["tab"]), spec, today) for slug, spec in TABS.items()}
    data = {"_about": "Generated by scripts/vacancy_sheet.py from the leasing team's LEASE WORKSHEETS: the units each building's "
                      "tab marks vacant, with the rent to advertise (Total Amount Due). scripts/availability.mjs lists exactly "
                      "these, at these rents, while as_of is recent. No tenant details.",
            "as_of": day, "buildings": buildings}
    OUT.write_text(json.dumps(data, indent=1) + "\n")
    for slug, units in buildings.items():
        print(slug + ': ' + (', '.join(f"{u['unit']} ${u['rent']}" for u in units) or 'none'))


if __name__ == "__main__":
    main()
