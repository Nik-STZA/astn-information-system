// Parses the client open-items register (open-items.md) into structured items.
//
// Pure and side-effect free, shared by the importer and the file watcher.
//
// Shape of the file:
//
//   ## Active items
//   ### Financial reporting
//   | # | Item | Owner | Pri | Status | Surfaced | Last update |
//   |---|---|---|---|---|---|---|
//   | 1 | ... | CEO (Alvina) | P1 | Awaiting confirmation | 2026-06-02 | ... |
//
//   ## Closed / superseded items
//   | # | Item | Owner | Closed | Resolution |
//
// Two things the format does that a naive parser gets wrong:
//
//   1. A table can resume after a blank line with no repeated header. In the
//      live file, items 14 to 18 sit in a detached block under the same
//      heading. Rows are therefore matched on shape, and the column layout in
//      force is carried across the gap.
//   2. Item cells contain pipes inside inline code and bold markup, so a naive
//      split on "|" over-splits. Cells are joined back to the expected count.

export interface OpenItem {
  ref: string;
  title: string;
  category: string | null;
  ownerLabel: string | null;
  priority: string | null;
  status: string | null;
  raisedAt: string | null;
  lastUpdateAt: string | null;
  closedAt: string | null;
  resolution: string | null;
  isClosed: boolean;
  sourceFile: string;
  sourceLine: number;
}

type Layout = "active" | "closed";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (s: string) => s.trim();
const orNull = (s: string | undefined) => {
  const v = clean(s ?? "");
  return v === "" ? null : v;
};
const dateOrNull = (s: string | undefined) => {
  const v = clean(s ?? "");
  return DATE.test(v) ? v : null;
};

// Splits a markdown table row, then repairs over-splitting caused by pipes
// inside cell content by folding the surplus back into the widest cell.
function splitRow(line: string, expected: number): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const parts = trimmed.split("|");
  if (parts.length <= expected) return parts.map(clean);

  // The item description is the long free-text column, so absorb the surplus
  // there: keep the first cell, fold the middle, keep the trailing columns.
  const tailCount = expected - 2;
  const head = parts[0];
  const tail = parts.slice(parts.length - tailCount);
  const middle = parts.slice(1, parts.length - tailCount).join("|");
  return [head, middle, ...tail].map(clean);
}

function isSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim()) && line.includes("-");
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}

export function parseOpenItems(markdown: string, sourceFile: string): OpenItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: OpenItem[] = [];

  let layout: Layout = "active";
  let category: string | null = null;
  let inClosedSection = false;
  let sawHeaderRow = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      const label = h2[1].trim();
      inClosedSection = /closed|superseded/i.test(label);
      // A level-2 heading ends the previous section's table context.
      category = null;
      sawHeaderRow = false;
      continue;
    }

    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) {
      category = h3[1].trim();
      sawHeaderRow = false;
      continue;
    }

    if (!isTableRow(line) || isSeparator(line)) continue;

    // A header row tells us which layout is in force for the rows that follow,
    // including any detached block after a blank line.
    const cells = splitRow(line, 7);
    if (/^#$/.test(cells[0]) || /^\s*#\s*$/.test(cells[0])) {
      layout = /closed/i.test(line) ? "closed" : inClosedSection ? "closed" : "active";
      sawHeaderRow = true;
      continue;
    }

    if (!sawHeaderRow && !inClosedSection && category === null) continue;

    const expected = layout === "closed" ? 5 : 7;
    const c = splitRow(line, expected);
    const ref = clean(c[0]);
    // Rows whose first cell is not an item number are not items.
    if (!ref || !/^[A-Za-z]?\d+[A-Za-z]?$/.test(ref)) continue;

    const title = clean(c[1]);
    if (!title) continue;

    if (layout === "closed") {
      items.push({
        ref,
        title,
        category,
        ownerLabel: orNull(c[2]),
        priority: null,
        status: "Closed",
        raisedAt: null,
        lastUpdateAt: null,
        closedAt: dateOrNull(c[3]),
        resolution: orNull(c[4]),
        isClosed: true,
        sourceFile,
        sourceLine: i + 1,
      });
    } else {
      items.push({
        ref,
        title,
        category,
        ownerLabel: orNull(c[2]),
        priority: orNull(c[3]),
        status: orNull(c[4]),
        raisedAt: dateOrNull(c[5]),
        lastUpdateAt: dateOrNull(c[6]),
        closedAt: null,
        resolution: null,
        isClosed: false,
        sourceFile,
        sourceLine: i + 1,
      });
    }
  }

  return items;
}

// Whether a status means the item no longer needs action.
//
// The register keeps completed items in the active table until someone tidies
// up, so section alone overstates the workload. Counting rows reported 20 open
// items where 17 were genuinely open, because items 7, 8 and 14 read "DONE via
// ..." while still sitting under Active items.
//
// "Partially DONE" is deliberately still open: schema delivered, reader
// pending, is not done. The rule matches DONE only at the start of the status,
// so a partial reads as outstanding, which is what it is.
export function isDoneStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return /^\s*done\b/i.test(status);
}

// An item still needing action: not in the closed section, and not marked done
// in place.
export function isOutstanding(item: { isClosed: boolean; status: string | null }): boolean {
  return !item.isClosed && !isDoneStatus(item.status);
}
