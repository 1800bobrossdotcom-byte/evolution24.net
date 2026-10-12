#!/usr/bin/env python3
"""Evolution24 pay logs: one simple workbook per person, in the brand's colours, for Google Sheets.

  python3 tools/pay-log/make.py                          a blank template in tools/pay-log/out/
  python3 tools/pay-log/make.py people.json [out dir]    one workbook per person in people.json

people.json holds names and rates of pay, so keep it out of the repository; people.example.json
shows its shape.

Two tabs:
  Pay log          the person and their rate of pay; a row per property per day (date, property,
                   hours, and the pay worked out); total hours and total pay at the top
  Monthly summary  hours and pay for each property, month by month, with totals; and each pay
                   week's hours and pay (weeks run Saturday to Friday)
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
SLOTS = 20                     # property rows on the summary: the list above, and room to add more
LOG, SUM = 'Pay log', 'Monthly summary'
FIRST, LAST = 10, 609          # Pay log entry rows
WEEKS = 53

MONEY = '$#,##0.00;-$#,##0.00;"–"'
HOURS = '0.0#;-0.0#;"–"'
THIN = Side(style='thin', color=LINE)
GRID = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


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


def validate(ws, rng, **kw):
    dv = DataValidation(allow_blank=True, showErrorMessage=True, **kw)
    dv.add(rng)
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


def pay_log(ws, person):
    band(ws, f'="Pay log  ·  "&B5', 5)
    for letter, width in zip('ABCDEF', (15, 26, 11, 13, 56, 12)):
        ws.column_dimensions[letter].width = width
    ws.column_dimensions['F'].hidden = True   # the pay week of each row, for weekly pay and salaries

    put(ws, 'A5', 'Person', align=Alignment(vertical='center'))
    put(ws, 'B5', person.get('name') or None, font(11, bold=True), INPUT, align=Alignment(vertical='center', indent=1),
        border=GRID)
    put(ws, 'A6', 'Rate of pay', align=Alignment(vertical='center'))
    put(ws, 'B6', person.get('rate'), font(11, bold=True), INPUT, MONEY, Alignment(vertical='center'), GRID)
    put(ws, 'C6', 'per week' if person.get('per') == 'week' else 'per hour', font(bold=True), INPUT,
        align=Alignment(horizontal='center', vertical='center'), border=GRID)
    validate(ws, 'C6', type='list', formula1='"per hour,per week"')
    validate(ws, 'B6', type='decimal', operator='greaterThanOrEqual', formula1='0', error='An amount in dollars.')
    ws.merge_cells('D5:E6')
    put(ws, 'D5', 'Add a row for each property you work at each day: the date, the property and the hours. '
                  'Pay works itself out. On a weekly rate, each week is shared across its properties by hours.',
        font(9, MUTED, italic=True), align=Alignment(wrap_text=True, vertical='center', indent=1))
    ws.row_dimensions[5].height = ws.row_dimensions[6].height = 22

    ws.row_dimensions[8].height = 24
    for letter, text in zip('ABCDE', ('Date', 'Property', 'Hours', 'Pay', 'Work done (optional)')):
        put(ws, f'{letter}8', text, font(9, CREAM, True), INK, align=Alignment(horizontal='center', vertical='center'))
    put(ws, 'A9', 'Total', font(11, bold=True), CREAM, align=Alignment(indent=1, vertical='center'), border=GRID)
    put(ws, 'B9', None, bg=CREAM, border=GRID)
    put(ws, 'C9', f'=SUM(C{FIRST}:C{LAST})', font(11, bold=True), CREAM, HOURS, Alignment(vertical='center'), GRID)
    put(ws, 'D9', f'=SUM(D{FIRST}:D{LAST})', font(11, bold=True), CREAM, MONEY, Alignment(vertical='center'), GRID)
    put(ws, 'E9', None, bg=CREAM, border=GRID)
    ws.row_dimensions[9].height = 22

    for r in range(FIRST, LAST + 1):
        put(ws, f'A{r}', None, font(), INPUT, 'ddd m/d/yy', border=GRID)
        put(ws, f'B{r}', None, font(), INPUT, align=Alignment(indent=1), border=GRID)
        put(ws, f'C{r}', None, font(), INPUT, HOURS, border=GRID)
        put(ws, f'D{r}', f'=IF(OR(C{r}="",$B$6=""),"",IF($C$6="per week",'
                         f'IFERROR($B$6*C{r}/SUMIFS($C${FIRST}:$C${LAST},$F${FIRST}:$F${LAST},F{r}),""),$B$6*C{r}))',
            font(), WHITE, MONEY, border=GRID)
        put(ws, f'E{r}', None, font(), INPUT, align=Alignment(indent=1), border=GRID)
        put(ws, f'F{r}', f'=IF(A{r}="","",A{r}+MOD(6-WEEKDAY(A{r}),7))', font(color=MUTED), fmt='m/d/yy')
    validate(ws, f'A{FIRST}:A{LAST}', type='date', operator='greaterThan', formula1='36526',
             errorTitle='Date', error='Type a date, like 10/12/2026.')
    validate(ws, f'B{FIRST}:B{LAST}', type='list', formula1=f"'{SUM}'!$A$9:$A${8 + SLOTS}", errorStyle='warning',
             errorTitle='Property', error='Not on the property list (add new ones on Monthly summary). Keep it anyway?')
    validate(ws, f'C{FIRST}:C{LAST}', type='decimal', operator='between', formula1='0', formula2='24',
             errorTitle='Hours', error='Hours as a number: 7.5 is seven and a half.')
    ws.freeze_panes = f'A{FIRST}'
    ws.print_title_rows = '8:9'


def summary(ws, person):
    band(ws, f"=\"Monthly summary  ·  \"&'{LOG}'!B5", 14)
    ws.column_dimensions['A'].width = 26
    for c in range(2, 14):
        ws.column_dimensions[get_column_letter(c)].width = 10.5
    ws.column_dimensions['N'].width = 12

    start = dt.date.fromisoformat(person['log_starts']) if person.get('log_starts') else dt.date.today()
    put(ws, 'A5', 'First month', align=Alignment(vertical='center'))
    put(ws, 'B5', dt.date(start.year, start.month, 1), font(bold=True), INPUT, 'mmm yyyy',
        Alignment(horizontal='center', vertical='center'), GRID)
    put(ws, 'C5', 'Change it to move the twelve months.', font(9, MUTED, italic=True), align=Alignment(vertical='center', indent=1))
    validate(ws, 'B5', type='date', operator='greaterThan', formula1='36526', error='Type a date, like 10/1/2026.')

    log = lambda c: f"'{LOG}'!${c}${FIRST}:${c}${LAST}"

    def grid(top, heading, values, fmt, names_from=None):
        put(ws, f'A{top}', heading, font(11, ACCENT, True))
        h = top + 1
        ws.row_dimensions[h].height = 24
        put(ws, f'A{h}', 'Property', font(9, CREAM, True), INK, align=Alignment(vertical='center', indent=1))
        for m in range(12):
            c = get_column_letter(2 + m)
            put(ws, f'{c}{h}', '=DATE(YEAR($B$5),MONTH($B$5),1)' if m == 0 else f'=EDATE({get_column_letter(1 + m)}{h},1)',
                font(9, CREAM, True), INK, 'mmm yyyy', Alignment(horizontal='center', vertical='center'))
        put(ws, f'N{h}', 'Total', font(9, CREAM, True), INK, align=Alignment(horizontal='center', vertical='center'))
        rows = range(h + 1, h + 1 + SLOTS)
        other, total = h + 1 + SLOTS, h + 2 + SLOTS
        for i, r in enumerate(rows):
            if names_from is None:
                put(ws, f'A{r}', PROPERTIES[i] if i < len(PROPERTIES) else None, font(), INPUT,
                    align=Alignment(indent=1), border=GRID)
            else:
                put(ws, f'A{r}', f'=IF(A{names_from + i}="","",A{names_from + i})', font(), WHITE,
                    align=Alignment(indent=1), border=GRID)
            for m in range(12):
                c = get_column_letter(2 + m)
                put(ws, f'{c}{r}', f'=IF($A{r}="","",SUMIFS({log(values)},{log("B")},$A{r},'
                                   f'{log("A")},">="&{c}${h},{log("A")},"<"&EDATE({c}${h},1)))', font(), WHITE, fmt, border=GRID)
            put(ws, f'N{r}', f'=IF($A{r}="","",SUM(B{r}:M{r}))', font(bold=True), WHITE, fmt, border=GRID)
        put(ws, f'A{other}', 'Other or no property', font(color=MUTED, italic=True), WHITE, align=Alignment(indent=1), border=GRID)
        put(ws, f'A{total}', 'Total', font(bold=True), CREAM, align=Alignment(indent=1), border=GRID)
        for m in range(13):
            c = get_column_letter(2 + m)
            if c == 'N':
                put(ws, f'N{total}', f'=SUM(B{total}:M{total})', font(bold=True), CREAM, fmt, border=GRID)
            else:
                put(ws, f'{c}{total}', f'=SUMIFS({log(values)},{log("A")},">="&{c}${h},{log("A")},"<"&EDATE({c}${h},1))',
                    font(bold=True), CREAM, fmt, border=GRID)
            put(ws, f'{c}{other}', f'={c}{total}-SUM({c}{rows[0]}:{c}{rows[-1]})', font(color=MUTED, italic=True), WHITE, fmt,
                border=GRID)
        return rows[0], total

    names, end = grid(7, 'Hours', 'C', HOURS)
    put(ws, f'C{7}', 'Add new properties in the empty tan rows; they join the list on the Pay log.',
        font(9, MUTED, italic=True), align=Alignment(indent=1))
    _, end = grid(end + 2, 'Pay', 'D', MONEY, names_from=names)

    # Each pay week, for paying people.
    top = end + 2
    put(ws, f'A{top}', 'Pay weeks  (Saturday to Friday)', font(11, ACCENT, True))
    for c, text in zip('ABC', ('Week ending', 'Hours', 'Pay')):
        put(ws, f'{c}{top + 1}', text, font(9, CREAM, True), INK, align=Alignment(horizontal='center', vertical='center'))
    ws.row_dimensions[top + 1].height = 24
    for i in range(WEEKS):
        r = top + 2 + i
        week = '$B$5+MOD(6-WEEKDAY($B$5),7)' if i == 0 else f'A{r - 1}+7'
        put(ws, f'A{r}', f'={week}', font(), WHITE, 'ddd m/d/yy', Alignment(indent=1), GRID)
        put(ws, f'B{r}', f"=SUMIFS({log('C')},{log('F')},A{r})", font(), WHITE, HOURS, border=GRID)
        put(ws, f'C{r}', f"=SUMIFS({log('D')},{log('F')},A{r})", font(bold=True), WHITE, MONEY, border=GRID)
    ws.freeze_panes = 'B7'


def build(person, path):
    wb = Workbook()
    wb._fonts[0] = Font(name=FONT, size=10)   # the default for cells nobody styled
    log = wb.active
    log.title = LOG
    pay_log(log, person)
    summary(wb.create_sheet(SUM), person)
    for ws in wb.worksheets:
        ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
    wb[SUM].page_setup.orientation = 'landscape'
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
