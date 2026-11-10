// Reads an uploaded spreadsheet (.xlsx or .csv) into rows of text, with no
// library: an .xlsx is a zip of XML, and Node's zlib unpacks it. Built for
// outstanding documents (10 Nov 2026), where the files are bank reconciliation
// reports and query lists exported from Xero or kept by hand.
//
// Values only, never formulas run: a cell gives its saved value. Dates come
// back as YYYY-MM-DD when the cell's number format is a date. Anything this
// cannot open (an old .xls, a zip64, an encrypted workbook) throws a plain
// sentence the person can act on.

const zlib = require("zlib");

const MAX_ROWS = 5000;
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;

// ── Zip ──────────────────────────────────────────────────────────────────────

function unzip(buf) {
  const files = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff || count === 0xffff) throw new Error("the workbook is too large to read here (zip64)");
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("the workbook's index is damaged");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (flags & 1) throw new Error("the workbook is password protected; save it without a password and upload again");
    if (usize > MAX_ENTRY_BYTES) throw new Error("the workbook is too large to read here");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error("the workbook is damaged");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    files.set(name, { method, raw, usize });
  }
  return {
    has: (name) => files.has(name),
    text(name) {
      const f = files.get(name);
      if (!f) return null;
      if (f.method === 0) return f.raw.toString("utf8");
      if (f.method === 8) return zlib.inflateRawSync(f.raw, { maxOutputLength: MAX_ENTRY_BYTES }).toString("utf8");
      throw new Error(`the workbook uses a compression this cannot read (${f.method})`);
    },
  };
}

// ── XML bits ─────────────────────────────────────────────────────────────────

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]) : null;
};

// All the text in an element, joining rich-text runs; phonetic hints dropped.
const textOf = (xml) => decode((xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [])
  .map((t) => t.replace(/^<t\b[^>]*>|<\/t>$/g, "")).join(""));

// ── Dates ────────────────────────────────────────────────────────────────────

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

// Style index -> true when the cell's number format shows a date.
function dateStyles(stylesXml) {
  if (!stylesXml) return [];
  const custom = new Map();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    // A date format names day, month or year outside quotes and brackets.
    const code = String(attr(m[0], "formatCode") || "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
    custom.set(id, /[dy]|m{3,}/i.test(code) && !/^[#0.,%\s]*$/.test(code));
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!xfs) return [];
  return [...xfs[1].matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") || 0);
    return BUILTIN_DATES.has(id) || custom.get(id) === true;
  });
}

// Excel's day number (1900 system, with its 1900 leap-year bug) to YYYY-MM-DD.
function serialDate(n, date1904 = false) {
  if (!Number.isFinite(n) || n < 1 || n > 200000) return null;
  const days = Math.floor(n) + (date1904 ? 1462 : 0);
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// "AB12" -> 27 (zero-based column).
function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref || "")?.[0];
  if (!letters) return null;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ── Workbook ─────────────────────────────────────────────────────────────────

function readXlsx(buf) {
  const zip = unzip(buf);
  const wb = zip.text("xl/workbook.xml");
  if (!wb) throw new Error("this zip is not an Excel workbook");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb);
  const rels = new Map();
  for (const m of (zip.text("xl/_rels/workbook.xml.rels") || "").matchAll(/<Relationship\b[^>]*>/g)) {
    rels.set(attr(m[0], "Id"), attr(m[0], "Target"));
  }
  const shared = [];
  for (const m of (zip.text("xl/sharedStrings.xml") || "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  const isDate = dateStyles(zip.text("xl/styles.xml"));

  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name") || `Sheet${sheets.length + 1}`;
    if (attr(m[0], "state") === "hidden" || attr(m[0], "state") === "veryHidden") continue;
    let target = rels.get(attr(m[0], "r:id"));
    if (!target) continue;
    target = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = zip.text(target);
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNo = Number(attr(r[1], "r")) || rows.length + 1;
      const cells = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = c[1], inner = c[2] || "";
        const col = colIndex(attr(at, "r")) ?? cells.length;
        const t = attr(at, "t");
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let out = null;
        if (t === "s") out = v != null ? shared[Number(v)] ?? "" : null;
        else if (t === "inlineStr") out = textOf(inner);
        else if (t === "str" || t === "e") out = v != null ? decode(v) : null;
        else if (t === "b") out = v === "1" ? "TRUE" : "FALSE";
        else if (v != null) {
          const num = Number(v);
          const s = Number(attr(at, "s") || 0);
          out = isDate[s] ? serialDate(num, date1904) ?? String(num) : String(num);
        }
        if (out != null && String(out).trim() !== "") cells[col] = String(out).replace(/ /g, " ").trim();
      }
      if (cells.some((x) => x)) rows.push({ row: rowNo, cells: Array.from(cells, (x) => x ?? "") });
      if (rows.length >= MAX_ROWS) break;
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error("the workbook has no sheets with data");
  return sheets;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function readCsv(buf) {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", quoted = false, line = 1, start = 1;
  const push = () => { row.push(cell.trim()); cell = ""; };
  const end = () => { push(); if (row.some((x) => x)) rows.push({ row: start, cells: row }); row = []; start = line; };
  for (let i = 0; i < text.length && rows.length < MAX_ROWS; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else { if (ch === "\n") line++; cell += ch; }
    } else if (ch === '"') quoted = true;
    else if (ch === ",") push();
    else if (ch === "\n") { line++; end(); }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) end();
  return [{ name: "CSV", rows }];
}

// ── Entry ────────────────────────────────────────────────────────────────────

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// What kind of file this is, from its first bytes and then its name.
function kindOf(buf, fileName = "", contentType = "") {
  const name = String(fileName).toLowerCase();
  if (buf.length >= 5 && buf.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50 && (name.endsWith(".xlsx") || name.endsWith(".xlsm") || contentType === XLSX_TYPE)) return "xlsx";
  if (buf.length >= 8 && buf.readUInt32LE(0) === 0xe011cfd0) return "xls";
  if (name.endsWith(".csv") || /text\/csv/i.test(contentType)) return "csv";
  return null;
}

function readSheets(buf, kind) {
  if (kind === "xlsx") return readXlsx(buf);
  if (kind === "csv") return readCsv(buf);
  throw new Error(`cannot read a ${kind} file as a spreadsheet`);
}

// The sheets as tab-separated text, each line led by its sheet row number, so
// a line the model takes out can be traced back to the cell it came from.
function sheetsAsText(sheets, { maxChars = 400000 } = {}) {
  const parts = [];
  let size = 0;
  for (const s of sheets) {
    parts.push(`=== Sheet: ${s.name} ===`);
    for (const r of s.rows) {
      const line = `R${r.row}\t${r.cells.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t")}`;
      size += line.length + 1;
      if (size > maxChars) { parts.push("[... the rest of the file was cut off here]"); return { text: parts.join("\n"), truncated: true }; }
      parts.push(line);
    }
  }
  return { text: parts.join("\n"), truncated: false };
}

module.exports = { readXlsx, readCsv, readSheets, kindOf, sheetsAsText, serialDate, colIndex, unzip, XLSX_TYPE };
