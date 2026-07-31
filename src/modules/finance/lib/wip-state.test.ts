import { describe, expect, it } from "vitest";
import {
  canTransition,
  panelForState,
  parseWipPath,
  stateForDecision,
  transitionError,
  WIP_STATES,
  writesToLedger,
  type WipState,
} from "@/modules/finance/lib/wip-state";

describe("parseWipPath", () => {
  it("reads an entity-scoped item", () => {
    const p = parseWipPath("entities/ultraspeed-digital/wip/pending-cfo/vat/2026-07-31-q2-return");
    expect(p).toEqual({
      state: "pending-cfo",
      type: "vat",
      entity: "ultraspeed-digital",
      entityScope: "entity",
      batch: "2026-07-31-q2-return",
    });
  });

  it("reads a group-scoped item", () => {
    const p = parseWipPath("wip/pending-cfo/month-end/2026-07-31-group-pack");
    expect(p?.entity).toBeNull();
    expect(p?.entityScope).toBe("group");
  });

  // Type survives escalation. The previous convention lost it: an AP batch and
  // a VAT return both landed in pending-fc and became indistinguishable.
  it("keeps the type at every state", () => {
    for (const state of ["drafting", "pending-fm", "pending-fc", "pending-cfo"]) {
      const p = parseWipPath(`entities/feldspar-ltd/wip/${state}/ap/2026-07-15-batch`);
      expect(p?.type).toBe("ap");
      expect(p?.state).toBe(state);
    }
  });

  it("reads a sent-back item, with the tier held in review.md rather than the path", () => {
    const p = parseWipPath("entities/feldspar-ltd/wip/sent-back/ap/2026-07-15-batch");
    expect(p?.state).toBe("sent-back");
    expect(p?.type).toBe("ap");
    expect(p?.entity).toBe("feldspar-ltd");
  });

  it("accepts Windows separators", () => {
    const p = parseWipPath("entities\\feldspar-ltd\\wip\\pending-fc\\ap\\2026-06-30-batch");
    expect(p?.state).toBe("pending-fc");
    expect(p?.type).toBe("ap");
    expect(p?.entity).toBe("feldspar-ltd");
  });

  // Terminal work lives outside wip, archived by month, so wip only ever holds
  // live work and the archive does not grow inside the queue.
  it("reads archived work from outside wip", () => {
    const p = parseWipPath("entities/feldspar-ltd/posted/2026/06/ap/2026-06-30-batch");
    expect(p).toEqual({
      state: "posted",
      type: "ap",
      entity: "feldspar-ltd",
      entityScope: "entity",
      batch: "2026-06-30-batch",
      archivedYear: "2026",
      archivedMonth: "06",
    });
  });

  it("reads rejected work the same way", () => {
    const p = parseWipPath("rejected/2026/07/vat/2026-07-31-q2-return");
    expect(p?.state).toBe("rejected");
    expect(p?.entityScope).toBe("group");
    expect(p?.archivedMonth).toBe("07");
  });

  // Finished work inside wip would let the queue and the archive disagree
  // about the same item.
  it("refuses posted or rejected inside wip", () => {
    expect(parseWipPath("wip/posted/ap/2026-06-30-batch")).toBeNull();
    expect(parseWipPath("wip/rejected/ap/2026-06-30-batch")).toBeNull();
  });

  it("refuses a malformed archive path", () => {
    expect(parseWipPath("posted/26/06/ap/batch")).toBeNull();   // short year
    expect(parseWipPath("posted/2026/6/ap/batch")).toBeNull();  // unpadded month
    expect(parseWipPath("posted/2026/06/batch")).toBeNull();    // no type
    expect(parseWipPath("posted/2026/06/ap")).toBeNull();       // no batch
  });

  // The entity comes from the path, so a mix-up cannot happen silently. This
  // is the mis-keying risk the client notes already flag.
  it("takes the entity from the path, not from anywhere else", () => {
    expect(parseWipPath("entities/feldspar-group-holdings/wip/drafting/ap/x")?.entity)
      .toBe("feldspar-group-holdings");
    expect(parseWipPath("entities/ultraspeed-digital/wip/drafting/ap/x")?.entity)
      .toBe("ultraspeed-digital");
  });

  it("rejects anything that is not a WIP path", () => {
    expect(parseWipPath("diary/2026-07.md")).toBeNull();
    expect(parseWipPath("entities/feldspar-ltd/CLAUDE.md")).toBeNull();
    expect(parseWipPath("wip/not-a-state/ap/batch")).toBeNull();
    expect(parseWipPath("wip/pending-cfo/ap")).toBeNull();        // no batch folder
    expect(parseWipPath("wip/pending-cfo/2026-07-x")).toBeNull(); // missing type
    expect(parseWipPath("wip/pending-cfo/not-a-type/batch")).toBeNull();
    expect(parseWipPath("")).toBeNull();
  });
});

describe("panelForState", () => {
  it("puts only CFO-pending work in the decision panel", () => {
    expect(panelForState("pending-cfo")).toBe("awaiting-decision");
    for (const s of WIP_STATES.filter((x) => x !== "pending-cfo")) {
      expect(panelForState(s)).not.toBe("awaiting-decision");
    }
  });

  it("treats upstream review as upstream", () => {
    expect(panelForState("drafting")).toBe("in-progress-upstream");
    expect(panelForState("pending-fm")).toBe("in-progress-upstream");
    expect(panelForState("pending-fc")).toBe("in-progress-upstream");
    expect(panelForState("sent-back")).toBe("in-progress-upstream");
  });

  it("treats finished work as activity", () => {
    expect(panelForState("posted")).toBe("activity");
    expect(panelForState("rejected")).toBe("activity");
  });

  // Every item belongs to exactly one panel, the multi-inbox rule.
  it("assigns every state a panel", () => {
    for (const s of WIP_STATES) expect(panelForState(s)).toBeTruthy();
  });
});

describe("canTransition", () => {
  it("allows the normal route to approval", () => {
    expect(canTransition("drafting", "pending-fm")).toBe(true);
    expect(canTransition("pending-fm", "pending-fc")).toBe(true);
    expect(canTransition("pending-fc", "pending-cfo")).toBe(true);
    expect(canTransition("pending-cfo", "posted")).toBe(true);
  });

  // The CFO is the only approval gate, so nothing else may reach the ledger.
  it("lets nothing but CFO-pending work reach posted", () => {
    const others = WIP_STATES.filter((s) => s !== "pending-cfo") as WipState[];
    for (const s of others) {
      expect(canTransition(s, "posted")).toBe(false);
      expect(canTransition(s, "rejected")).toBe(false);
    }
  });

  // A posted item is in the ledger. Correcting it is a new item, because Xero
  // journals can be voided but never deleted.
  it("makes posted and rejected terminal", () => {
    for (const to of WIP_STATES) {
      expect(canTransition("posted", to)).toBe(false);
      expect(canTransition("rejected", to)).toBe(false);
    }
  });

  it("allows send-back from any review stage and re-entry afterwards", () => {
    expect(canTransition("pending-fm", "sent-back")).toBe(true);
    expect(canTransition("pending-fc", "sent-back")).toBe(true);
    expect(canTransition("pending-cfo", "sent-back")).toBe(true);
    expect(canTransition("sent-back", "pending-cfo")).toBe(true);
  });
});

describe("transitionError", () => {
  it("says nothing when a move is legitimate", () => {
    expect(transitionError("pending-cfo", "posted")).toBeNull();
  });

  it("explains why a posted item cannot move", () => {
    expect(transitionError("posted", "drafting")).toMatch(/ledger/i);
  });

  it("explains that only CFO-pending work can be posted", () => {
    expect(transitionError("drafting", "posted")).toMatch(/only an item awaiting the CFO/i);
  });
});

describe("stateForDecision", () => {
  it("maps each decision to its directory", () => {
    expect(stateForDecision("approve")).toBe("posted");
    expect(stateForDecision("reject")).toBe("rejected");
    expect(stateForDecision("send-back")).toBe("sent-back");
  });

  it("only ever produces a state reachable from pending-cfo", () => {
    for (const d of ["approve", "reject", "send-back"] as const) {
      expect(canTransition("pending-cfo", stateForDecision(d))).toBe(true);
    }
  });
});

describe("writesToLedger", () => {
  it("identifies the types whose approval posts a journal", () => {
    expect(writesToLedger("ap")).toBe(true);
    expect(writesToLedger("vat")).toBe(true);
    expect(writesToLedger("month-end")).toBe(true);
    expect(writesToLedger("tax")).toBe(true);
  });

  it("leaves non-posting types alone", () => {
    expect(writesToLedger("reconciliation")).toBe(false);
    expect(writesToLedger("fpa")).toBe(false);
    expect(writesToLedger("ar")).toBe(false);
    expect(writesToLedger("")).toBe(false);
  });
});
