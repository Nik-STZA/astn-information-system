import { describe, it, expect } from "vitest";
import { MAX_HOPS, handoffInstruction, handoffRefusal, isHandoff } from "./agent-handoff";

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
    expect(text).toBe("Hand-off from AP Clerk: Review the queue");
    expect(isHandoff(text)).toBe(true);
    expect(isHandoff("A question")).toBe(false);
  });
});
