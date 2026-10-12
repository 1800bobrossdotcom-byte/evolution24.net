#!/usr/bin/env python3
"""Evolution24 pay logs: one simple workbook per person, in the brand's colours, for Google Sheets.

  python3 tools/pay-log/make.py                          a blank template in tools/pay-log/out/
  python3 tools/pay-log/make.py people.json [out dir]    one file per person in people.json, and a template

people.json holds names and rates of pay, so keep it out of the repository; people.example.json
shows its shape.

Three tabs:
  Pay log          the person and their rate of pay, then a block for each pay week (Saturday to
                   Friday): the days already dated, three lines a day for property and hours, the
                   pay worked out, and a total for the week; the grand total at the top
  Weekly summary   hours and pay for each property, week by week, with totals
  Monthly summary  the same, month by month; new properties are added here
"""
import datetime as dt
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.drawing.image import Image
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.utils.units import pixels_to_EMU
from openpyxl.worksheet.datavalidation import DataValidation

HERE = Path(__file__).resolve().parent
LOGO = HERE.parent.parent / 'source' / 'logo' / 'sheet-logo.png'

INK, TAN, CREAM, PAPER, ACCENT = '151613', 'DEBB92', 'E5E6D3', 'F4F1EA', '8A6232'   # assets/css/main.css
INPUT, LINE, MUTED, WHITE, FONT = 'F8EEDF', 'D8D3C6', '6B6A63', 'FFFFFF', 'Arial'
PROPERTIES = ['301 Central Avenue', '145 South Fitzhugh', 'Water Street', 'The Biltmore', '181 St. Paul',
              'Charlotte Square', '2215 James Street', '121 Park Drive', '379 South Main', '561 South Main',
              '31 Genesee Street', '440 Armstrong', '444 Armstrong', '452 Armstrong', '4940 Hillcrest',
              '300 Alexander', 'Office']
SLOTS = 20                     # property rows on Monthly summary: the list above, and room to add more
LOG, WEEK, MONTH = 'Pay log', 'Weekly summary', 'Monthly summary'
WEEKS, LINES, MONTHS = 52, 3, 12
FIRST = 11                     # Pay log: the first row of the first week
TOTAL = 'Week total'
NAMES = f"'{MONTH}'!$A$9:$A${8 + SLOTS}"   # the property list

MONEY = '$#,##0.00;-$#,##0.00;"–"'
HOURS = '0.0#;-0.0#;"–"'
THIN = Side(style='thin', color=LINE)
GRID = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
DAY_TOP = Border(left=THIN, right=THIN, top=Side(style='thin', color=MUTED), bottom=THIN)


def fill(color):
    return PatternFill('solid', start_color=color, end_color=color)


def font(size=10, color=INK, bold=False, italic=False):
    return Font(name=FONT, size=size, color=color, bold=bold, italic=italic)


def put(ws, cell, value=None, f=None, bg=None, fmt=None, align=None, border=None):
    c = ws[cell]
    if value is not None:
        c.value = value
    c.font = f or font()
    if bg:
        c.fill = fill(bg)
    if fmt:
        c.number_format = fmt
    if align:
        c.alignment = align
    if border:
        c.border = border
    return c


def validate(ws, cells, **kw):
    dv = DataValidation(allow_blank=True, showErrorMessage=True, **kw)
    for c in cells:
        dv.add(c)
    ws.add_data_validation(dv)


def band(ws, title, last_col):
    """The ink band: the logo, then the title."""
    ws.sheet_view.showGridLines = False
    ws.row_dimensions[1].height, ws.row_dimensions[2].height, ws.row_dimensions[3].height = 45, 22, 4
    for c in range(1, last_col + 1):
        letter = get_column_letter(c)
        ws[f'{letter}1'].fill = ws[f'{letter}2'].fill = fill(INK)
        ws[f'{letter}3'].fill = fill(TAN)
    put(ws, 'A2', title, font(12, CREAM, True), INK, align=Alignment(vertical='center', indent=1))
    if LOGO.exists():
        img = Image(str(LOGO))
        w = 176
        img.anchor = OneCellAnchor(_from=AnchorMarker(col=0, colOff=pixels_to_EMU(12), row=0, rowOff=pixels_to_EMU(11)),
                                   ext=XDRPositiveSize2D(pixels_to_EMU(w), pixels_to_EMU(round(w * img.height / img.width))))
        ws.add_image(img)


def heading_row(ws, row, labels, height=24):
    ws.row_dimensions[row].height = height
    for letter, text, fmt in labels:
        put(ws, f'{letter}{row}', text, font(9, CREAM, True), INK, fmt,
            Alignment(horizontal='center', vertical='center', wrap_text=True))


def first_saturday(person):
    start = dt.date.fromisoformat(person['log_starts']) if person.get('log_starts') else dt.date.today()
    return start - dt.timedelta(days=(start.weekday() - 5) % 7)


def layout(saturday):
    """Where everything sits on the Pay log: per week, its heading, its day lines and its total."""
    weeks, r, month = [], FIRST, None
    for w in range(WEEKS):
        sat = saturday + dt.timedelta(days=7 * w)
        fri = sat + dt.timedelta(days=6)
        week = {'sat': sat, 'fri': fri, 'month_row': None}
        if (fri.year, fri.month) != month:
            month = (fri.year, fri.month)
            week['month_row'] = r
            r += 1
        week['heading'] = r
        r += 1
        week['lines'] = []
        for d in range(7):
            for k in range(LINES):
                week['lines'].append((r, sat + dt.timedelta(days=d), k == 0))
                r += 1
        week['total'] = r
        weeks.append(week)
        r += 2   # the total, and a gap
    return weeks


def pay_log(ws, person, weeks):
    band(ws, '="Pay log  ·  "&B5', 5)
    for letter, width in zip('ABCDEF', (15, 26, 10, 13, 56, 12)):
        ws.column_dimensions[letter].width = width
    ws.column_dimensions['F'].hidden = True   # every line's date, for the summaries

    put(ws, 'A5', 'Person', align=Alignment(vertical='center'))
    put(ws, 'B5', person.get('name') or None, font(11, bold=True), INPUT, align=Alignment(vertical='center', indent=1),
        border=GRID)
    put(ws, 'A6', 'Rate of pay', align=Alignment(vertical='center'))
    put(ws, 'B6', person.get('rate'), font(11, bold=True), INPUT, MONEY, Alignment(vertical='center'), GRID)
    put(ws, 'C6', 'per week' if person.get('per') == 'week' else 'per hour', font(bold=True), INPUT,
        align=Alignment(horizontal='center', vertical='center'), border=GRID)
    validate(ws, ['C6'], type='list', formula1='"per hour,per week"')
    validate(ws, ['B6'], type='decimal', operator='greaterThanOrEqual', formula1='0', error='An amount in dollars.')
    ws.merge_cells('D5:E6')
    put(ws, 'D5', 'Fill in the property and hours for each day you work: up to three properties a day, '
                  'one per line. Pay works itself out. On a weekly rate, the week is shared across its properties by hours.',
        font(9, MUTED, italic=True), align=Alignment(wrap_text=True, vertical='center', indent=1))
    ws.row_dimensions[5].height = ws.row_dimensions[6].height = 22

    heading_row(ws, 8, [(c, t, None) for c, t in zip('ABCDE', ('Date', 'Property', 'Hours', 'Pay', 'Work done (optional)'))])
    whole = lambda c: f'${c}${FIRST}:${c}${weeks[-1]["total"]}'
    put(ws, 'A9', 'Total', font(11, bold=True), CREAM, align=Alignment(indent=1, vertical='center'), border=GRID)
    put(ws, 'C9', f'=SUMIF({whole("A")},"{TOTAL}",{whole("C")})', font(11, bold=True), CREAM, HOURS,
        Alignment(vertical='center'), GRID)
    put(ws, 'D9', f'=SUMIF({whole("A")},"{TOTAL}",{whole("D")})', font(11, bold=True), CREAM, MONEY,
        Alignment(vertical='center'), GRID)
    for c in 'BE':
        put(ws, f'{c}9', None, bg=CREAM, border=GRID)
    ws.row_dimensions[9].height = 22

    for week in weeks:
        if week['month_row']:
            r = week['month_row']
            ws.row_dimensions[r].height = 26
            put(ws, f'A{r}', week['fri'].strftime('%B %Y'), font(12, ACCENT, True), align=Alignment(vertical='bottom'))
        h, t = week['heading'], week['total']
        for c in 'ABCDE':
            put(ws, f'{c}{h}', None, bg=PAPER)
        put(ws, f'A{h}', f"Week of {week['sat']:%a %-m/%-d} – {week['fri']:%a %-m/%-d/%Y}", font(bold=True), PAPER,
            align=Alignment(indent=1, vertical='center'))
        ws.row_dimensions[h].height = 20
        first, last = week['lines'][0][0], week['lines'][-1][0]
        for r, day, first_line in week['lines']:
            edge = DAY_TOP if first_line else GRID
            put(ws, f'A{r}', day if first_line else None, font(), WHITE, 'ddd m/d', Alignment(indent=1), edge)
            put(ws, f'B{r}', None, font(), INPUT, align=Alignment(indent=1), border=edge)
            put(ws, f'C{r}', None, font(), INPUT, HOURS, border=edge)
            put(ws, f'D{r}', f'=IF(OR(C{r}="",$B$6=""),"",IF($C$6="per week",IFERROR($B$6*C{r}/C${t},""),$B$6*C{r}))',
                font(), WHITE, MONEY, border=edge)
            put(ws, f'E{r}', None, font(), INPUT, align=Alignment(indent=1), border=edge)
            put(ws, f'F{r}', day, font(color=MUTED), fmt='m/d/yy')
        put(ws, f'A{t}', TOTAL, font(bold=True), CREAM, align=Alignment(indent=1), border=GRID)
        put(ws, f'B{t}', None, bg=CREAM, border=GRID)
        put(ws, f'C{t}', f'=SUM(C{first}:C{last})', font(bold=True), CREAM, HOURS, border=GRID)
        put(ws, f'D{t}', f'=SUM(D{first}:D{last})', font(bold=True), CREAM, MONEY, border=GRID)
        put(ws, f'E{t}', None, bg=CREAM, border=GRID)

    lines = [r for week in weeks for r, _, _ in week['lines']]
    validate(ws, [f'B{r}' for r in lines], type='list', formula1=NAMES, errorStyle='warning',
             errorTitle='Property', error='Not on the property list (add new ones on Monthly summary). Keep it anyway?')
    validate(ws, [f'C{r}' for r in lines], type='decimal', operator='between', formula1='0', formula2='24',
             errorTitle='Hours', error='Hours as a number: 7.5 is seven and a half.')
    ws.freeze_panes = 'A10'
    ws.print_title_rows = '8:8'


LOG_COL = lambda c, last: f"'{LOG}'!${c}${FIRST}:${c}${last}"


def weekly(ws, weeks):
    last = weeks[-1]['total']
    hours, pay, props, dates = (LOG_COL(c, last) for c in 'CDBF')
    cols = [get_column_letter(2 + i) for i in range(SLOTS)]
    other, total = get_column_letter(2 + SLOTS), get_column_letter(3 + SLOTS)
    band(ws, f"=\"Weekly summary  ·  \"&'{LOG}'!B5", 3 + SLOTS)
    ws.column_dimensions['A'].width = 16
    for c in cols + [other]:
        ws.column_dimensions[c].width = 10
    ws.column_dimensions[total].width = 12
    put(ws, 'A5', 'Each pay week runs Saturday to Friday. Properties come from the list on Monthly summary.',
        font(9, MUTED, italic=True))

    def grid(top, heading, values, fmt):
        put(ws, f'A{top}', heading, font(12, ACCENT, True))
        h = top + 1
        heading_row(ws, h, [('A', 'Week ending', None), (other, 'Other or none', None), (total, 'Total', None)] +
                    [(c, f"=IF('{MONTH}'!A{9 + i}=\"\",\"\",'{MONTH}'!A{9 + i})", None) for i, c in enumerate(cols)], 40)
        for i, week in enumerate(weeks):
            r = h + 1 + i
            span = f'{dates},">="&($A{r}-6),{dates},"<="&$A{r}'
            put(ws, f'A{r}', week['fri'], font(), WHITE, 'ddd m/d/yy', Alignment(indent=1), GRID)
            for c in cols:
                put(ws, f'{c}{r}', f'=IF({c}${h}="","",SUMIFS({values},{props},{c}${h},{span}))', font(), WHITE, fmt, border=GRID)
            put(ws, f'{total}{r}', f'=SUMIFS({values},{span})', font(bold=True), CREAM, fmt, border=GRID)
            put(ws, f'{other}{r}', f'={total}{r}-SUM({cols[0]}{r}:{cols[-1]}{r})', font(color=MUTED, italic=True), WHITE, fmt,
                border=GRID)
        return h + WEEKS

    end = grid(7, 'Hours', hours, HOURS)
    grid(end + 2, 'Pay', pay, MONEY)
    ws.freeze_panes = 'B9'


def monthly(ws, weeks):
    last = weeks[-1]['total']
    hours, pay, props, dates = (LOG_COL(c, last) for c in 'CDBF')
    band(ws, f"=\"Monthly summary  ·  \"&'{LOG}'!B5", 2 + MONTHS)
    ws.column_dimensions['A'].width = 26
    for c in range(2, 2 + MONTHS):
        ws.column_dimensions[get_column_letter(c)].width = 10.5
    end_col = get_column_letter(2 + MONTHS)
    ws.column_dimensions[end_col].width = 12
    put(ws, 'A5', 'To add a property, type it in an empty tan row under Hours; it joins the list on the Pay log.',
        font(9, MUTED, italic=True))
    sat = weeks[0]['sat']
    months = [dt.date(sat.year + (sat.month - 1 + m) // 12, (sat.month - 1 + m) % 12 + 1, 1) for m in range(MONTHS)]

    def grid(top, heading, values, fmt, names_from=None):
        put(ws, f'A{top}', heading, font(12, ACCENT, True))
        h = top + 1
        heading_row(ws, h, [('A', 'Property', None), (end_col, 'Total', None)] +
                    [(get_column_letter(2 + m), month, 'mmm yyyy') for m, month in enumerate(months)])
        rows = range(h + 1, h + 1 + SLOTS)
        other, total = h + 1 + SLOTS, h + 2 + SLOTS
        for i, r in enumerate(rows):
            if names_from is None:
                put(ws, f'A{r}', PROPERTIES[i] if i < len(PROPERTIES) else None, font(), INPUT, align=Alignment(indent=1),
                    border=GRID)
            else:
                put(ws, f'A{r}', f'=IF(A{names_from + i}="","",A{names_from + i})', font(), WHITE, align=Alignment(indent=1),
                    border=GRID)
        put(ws, f'A{other}', 'Other or no property', font(color=MUTED, italic=True), WHITE, align=Alignment(indent=1), border=GRID)
        put(ws, f'A{total}', 'Total', font(bold=True), CREAM, align=Alignment(indent=1), border=GRID)
        for m in range(MONTHS):
            c = get_column_letter(2 + m)
            span = f'{dates},">="&{c}${h},{dates},"<"&EDATE({c}${h},1)'
            for r in rows:
                put(ws, f'{c}{r}', f'=IF($A{r}="","",SUMIFS({values},{props},$A{r},{span}))', font(), WHITE, fmt, border=GRID)
            put(ws, f'{c}{total}', f'=SUMIFS({values},{span})', font(bold=True), CREAM, fmt, border=GRID)
            put(ws, f'{c}{other}', f'={c}{total}-SUM({c}{rows[0]}:{c}{rows[-1]})', font(color=MUTED, italic=True), WHITE, fmt,
                border=GRID)
        for r in list(rows) + [other, total]:
            put(ws, f'{end_col}{r}', f'=IF($A{r}="","",SUM(B{r}:{get_column_letter(1 + MONTHS)}{r}))', font(bold=True),
                CREAM if r == total else WHITE, fmt, border=GRID)
        return rows[0], total

    names, end = grid(7, 'Hours', hours, HOURS)
    grid(end + 2, 'Pay', pay, MONEY, names_from=names)
    ws.freeze_panes = 'B9'


def build(person, path):
    weeks = layout(first_saturday(person))
    wb = Workbook()
    wb._fonts[0] = Font(name=FONT, size=10)   # the default for cells nobody styled
    wb.active.title = LOG
    pay_log(wb.active, person, weeks)
    weekly(wb.create_sheet(WEEK), weeks)
    monthly(wb.create_sheet(MONTH), weeks)
    for ws in wb.worksheets:
        ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
    wb[WEEK].page_setup.orientation = wb[MONTH].page_setup.orientation = 'landscape'
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


def file_name(person):
    return f"Evolution24 Pay Log - {(person.get('name') or 'Template').rstrip('.')}.xlsx"


def main(argv):
    if len(argv) > 1:
        data = json.loads(Path(argv[1]).read_text())
        out = Path(argv[2]) if len(argv) > 2 else HERE / 'out'
        people = [{'log_starts': data.get('log_starts'), **p} for p in data['people']]
        people.append({'log_starts': data.get('log_starts')})
    else:
        out, people = HERE / 'out', [{}]
    for p in people:
        print(build(p, out / file_name(p)))


if __name__ == '__main__':
    main(sys.argv)
