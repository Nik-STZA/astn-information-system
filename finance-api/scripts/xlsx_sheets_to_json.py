"""Every tab of one or more .xlsx files as rows of cell text, as the browser
reads them, so finance-api's parsers can be checked against real files.
Usage: python xlsx_sheets_to_json.py out.json file1.xlsx [file2.xlsx ...]"""
import json, sys
import openpyxl

out = {}
for path in sys.argv[2:]:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out[path] = {ws.title: [["" if c is None else str(c) for c in row] for row in ws.iter_rows(values_only=True)] for ws in wb.worksheets}
json.dump(out, open(sys.argv[1], "w", encoding="utf-8"))
print(len(out), "files")
