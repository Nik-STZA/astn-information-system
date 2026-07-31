// The WIP state machine.
//
// State is the directory a folder sits in, per docs/wip-folder-convention.md,
// so it is correct by construction rather than a field someone can set wrong.
// This module turns a path into a state, decides which Approvals panel it
// belongs in, and says which transitions are legitimate.
//
// Pure: no file system, no database. The parts that decide what may happen to
// money are the parts worth testing without a Xero account.

export const WIP_STATES = [
  "drafting",
  "pending-fm",
  "pending-fc",
  "pending-cfo",
  "sent-back",
  "posted",
  "rejected",
] as const;

export type WipState = (typeof WIP_STATES)[number];

export const TIERS = ["clerk", "fm1", "fm2", "fc"] as const;
export type Tier = (typeof TIERS)[number];

// The five panels from the brief. Every item belongs to exactly one, the same
// rule as a Gmail multi-inbox: panel is a function of state, never a category
// set by hand.
export type Panel =
  | "awaiting-decision"
  | "blocked-external"
  | "in-progress-upstream"
  | "upcoming"
  | "activity";

const PANEL_BY_STATE: Record<WipState, Panel> = {
  drafting: "in-progress-upstream",
  "pending-fm": "in-progress-upstream",
  "pending-fc": "in-progress-upstream",
  "pending-cfo": "awaiting-decision",
  "sent-back": "in-progress-upstream",
  posted: "activity",
  rejected: "activity",
};

export const WIP_TYPES = [
  "ap",
  "ar",
  "vat",
  "month-end",
  "reconciliation",
  "tax",
  "fpa",
] as const;

export type WipType = (typeof WIP_TYPES)[number];

export interface ParsedWipPath {
  state: WipState;
  type: WipType;
  /** Entity slug, or null for group-scoped work. */
  entity: string | null;
  entityScope: "entity" | "group";
  /** The batch folder name. Descriptive only, never identity. */
  batch: string;
  /** Present only for posted and rejected work, which is archived by month. */
  archivedYear?: string;
  archivedMonth?: string;
}

// entities/<entity>/wip/<state>/<type>/<batch>  or  wip/<state>/<type>/<batch>
//
// Both attributes are in the path deliberately. State is there because it
// changes and must never be able to disagree with itself: it IS the location.
// Type is there because losing it on escalation is what the previous
// convention did, leaving an AP batch and a VAT return indistinguishable once
// both reached the same review tier.
//
// The tier a sent-back item went to is not in the path. It is a property of
// the last review rather than a place, review.md already records it, and
// putting it here would make the tree four deep.
// Terminal work sits outside wip, so wip only ever holds live work and the
// archive never grows inside the queue. Nothing in wip is finished, by
// construction.
const ARCHIVE_STATES: readonly WipState[] = ["posted", "rejected"];

export function parseWipPath(relativePath: string): ParsedWipPath | null {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);

  let entity: string | null = null;
  let rest = parts;

  if (parts[0] === "entities") {
    if (parts.length < 4) return null;
    entity = parts[1];
    rest = parts.slice(2);
  }

  const entityScope: "entity" | "group" = entity ? "entity" : "group";
  const head = rest[0] as WipState;

  // Archived: <posted|rejected>/<YYYY>/<MM>/<type>/<batch>
  if (ARCHIVE_STATES.includes(head)) {
    const [, year, month, archivedType, archivedBatch] = rest;
    if (!/^[0-9]{4}$/.test(year ?? "")) return null;
    if (!/^[0-9]{2}$/.test(month ?? "")) return null;
    if (!WIP_TYPES.includes(archivedType as WipType)) return null;
    if (!archivedBatch) return null;

    return {
      state: head,
      type: archivedType as WipType,
      entity,
      entityScope,
      batch: archivedBatch,
      archivedYear: year,
      archivedMonth: month,
    };
  }

  // Live: wip/<state>/<type>/<batch>
  if (rest[0] !== "wip") return null;

  const state = rest[1] as WipState;
  if (!WIP_STATES.includes(state)) return null;
  // Finished work in wip would let the queue and the archive disagree about
  // the same item.
  if (ARCHIVE_STATES.includes(state)) return null;

  const type = rest[2] as WipType;
  if (!WIP_TYPES.includes(type)) return null;
  if (!rest[3]) return null;

  return { state, type, entity, entityScope, batch: rest[3] };
}

export function panelForState(state: WipState): Panel {
  return PANEL_BY_STATE[state];
}

// Legitimate moves. Deliberately restrictive: anything not listed is a bug or
// a hand edit, and should be surfaced rather than accepted.
//
// Only pending-cfo reaches posted or rejected, because the CFO is the sole
// approval gate. Nothing leaves posted: a posted item is in the ledger, and
// correcting it is a new item, not a state change.
const ALLOWED: Record<WipState, readonly WipState[]> = {
  drafting: ["pending-fm", "pending-fc", "pending-cfo"],
  "pending-fm": ["pending-fc", "sent-back", "pending-cfo"],
  "pending-fc": ["pending-cfo", "sent-back"],
  "pending-cfo": ["posted", "rejected", "sent-back"],
  "sent-back": ["drafting", "pending-fm", "pending-fc", "pending-cfo"],
  posted: [],
  rejected: [],
};

export function canTransition(from: WipState, to: WipState): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function transitionError(from: WipState, to: WipState): string | null {
  if (canTransition(from, to)) return null;
  if (from === "posted") {
    return "A posted item is in the ledger. Correct it with a new item rather than moving this one.";
  }
  if (from === "rejected") {
    return "A rejected item is closed. Raise a new item rather than reopening this one.";
  }
  if (to === "posted" || to === "rejected") {
    return `Only an item awaiting the CFO can be ${to}. This one is ${from}.`;
  }
  return `Cannot move an item from ${from} to ${to}.`;
}

/** Which state directory an approval decision moves the folder to. */
export function stateForDecision(decision: "approve" | "reject" | "send-back"): WipState {
  switch (decision) {
    case "approve":
      return "posted";
    case "reject":
      return "rejected";
    case "send-back":
      return "sent-back";
  }
}

/** Types whose approval writes to the ledger. */
const LEDGER_TYPES = new Set(["ap", "vat", "month-end", "tax"]);

export function writesToLedger(type: string): boolean {
  return LEDGER_TYPES.has(type);
}
