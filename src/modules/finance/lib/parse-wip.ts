// Parses a WIP folder into a work item and its review chain.
//
// See docs/wip-folder-convention.md. Pure: takes the folder's relative path
// and the contents of its two files, returns structured data. No file system,
// so the watcher, the importer and the tests all use the same code.

// Relative and with the .ts extension, not the @/ alias. Node runs this file
// directly for the importer and the watcher: its type stripping resolves
// neither tsconfig path aliases nor extensionless specifiers.
import { parseWipPath, panelForState, type Panel, type WipState } from "./wip-state.ts";

export interface WipManifest {
  ref?: string;
  type?: string;
  entityScope?: "entity" | "group";
  entity?: string | null;
  title?: string;
  amountTotal?: string | number | null;
  currency?: string;
  drafterRole?: string | null;
  drafterEmail?: string | null;
  drafterAgent?: string | null;
  draftedAt?: string | null;
  priority?: string | null;
  dueAt?: string | null;
  blockedOn?: string | null;
}

export interface WipReview {
  reviewedAt: string | null;
  reviewerRole: string;
  outcome: string | null;
  findings: string[];
  nextStep: string | null;
  notes: string | null;
}

export interface WipItem {
  ref: string;
  state: WipState;
  panel: Panel;
  tier: string | null;
  entity: string | null;
  entityScope: "entity" | "group";
  batch: string;
  folderPath: string;
  type: string;
  title: string;
  amountTotal: string | null;
  currency: string;
  drafterRole: string | null;
  drafterEmail: string | null;
  drafterAgent: string | null;
  draftedAt: string | null;
  priority: string | null;
  dueAt: string | null;
  blockedOn: string | null;
  reviews: WipReview[];
}

export class WipParseError extends Error {}

// "## 2026-07-31 14:02 — FC" or "## 2026-07-31 - FC"
const REVIEW_HEADING =
  /^##\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\s*[-–—]\s*(.+?)\s*$/;

const FIELD = /^\*\*([^*:]+):\*\*\s*(.*)$/;

// review.md is append only, oldest first. Each block is one review.
export function parseReviewLog(markdown: string): WipReview[] {
  if (!markdown?.trim()) return [];

  const lines = markdown.split(/\r?\n/);
  const reviews: WipReview[] = [];
  let current: WipReview | null = null;
  let field: string | null = null;

  const push = () => {
    if (current) reviews.push(current);
  };

  for (const line of lines) {
    const heading = REVIEW_HEADING.exec(line);
    if (heading) {
      push();
      const [, date, time, reviewer] = heading;
      current = {
        reviewedAt: `${date}T${time ?? "00:00"}:00Z`,
        reviewerRole: reviewer.trim(),
        outcome: null,
        findings: [],
        nextStep: null,
        notes: null,
      };
      field = null;
      continue;
    }

    if (!current) continue;

    const f = FIELD.exec(line);
    if (f) {
      field = f[1].trim().toLowerCase();
      const value = f[2].trim();
      if (field === "outcome") current.outcome = value || null;
      else if (field === "next step") current.nextStep = value || null;
      else if (field === "notes") current.notes = value || null;
      continue;
    }

    // Bullets under Findings are the findings; prose under Notes extends them.
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet && field === "findings") {
      current.findings.push(bullet[1].trim());
      continue;
    }
    if (line.trim() && field === "notes") {
      current.notes = current.notes ? `${current.notes}\n${line.trim()}` : line.trim();
    }
  }

  push();
  return reviews;
}

// Amounts are kept as strings all the way to the database, which stores them
// as numeric. Parsing to a JavaScript number here would reintroduce the float
// imprecision the money handling exists to avoid.
function normaliseAmount(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(/[^0-9.\-]/g, "");
  if (!text || !/^-?\d*\.?\d+$/.test(text)) return null;
  return text;
}

export function parseWipFolder(opts: {
  relativePath: string;
  manifestJson: string;
  reviewMarkdown?: string;
}): WipItem {
  const parsed = parseWipPath(opts.relativePath);
  if (!parsed) {
    throw new WipParseError(`not a WIP folder path: ${opts.relativePath}`);
  }

  let manifest: WipManifest;
  try {
    manifest = JSON.parse(opts.manifestJson) as WipManifest;
  } catch (e) {
    throw new WipParseError(
      `wip.json in ${opts.relativePath} is not valid JSON: ${(e as Error).message}`
    );
  }

  // ref is identity and cannot be derived from anything that moves, so a
  // folder without one is rejected rather than given a generated id that would
  // change on the next scan.
  if (!manifest.ref) {
    throw new WipParseError(`wip.json in ${opts.relativePath} has no ref`);
  }
  if (!manifest.title) {
    throw new WipParseError(`wip.json in ${opts.relativePath} has no title`);
  }

  // The path is authoritative for entity and scope. The manifest may disagree
  // through a copy-paste, and the path is the thing an operator can see.
  const entity = parsed.entity;
  const entityScope = parsed.entityScope;

  if (manifest.entity && entity && manifest.entity !== entity) {
    throw new WipParseError(
      `wip.json in ${opts.relativePath} claims entity "${manifest.entity}" but sits under "${entity}"`
    );
  }

  return {
    ref: manifest.ref,
    state: parsed.state,
    panel: panelForState(parsed.state),
    tier: parsed.tier,
    entity,
    entityScope,
    batch: parsed.batch,
    folderPath: opts.relativePath.replace(/\\/g, "/"),
    type: manifest.type ?? "month-end",
    title: manifest.title,
    amountTotal: normaliseAmount(manifest.amountTotal),
    currency: manifest.currency ?? "GBP",
    drafterRole: manifest.drafterRole ?? null,
    drafterEmail: manifest.drafterEmail ?? null,
    drafterAgent: manifest.drafterAgent ?? null,
    draftedAt: manifest.draftedAt ?? null,
    priority: manifest.priority ?? null,
    dueAt: manifest.dueAt ?? null,
    blockedOn: manifest.blockedOn ?? null,
    reviews: parseReviewLog(opts.reviewMarkdown ?? ""),
  };
}
