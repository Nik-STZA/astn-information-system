import { describe, expect, it } from "vitest";
import { approvalFromThread } from "./draft-approval.js";

const proposal = {
  id: "p1",
  output:
    "Proposed journal (draft) for STZA, dated 2026-08-31.\n" +
    "Dr 493 Travel - National 20,000.00\nCr 805 Accruals (20,000.00)\nReply approved to create it.",
};
const reply = (instruction) => ({
  id: "r1",
  instruction,
  requested_by_email: "nik@stza.io",
  queued_at: "2026-09-11T13:40:00.000Z",
});

describe("approvalFromThread", () => {
  it("builds the approval from what was shown and what was said, verbatim", () => {
    const out = approvalFromThread({ current: reply("Approved"), parent: proposal });
    expect(out.approval).toEqual({
      approved_by: "nik@stza.io",
      approved_at: "2026-09-11T13:40:00.000Z",
      presented_text: proposal.output,
      agreed_text: "Approved",
    });
  });

  it("accepts other plain approvals", () => {
    for (const said of ["yes, create the draft", "Go ahead", "ok", "Confirmed"]) {
      expect(approvalFromThread({ current: reply(said), parent: proposal }).approval).toBeDefined();
    }
  });

  it("refuses without an earlier proposal", () => {
    expect(approvalFromThread({ current: reply("approved"), parent: null }).error).toMatch(/No approval yet/);
  });

  it("refuses when the earlier answer is empty", () => {
    expect(approvalFromThread({ current: reply("approved"), parent: { output: "" } }).error).toMatch(/empty/);
  });

  // The proposal must be approved as shown. A change means a new proposal.
  it("refuses a reply that asks for a change", () => {
    for (const said of ["approved but use 494", "Use 494 instead", "no", "change the date"]) {
      expect(approvalFromThread({ current: reply(said), parent: proposal }).error).toMatch(/not a plain approval/);
    }
  });

  it("refuses a reply that says nothing about approving", () => {
    expect(approvalFromThread({ current: reply("what is the accruals balance?"), parent: proposal }).error)
      .toMatch(/not a plain approval/);
  });
});
