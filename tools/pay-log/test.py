#!/usr/bin/env python3
"""Fills two pay logs (one hourly, one on a weekly rate) with made-up rows, lets LibreOffice
calculate them, and checks the totals, the monthly summary and the pay weeks against the same
sums worked out here in Python.

  python3 tools/pay-log/test.py

Needs LibreOffice Calc (soffice) on the PATH.
"""
import datetime as dt
import os
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make  # noqa: E402

D = dt.date
ROWS = [  # date, property, hours
    (D(2026, 10, 10), 'Water Street', 3),
    (D(2026, 10, 12), 'Water Street', 5.5),
    (D(2026, 10, 12), '145 South Fitzhugh', 2.5),
    (D(2026, 10, 13), 'The Biltmore', 8),
    (D(2026, 10, 16), 'Office', 1.25),
    (D(2026, 10, 19), 'Charlotte Square', 9),
    (D(2026, 10, 31), 'Water Street', 4),        # a Saturday: the next pay week, still October
    (D(2026, 11, 2), 'Water Street', 6),
    (D(2026, 11, 3), 'A garage on Main', 2),     # not on the list: counted under Other
    (D(2026, 11, 4), '', 1),                      # no property: also Other
    (D(2027, 9, 30), '379 South Main', 7),       # the twelfth month
]
PEOPLE = [{'name': 'Hourly Test', 'rate': 21.5, 'per': 'hour', 'log_starts': '2026-10-10'},
          {'name': 'Weekly Test', 'rate': 1000, 'per': 'week', 'log_starts': '2026-10-10'}]


def week_end(d):
    return d + dt.timedelta(days=(4 - d.weekday()) % 7)   # the Friday on or after d


def expected(person):
    week_hours = defaultdict(float)
    for d, _, h in ROWS:
        week_hours[week_end(d)] += h
    pay = [person['rate'] * h if person['per'] == 'hour' else person['rate'] * h / week_hours[week_end(d)]
           for d, _, h in ROWS]
    month = defaultdict(lambda: [0.0, 0.0])
    week = defaultdict(lambda: [0.0, 0.0])
    for (d, p, h), money in zip(ROWS, pay):
        key = p if p in make.PROPERTIES else 'Other or no property'
        for k in ((key, d.year, d.month), ('Total', d.year, d.month)):
            month[k][0] += h
            month[k][1] += money
        week[week_end(d)][0] += h
        week[week_end(d)][1] += money
    return pay, month, week


def recalc(path):
    """Calculate every formula with LibreOffice and save the values into the file."""
    with tempfile.TemporaryDirectory() as tmp:
        profile = Path(tmp) / 'profile'
        env = {**os.environ, 'SAL_USE_VCLPLUGIN': 'svp'}
        run = lambda *a: subprocess.run(['soffice', '--headless', f'-env:UserInstallation={profile.as_uri()}', *a],
                                        env=env, capture_output=True, timeout=180)
        run('--terminate_after_init')
        (profile / 'user' / 'basic' / 'Standard' / 'Module1.xba').write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">\n'
            '<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">\n'
            'Sub Recalc\n  ThisComponent.calculateAll()\n  ThisComponent.store()\n  ThisComponent.close(True)\nEnd Sub\n</script:module>')
        run('macro:///Standard.Module1.Recalc', str(path))


def check(person, keep=None):
    problems = []

    def same(label, value, want):
        if abs((value or 0) - want) > 0.005:
            problems.append(f"{person['name']}: {label}: sheet {value!r}, expected {want!r}")

    with tempfile.TemporaryDirectory() as tmp:
        path = make.build(person, Path(tmp) / 'test.xlsx')
        wb = load_workbook(path)
        ws = wb[make.LOG]
        for i, (d, p, h) in enumerate(ROWS):
            r = make.FIRST + i
            ws[f'A{r}'], ws[f'B{r}'], ws[f'C{r}'] = d, p or None, h
        wb.save(path)
        recalc(path)
        if keep:
            Path(keep).write_bytes(path.read_bytes())
        got = load_workbook(path, data_only=True)

    errors = [f'{s.title}!{c.coordinate}' for s in got.worksheets for row in s.iter_rows() for c in row
              if isinstance(c.value, str) and c.value.startswith('#')]
    problems += [f'formula error at {e}' for e in errors[:10]]
    pay, month, week = expected(person)
    log, summ = got[make.LOG], got[make.SUM]
    for i, money in enumerate(pay):
        same(f'row {make.FIRST + i} pay', log[f'D{make.FIRST + i}'].value, money)
    same('total hours', log['C9'].value, sum(h for _, _, h in ROWS))
    same('total pay', log['D9'].value, sum(pay))
    for top, idx, label in ((8, 0, 'hours'), (33, 1, 'pay')):
        months = [(summ.cell(top, c).value.year, summ.cell(top, c).value.month) for c in range(2, 14)]
        for r in range(top + 1, top + 3 + make.SLOTS):
            name = summ.cell(r, 1).value
            if not name:
                continue
            for c, (y, m) in enumerate(months, start=2):
                same(f'{label} {name} {y}-{m}', summ.cell(r, c).value, month.get((name, y, m), [0, 0])[idx])
            same(f'{label} {name} total', summ.cell(r, 14).value,
                 sum(v[idx] for (n, _, _), v in month.items() if n == name))
    first_week = 59
    for i in range(make.WEEKS):
        r = first_week + i
        w = summ[f'A{r}'].value.date()
        same(f'week {w} hours', summ[f'B{r}'].value, week.get(w, [0, 0])[0])
        same(f'week {w} pay', summ[f'C{r}'].value, week.get(w, [0, 0])[1])
    if summ[f'A{first_week}'].value.date() != D(2026, 10, 2):
        problems.append(f"first pay week ends {summ[f'A{first_week}'].value}, expected Fri 10/2/26")
    return problems


def main():
    problems = []
    for i, person in enumerate(PEOPLE):
        problems += check(person, keep=os.environ.get('KEEP') and f"{os.environ['KEEP']}-{i}.xlsx")
    if problems:
        print('\n'.join(problems))
        sys.exit(f'{len(problems)} problems')
    print(f'pay log: hourly and weekly rates, {len(ROWS)} rows: every total, month and pay week matches')


if __name__ == '__main__':
    main()
