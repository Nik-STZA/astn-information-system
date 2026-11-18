// The VAT export parser against real Xero exports (not part of npm test: the
// files are a client's). Usage, from finance-api:
//   python scripts/xlsx_sheets_to_json.py exports.json <files...>
//   node scripts/vat-export-local-check.js exports.json [expected.json]
// expected.json (optional): { "<file>": { "5": 2834.99, ... } }
const fs = require("fs");
const { parseVatExport } = require("../lib/vat-export");
const files = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expected = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], "utf8")) : {};
let pass = 0, fail = 0;
for (const [path, sheets] of Object.entries(files)) {
  if (!sheets["Transactions by VAT Box"]) continue;
  const r = parseVatExport(sheets);
  const bad = [...r.errors, ...r.warnings];
  for (const [box, want] of Object.entries(expected[path] || {})) {
    if (Math.abs((r.boxes[box] ?? NaN) - want) > 0.005) bad.push(`box ${box} ${r.boxes[box]} expected ${want}`);
  }
  if (bad.length) { fail++; console.log("FAIL", path.slice(-70), r.period_start, bad.join("; ")); }
  else { pass++; if (process.env.VERBOSE) console.log("ok  ", path.slice(-70), r.period_start, r.period_end, "lines", r.lines.length); }
}
console.log(`${pass} parsed cleanly, ${fail} with issues`);
process.exit(fail ? 1 : 0);
