// Xero's UK VAT return export, parsed (VAT build spec 17 Nov 2026, step 2).
//
// Xero's API does not expose UK VAT returns, so a person exports each
// company's return from Xero (one workbook, three tabs: VAT Return,
// Transactions by VAT Box, Transactions by Tax Rate) and uploads it. The
// browser reads the workbook into rows of cell text per tab; this reads
// those rows. Pure functions, so the same parse runs in tests, the local
// check against real exports, and the upload route.
//
// What Xero writes (seen across 59 Feldspar exports, Mar 2024 - Oct 2026):
//   VAT Return tab: "For the period 01 Oct 2026 - 31 Oct 2026", VAT Number,
//     VAT Scheme, Period Start / Period End, then one row per box:
//     [label, "1".."9", amount]. Amounts are text.
//   Transactions by VAT Box tab: "Box N" rows ([Box N, label, total]), each
//     followed by sections (a one-cell heading, a Date/Account/... header, and
//     rows [dd/mm/yyyy, "Account name(code)", reference, details, VAT, Net]).
//     Boxes 1-4 carry the VAT column, boxes 6-9 the Net column.
//   Section headings: "20% (VAT on Expenses)", "... Late Claims",
//     "... - Adjusted", "... Late Claims - Adjusted", "Reverse Charge ...
//     Reclaimed VAT", "Adjustments with no accounting transactions" (account
//     N/A, reference "Created on dd/mm/yyyy") and "Imported VAT box amount"
//     (reference "Import").

const BOX_TAB = "Transactions by VAT Box";
const RETURN_TAB = "VAT Return";
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const pence = (v) => {
  const s = clean(v).replace(/,/g, "");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const pounds = (p) => Math.round(p) / 100;

// "01 Oct 2026" or "01 Sept 2026" -> 2026-10-01
function longDate(s) {
  const m = /^(\d{1,2}) ([A-Za-z]{3,4}) (\d{4})$/.exec(clean(s));
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  return mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
// "31/10/2026" -> 2026-10-31
function shortDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean(s));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function kindOf(section) {
  const s = section.toLowerCase();
  if (s.startsWith("adjustments with no accounting transactions")) return "no_transaction";
  if (s.startsWith("imported vat box amount")) return "imported";
  const late = s.includes("late claims");
  const adjusted = s.includes("- adjusted");
  if (late && adjusted) return "late_adjusted";
  if (late) return "late";
  if (adjusted) return "adjusted";
  return "standard";
}

// sheets: { "VAT Return": rows, "Transactions by VAT Box": rows, ... }, rows
// being arrays of cell text. Returns { entity, period_start, period_end,
// vat_number, scheme, boxes: {1..9: pounds}, lines: [...], errors, warnings }.
function parseVatExport(sheets) {
  const errors = [];
  const warnings = [];
  const ret = sheets?.[RETURN_TAB];
  const tx = sheets?.[BOX_TAB];
  if (!Array.isArray(ret)) errors.push(`The file has no "${RETURN_TAB}" tab: export the VAT return from Xero as Excel`);
  if (!Array.isArray(tx)) errors.push(`The file has no "${BOX_TAB}" tab: export the VAT return from Xero as Excel`);
  if (errors.length) return { errors, warnings, boxes: {}, lines: [] };

  const out = { entity: null, period_start: null, period_end: null, vat_number: null, scheme: null, boxes: {}, lines: [], errors, warnings };
  const rows = ret.map((r) => (r || []).map(clean));
  out.entity = rows[1]?.find((c) => c) ?? null;
  for (const r of rows) {
    const cells = r.filter((c) => c !== "");
    if (!cells.length) continue;
    const head = cells[0].toLowerCase();
    if (head.startsWith("for the period")) {
      const m = /for the period (.+?) - (.+)$/i.exec(cells[0]);
      if (m) { out.period_start = longDate(m[1]); out.period_end = longDate(m[2]); }
    } else if (head === "vat number") out.vat_number = (cells[1] || "").replace(/[^0-9]/g, "") || null;
    else if (head === "vat scheme") out.scheme = cells[1] || null;
    else if (head === "period start") out.period_start = longDate(cells[1]) ?? out.period_start;
    else if (head === "period end") out.period_end = longDate(cells[1]) ?? out.period_end;
    else if (/^[1-9]$/.test(cells[1] ?? "") && cells.length >= 3) {
      const p = pence(cells[2]);
      if (p === null) errors.push(`Box ${cells[1]}: "${cells[2]}" is not an amount`);
      else out.boxes[Number(cells[1])] = pounds(p);
      if (cells[1] === "5") out.box5_label = cells[0];
    }
  }
  if (!out.period_start || !out.period_end) errors.push("The return's period could not be read");
  for (let b = 1; b <= 9; b++) if (out.boxes[b] === undefined) errors.push(`Box ${b} is missing from the VAT Return tab`);

  // Transactions by VAT Box
  let box = null;
  let section = null;
  const totals = {};
  const sums = {};
  for (const raw of tx) {
    const r = (raw || []).map(clean);
    const cells = r.filter((c) => c !== "");
    if (!cells.length) continue;
    const m = /^Box ([1-9])$/.exec(cells[0]);
    if (m) {
      box = Number(m[1]);
      section = null;
      const total = pence(cells[cells.length - 1]);
      if (totals[box] === undefined && total !== null) totals[box] = total;
      continue;
    }
    if (cells.length === 1) { section = cells[0]; continue; }
    if (cells[0] === "Date") continue;
    const date = shortDate(r[0]);
    if (!date || !box || !section) continue;
    const vat = pence(r[4]);
    const net = pence(r[5]);
    if (vat === null || net === null) { errors.push(`Box ${box}, ${section}: an amount on ${r[0]} could not be read`); continue; }
    const acct = /^(.*)\(([^()]+)\)$/.exec(r[1] || "");
    const created = /^Created on (\d{2}\/\d{2}\/\d{4})$/.exec(r[2] || "");
    // Reverse charge appears on both sides: under box 1 the "Reclaimed VAT"
    // section repeats what box 4 claims, and under box 4 the plain reverse
    // charge section repeats what box 1 charges. Those copies are memo lines:
    // they do not count towards the box they sit under.
    const rc = /reverse charge/i.test(section);
    const reclaimed = /reclaimed vat/i.test(section);
    const memo = rc && ((box === 1 && reclaimed) || (box === 4 && !reclaimed));
    const line = {
      box, section, kind: kindOf(section), reverse_charge: rc, memo,
      date, account: acct ? clean(acct[1]) : (r[1] || null), account_code: acct ? acct[2] : null,
      reference: r[2] || null, details: r[3] || null, vat: pounds(vat), net: pounds(net),
      created_on: created ? shortDate(created[1]) : null,
    };
    out.lines.push(line);
    if (!memo) sums[box] = (sums[box] ?? 0) + (box <= 4 ? vat : net);
  }
  // Each box's lines add up to its total (a sanity check on the read).
  // Boxes 6-9 are whole pounds: Xero drops the pence.
  for (const [b, t] of Object.entries(totals)) {
    const raw = sums[b] ?? 0;
    const s = Number(b) >= 6 ? Math.trunc(raw / 100) * 100 : raw;
    if (Math.abs(s - t) > 1) warnings.push(`Box ${b}: the transactions add up to ${pounds(s).toFixed(2)}, the box says ${pounds(t).toFixed(2)}`);
  }
  return out;
}

// The net position of a return in pence, signed: positive is owed to HMRC,
// negative is to reclaim. Box 5 is shown unsigned with a label saying which.
function netPosition(boxes) {
  return Math.round((boxes[3] - boxes[4]) * 100);
}

module.exports = { parseVatExport, netPosition, kindOf, longDate, shortDate, BOX_TAB, RETURN_TAB };
