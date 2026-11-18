// The group VAT return and the import file (VAT build spec 17 Nov 2026,
// section 6). Pure: takes parsed exports (lib/vat-export.js).
//
// A group files through the representative member's Xero organisation. The
// group return is the sum of every member's own figures. The import file is
// that target less what is already in the representative's return: its own
// transactions plus every import and manual adjustment made so far (an import
// appears in its export as "Imported VAT box amount", a manual one as an
// adjustment with no accounting transaction). So a second import never double
// counts, and a wrong one is corrected by the next file, worked out here.
//
// Xero takes boxes 1, 2, 4 and 6-9 from an import file and works out boxes 3
// and 5 itself (every Feldspar export shows imported lines under those boxes
// only, and box 5 = |box 3 - box 4| after six imports in March 2026). Boxes
// 6-9 are whole pounds.

const IMPORTED = new Set(["imported"]);
const BOXES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const FILE_BOXES = [1, 2, 4, 6, 7, 8, 9];

const p = (n) => Math.round(Number(n || 0) * 100);
const pounds = (pence) => Math.round(pence) / 100;
const lineValue = (l) => (l.box <= 4 ? p(l.vat) : p(l.net));

// A company's own figures in pence: its boxes less the lines that are not its
// own transactions (imports, and adjustments with no accounting transaction
// unless the CFO accepted them as genuine). accepted(line) -> boolean.
function ownBoxes(parsed, accepted = () => false) {
  const out = {};
  for (const b of BOXES) out[b] = p(parsed.boxes[b]);
  for (const l of parsed.lines || []) {
    if (l.memo) continue;
    const notOwn = IMPORTED.has(l.kind) || (l.kind === "no_transaction" && !accepted(l));
    if (notOwn) out[l.box] -= lineValue(l);
  }
  for (const b of [6, 7, 8, 9]) out[b] = Math.trunc(out[b] / 100) * 100;
  out[3] = out[1] + out[2];
  out[5] = out[3] - out[4]; // signed: positive owed to HMRC, negative to reclaim
  return out;
}

// members: [{ entity_id, entity_name, parsed, representative: bool }] - one
// export each, the representative's being its latest (pre- or post-import).
// Returns the group table, the target, what is already in the representative's
// return and the import (deltas, boxes 1, 2, 4, 6-9), all in pounds.
function buildGroup(members, accepted = () => false, repLatest = null) {
  const rep = members.find((m) => m.representative);
  if (!rep) throw new Error("no representative member's export");
  const columns = members.map((m) => ({ entity_id: m.entity_id, entity_name: m.entity_name, representative: Boolean(m.representative), own: ownBoxes(m.parsed, accepted) }));
  const target = {};
  for (const b of BOXES) target[b] = columns.reduce((s, c) => s + c.own[b], 0);
  const already = {};
  // What is in the representative's return now: its latest export (after any
  // import), or its own export when nothing has been imported yet.
  for (const b of BOXES) already[b] = p((repLatest ?? rep.parsed).boxes[b]);
  // The representative's export shows box 5 unsigned; sign it from 3 and 4.
  already[5] = already[3] - already[4];
  const delta = {};
  for (const b of FILE_BOXES) delta[b] = target[b] - already[b];
  const nothingToImport = FILE_BOXES.every((b) => delta[b] === 0);
  const conv = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, pounds(v)]));
  return {
    columns: columns.map((c) => ({ ...c, own: conv(c.own) })),
    target: conv(target),
    already: conv(already),
    import: conv(delta),
    nothing_to_import: nothingToImport,
    // What the representative's return should show once the import is in.
    expected_after_import: conv({ ...target }),
  };
}

// Whether a representative's export, after an import, shows the group target
// on every box. Returns the boxes that differ.
function confirmImport(target, repParsed) {
  const out = [];
  for (const b of BOXES) {
    const want = b === 5 ? Math.abs(p(target[5])) : p(target[b]);
    const got = p(repParsed.boxes[b]);
    if (want !== got) out.push({ box: b, want: pounds(want), got: pounds(got) });
  }
  return out;
}

// The rows of Xero's VAT return import template (A1 title, then Box 1..9 with
// a value each). Box 3 and 5 are given as Xero would compute them; Xero
// recalculates them anyway.
function importTemplateRows(delta) {
  const v = (b) => Number(delta[b] ?? 0);
  const box3 = v(1) + v(2);
  return [
    ["VAT Return Import"],
    ["Box 1", v(1)], ["Box 2", v(2)], ["Box 3", Math.round(box3 * 100) / 100], ["Box 4", v(4)],
    ["Box 5", Math.round(Math.abs(box3 - v(4)) * 100) / 100],
    ["Box 6", v(6)], ["Box 7", v(7)], ["Box 8", v(8)], ["Box 9", v(9)],
  ];
}

module.exports = { ownBoxes, buildGroup, confirmImport, importTemplateRows, FILE_BOXES };
