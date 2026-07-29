// Parses a client diary file (diary/YYYY-MM.md) into structured entries.
//
// Pure and side-effect free so the same code serves the one-shot importer and
// the file watcher, and so it can be tested without a database.
//
// The format is a human-written convention rather than a schema, so the
// headings vary more than the brief assumes. All of these occur in the live
// Feldspar diary:
//
//   ## 2026-06-02 - CFO (Nik) / STZA Fractional FD
//   ## 2026-05-28 09:30 - CFO (Nik) / STZA Fractional FD
//   ## 2026-06-02 (later) - CFO (Nik) / STZA Fractional FD
//   ## 2026-07-22 (Tue, continued) - Pack restructure + FC commentary first-cut
//   ## 2026-04 - PEAK Las Vegas (Alvina, Tim)          <- month only, no day
//   ## 2026-04-30 - Group intercompany reconciliation  <- no role
//   ## Logging convention                              <- not an entry at all
//
// The separator is an em dash in older entries and a hyphen in newer ones.
// A file's entries are not necessarily in its own month: diary/2026-06.md
// carries entries dated in July, so the date always comes from the heading and
// never from the filename.

export type OccurredPrecision = "minute" | "day" | "month";

export interface DiaryEntry {
  heading: string;
  occurredAt: string | null; // ISO 8601, null when the heading carries no date
  occurredPrecision: OccurredPrecision;
  role: string | null;
  agentName: string | null;
  action: string;
  wherePath: string | null;
  status: string | null;
  notes: string | null;
  sourceFile: string;
  sourceLine: number;
}

// YYYY-MM-DD or YYYY-MM, optional HH:MM, optional parenthetical, then the rest.
const HEADING = /^(\d{4}-\d{2}(?:-\d{2})?)(?:\s+(\d{2}:\d{2}))?\s*(?:\(([^)]*)\))?\s*(?:[-–—]\s*(.*))?$/;

// "CFO (Nik) / STZA Fractional FD" -> role CFO, name Nik.
const ROLE_WITH_NAME = /^([A-Z][A-Za-z0-9 &/]*?)\s*\(([^)]+)\)\s*(?:\/.*)?$/;

function splitHeading(text: string) {
  const m = HEADING.exec(text.trim());
  if (!m) return null;

  const [, datePart, timePart, , descriptor] = m;
  const precision: OccurredPrecision =
    datePart.length === 7 ? "month" : timePart ? "minute" : "day";

  const iso =
    precision === "month"
      ? `${datePart}-01T00:00:00Z`
      : `${datePart}T${timePart ?? "00:00"}:00Z`;

  return { occurredAt: iso, precision, descriptor: (descriptor ?? "").trim() };
}

// Pulls "**Label:** value" blocks, where a block runs until the next bold
// label at the start of a line or the end of the entry.
function extractFields(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\*\*([^*:]+):\*\*[ \t]*/gm;
  const marks: Array<{ label: string; start: number; end: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    marks.push({ label: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }

  for (let i = 0; i < marks.length; i++) {
    const next = marks[i + 1]?.start ?? body.length;
    const value = body.slice(marks[i].end, next).trim();
    // First occurrence wins. Later repeats of a label inside Notes are content.
    if (!out.has(marks[i].label)) out.set(marks[i].label, value);
  }
  return out;
}

export function parseDiary(markdown: string, sourceFile: string): DiaryEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: DiaryEntry[] = [];

  // Locate every level-2 heading, then slice the body between them.
  const heads: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.*)$/.exec(lines[i]);
    if (m) heads.push({ line: i, text: m[1].trim() });
  }

  for (let h = 0; h < heads.length; h++) {
    const parsed = splitHeading(heads[h].text);
    // Headings without a leading date are prose sections, not entries.
    if (!parsed) continue;

    const bodyStart = heads[h].line + 1;
    const bodyEnd = heads[h + 1]?.line ?? lines.length;
    const body = lines.slice(bodyStart, bodyEnd).join("\n").trim();
    const fields = extractFields(body);

    let role: string | null = null;
    let agentName: string | null = null;
    let action = fields.get("Action") ?? "";

    const roleMatch = ROLE_WITH_NAME.exec(parsed.descriptor);
    if (roleMatch) {
      role = roleMatch[1].trim();
      agentName = roleMatch[2].trim();
    }

    // Entries with no Action field (event log lines) use the heading
    // descriptor as the action, so nothing is silently dropped.
    if (!action) action = parsed.descriptor || heads[h].text;

    entries.push({
      heading: heads[h].text,
      occurredAt: parsed.occurredAt,
      occurredPrecision: parsed.precision,
      role,
      agentName,
      action,
      wherePath: fields.get("Where") ?? null,
      status: fields.get("Status") ?? null,
      notes: fields.get("Notes") ?? null,
      sourceFile,
      sourceLine: heads[h].line + 1,
    });
  }

  return entries;
}
