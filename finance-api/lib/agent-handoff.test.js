import { describe, it, expect } from "vitest";
import { MAX_HOPS, REFUSED_LINE, handoffInstruction, handoffRefusal, isHandoff, recHandoffRefusal } from "./agent-handoff";

describe("handing work up the chain", () => {
  it("lets a clerk hand to the reviewer and the reviewer to the FC", () => {
    expect(handoffRefusal("ap-clerk", "fm2", "Review these", 0)).toBeNull();
    expect(handoffRefusal("fm2", "fc", "One disagreement", 1)).toBeNull();
  });

  it("refuses skipping a tier, going sideways, and the top of the chain", () => {
    expect(handoffRefusal("ap-clerk", "fc", "x", 0)).toMatch(/hands to fm2/);
    expect(handoffRefusal("fm2", "ap-clerk", "x", 0)).toMatch(/hands to fc/);
    expect(handoffRefusal("fc", "fm2", "x", 0)).toMatch(/comes to the CFO/);
    expect(handoffRefusal(null, "fm2", "x", 0)).toMatch(/comes to the CFO/);
  });

  it("needs a note, and stops after the last hop", () => {
    expect(handoffRefusal("ap-clerk", "fm2", " ", 0)).toMatch(/say what/);
    expect(handoffRefusal("fm2", "fc", "x", MAX_HOPS)).toMatch(/as far as it goes/);
  });

  it("marks the run it starts", () => {
    const text = handoffInstruction("ap-clerk", " Review the queue ");
    expect(text).toBe(`Hand-off from AP Clerk: Review the queue

${REFUSED_LINE}`);
    expect(isHandoff(text)).toBe(true);
    expect(isHandoff("A question")).toBe(false);
  });
});

describe("FM1 handing a reconciliation to the FC", () => {
  it("refuses until the rec is with the FC, and says how to fix it", () => {
    expect(recHandoffRefusal("fm1", "fc", "sent_back")).toBe("The reconciliation is still sent back. Prepare it first (submit_rec), then hand off.");
    expect(recHandoffRefusal("fm1", "fc", "in_progress")).toMatch(/still in progress/);
    expect(recHandoffRefusal("fm1", "fc", "with_fc")).toBeNull();
  });

  it("leaves other hand-offs and runs not on a rec alone", () => {
    expect(recHandoffRefusal("fm1", "fm2", "sent_back")).toBeNull();
    expect(recHandoffRefusal("fm2", "fc", "sent_back")).toBeNull();
    expect(recHandoffRefusal("fm1", "fc", null)).toBeNull();
  });

  it("tells the next agent to report a refused step", () => {
    expect(handoffInstruction("fm1", "Prepared")).toContain(REFUSED_LINE);
    expect(isHandoff(handoffInstruction("fm1", "Prepared"))).toBe(true);
  });
});
