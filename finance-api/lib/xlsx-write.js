// Writes a small .xlsx workbook with no library: the sheets as XML in a zip,
// built with Node's zlib. Made for the outstanding documents export (Nik,
// 10 Nov 2026) and kept general: sheets of typed columns, a bold header row,
// frozen panes, filters, column widths, and optional lines above the table.
//
// Every text cell is an inline string, never a formula, so text that starts
// with "=" from a bank reference stays text when the client opens the file.

const zlib = require("zlib");

// ── Zip (deflate, with CRC-32) ──────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  // A fixed timestamp (1 Jan 2026) so the same content gives the same bytes.
  const time = 0, date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, text] of files) {
    const data = Buffer.from(text, "utf8");
    const body = zlib.deflateRawSync(data);
    const n = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, body);
    centrals.push(ch, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ── Cells ────────────────────────────────────────────────────────────────────

const esc = (s) => String(s)
  // Characters XML 1.0 forbids would make Excel call the file damaged.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const colName = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// YYYY-MM-DD to Excel's day number (1900 system).
function serial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Styles: 0 plain, 1 header, 2 money, 3 date, 4 bold, 5 bold money, 6 wrapped text, 7 title.
const STYLE = { text: 0, header: 1, money: 2, date: 3, bold: 4, boldMoney: 5, wrap: 6, title: 7, number: 8 };
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;(#,##0.00)"/><numFmt numFmtId="165" formatCode="d mmm yyyy"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="13"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F0E8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD4C5A9"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// One cell. value null or "" leaves it empty.
function cell(ref, value, type = "text", style) {
  if (value === null || value === undefined || value === "") return "";
  if (type === "money" || type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return cell(ref, String(value), "text", style);
    return `<c r="${ref}" s="${style ?? STYLE[type]}"><v>${n}</v></c>`;
  }
  if (type === "date") {
    const n = serial(value);
    if (n == null) return cell(ref, String(value), "text", style);
    return `<c r="${ref}" s="${style ?? STYLE.date}"><v>${n}</v></c>`;
  }
  const s = style ?? STYLE[type] ?? 0;
  return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ""}><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

// ── Sheets ───────────────────────────────────────────────────────────────────

// A sheet:
//   name      tab name (made safe and unique by the workbook)
//   lines     optional rows above the table: [[text, style?], ...] per row, or
//             { cells: [{ value, type, style }] }
//   columns   [{ header, type: text|money|date|number|wrap, width }]
//   rows      arrays of values in column order
//   totals    optional { label, sum: [column index, ...] } added under the rows
function sheetXml(sheet) {
  const out = [];
  let r = 0;
  for (const line of sheet.lines ?? []) {
    r += 1;
    const cells = Array.isArray(line) ? line.map((v, i) => (Array.isArray(v) ? { value: v[0], style: v[1] } : { value: v })) : line.cells;
    out.push(`<row r="${r}">${cells.map((c, i) => cell(`${colName(i)}${r}`, c.value, c.type ?? "text", c.style !== undefined ? STYLE[c.style] ?? c.style : undefined)).join("")}</row>`);
  }
  const cols = sheet.columns ?? [];
  let headerRow = null;
  if (cols.length) {
    if (sheet.lines?.length) r += 1;
    r += 1;
    headerRow = r;
    out.push(`<row r="${r}" ht="28" customHeight="1">${cols.map((c, i) => cell(`${colName(i)}${r}`, c.header, "text", STYLE.header)).join("")}</row>`);
    for (const row of sheet.rows ?? []) {
      r += 1;
      out.push(`<row r="${r}">${cols.map((c, i) => cell(`${colName(i)}${r}`, row[i], c.type ?? "text")).join("")}</row>`);
    }
    if (sheet.totals && (sheet.rows ?? []).length) {
      r += 1;
      const first = headerRow + 1, last = r - 1;
      out.push(`<row r="${r}">${cols.map((c, i) => {
        const ref = `${colName(i)}${r}`;
        if (i === 0) return cell(ref, sheet.totals.label ?? "Total", "text", STYLE.bold);
        if (!sheet.totals.sum.includes(i)) return "";
        const total = (sheet.rows ?? []).reduce((t, row) => t + (Number.isFinite(Number(row[i])) && row[i] !== null && row[i] !== "" ? Math.round(Number(row[i]) * 100) : 0), 0) / 100;
        return `<c r="${ref}" s="${STYLE.boldMoney}"><f>SUBTOTAL(9,${colName(i)}${first}:${colName(i)}${last})</f><v>${total}</v></c>`;
      }).join("")}</row>`);
    }
  }
  const w = cols.length ? cols.map((c) => c.width ?? 14) : sheet.widths ?? [];
  const widths = w.length ? `<cols>${w.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${x}" customWidth="1"/>`).join("")}</cols>` : "";
  const freeze = headerRow ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const lastDataRow = headerRow ? headerRow + (sheet.rows ?? []).length : 0;
  const filter = headerRow && (sheet.rows ?? []).length ? `<autoFilter ref="A${headerRow}:${colName(cols.length - 1)}${lastDataRow}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${freeze}<sheetFormatPr defaultRowHeight="13"/>${widths}<sheetData>${out.join("")}</sheetData>${filter}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

// Excel's rules for a tab name: 31 characters, none of []:*?/\, not blank,
// and unique ignoring case.
function sheetNames(names) {
  const used = new Set();
  return names.map((raw) => {
    const base = String(raw ?? "").replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Sheet";
    let name = base, n = 2;
    while (used.has(name.toLowerCase())) { const tail = ` (${n++})`; name = base.slice(0, 31 - tail.length) + tail; }
    used.add(name.toLowerCase());
    return name;
  });
}

function writeWorkbook(sheets, { title = "Workbook", author = "STZA" } = {}) {
  const names = sheetNames(sheets.map((s) => s.name));
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator></cp:coreProperties>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${sheets.some((s) => s.columns?.length && s.rows?.length) ? `<definedNames>${sheets.map((s, i) => {
      if (!s.columns?.length || !s.rows?.length) return "";
      const head = (s.lines?.length ? s.lines.length + 2 : 1);
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!$A$${head}:$${colName(s.columns.length - 1)}$${head + s.rows.length}</definedName>`;
    }).join("")}</definedNames>` : ""}</workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", STYLES_XML],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zip(files);
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

module.exports = { writeWorkbook, sheetNames, sheetXml, serial, colName, crc32, XLSX_TYPE };
