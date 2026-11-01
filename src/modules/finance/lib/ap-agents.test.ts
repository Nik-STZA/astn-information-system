import { describe, expect, it } from "vitest";
import { activeAgents, billProgress, isStep } from "./ap-agents";

const bill = (over = {}) => ({ state: "exception" as const, recommended: false, review_verdict: null, review_agents: [], ...over });
const states = (p: ReturnType<typeof billProgress>) => p.steps.map((s) => `${s.key}:${s.state}`).join(" ");

describe("billProgress", () => {
  it("puts an uncoded bill with the AP Clerk while it is running", () => {
    const p = billProgress(bill(), ["ap-clerk"]);
    expect(p).toMatchObject({ withAgents: true, current: "ap" });
    expect(states(p)).toBe("ap:now fm2:todo");
  });

  it("leaves a bill with the CFO when the agent it waits on is not running", () => {
    expect(billProgress(bill(), []).withAgents).toBe(false);
    expect(billProgress(bill({ recommended: true }), ["ap-clerk"]).withAgents).toBe(false);
  });

  it("moves a coded bill to FM2", () => {
    const p = billProgress(bill({ recommended: true }), ["fm2"]);
    expect(p.current).toBe("fm2");
    expect(states(p)).toBe("ap:done fm2:now");
  });

  it("shows the FC only when it is involved", () => {
    const reviewed = bill({ recommended: true, review_verdict: "disagree", review_agents: ["fm2"] });
    expect(states(billProgress(reviewed, []))).toBe("ap:done fm2:done");
    expect(billProgress(reviewed, []).withAgents).toBe(false);
    const p = billProgress(reviewed, ["fc"]);
    expect(p.current).toBe("fc");
    expect(states(p)).toBe("ap:done fm2:done fc:now");
    expect(states(billProgress({ ...reviewed, review_agents: ["fm2", "fc"] }, []))).toBe("ap:done fm2:done fc:done");
  });

  it("reads a review with no agent recorded as FM2's", () => {
    expect(billProgress(bill({ recommended: true, review_verdict: "agree" }), ["fm2"]).withAgents).toBe(false);
  });

  it("never puts a finished bill with the agents", () => {
    expect(billProgress(bill({ state: "written", recommended: false }), ["ap-clerk"]).withAgents).toBe(false);
    expect(billProgress(bill({ state: "rejected", recommended: true }), ["fm2"]).withAgents).toBe(false);
  });
});

describe("activeAgents and isStep", () => {
  it("counts only queued and running agents", () => {
    expect(activeAgents([{ agent: "fm2", status: "running" }, { agent: "fc", status: "queued" },
      { agent: "ap-clerk", status: "succeeded" }, { agent: null, status: "running" }])).toEqual(["fm2", "fc"]);
  });

  it("accepts only the three steps", () => {
    expect(isStep("fm2")).toBe(true);
    expect(isStep("x")).toBe(false);
    expect(isStep(undefined)).toBe(false);
  });
});
