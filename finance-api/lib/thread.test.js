import { describe, expect, it } from "vitest";
import { threadToMessages } from "./thread.js";

describe("threadToMessages", () => {
  it("returns nothing for a new conversation", () => {
    expect(threadToMessages()).toEqual([]);
    expect(threadToMessages([])).toEqual([]);
  });

  it("replays earlier turns as alternating question and answer, oldest first", () => {
    const out = threadToMessages([
      { instruction: "Pull the P&L for August", output: "Revenue 9,725.00", error: null },
      { instruction: "And July?", output: "Revenue 7,650.00", error: null },
    ]);
    expect(out).toEqual([
      { role: "user", content: "Pull the P&L for August" },
      { role: "assistant", content: "Revenue 9,725.00" },
      { role: "user", content: "And July?" },
      { role: "assistant", content: "Revenue 7,650.00" },
    ]);
  });

  // The Messages API rejects an empty assistant turn and requires roles to
  // alternate, so a turn with no output must still produce one.
  it("never emits an empty assistant turn", () => {
    const out = threadToMessages([
      { instruction: "Try this", output: null, error: "401 invalid key" },
      { instruction: "And this", output: null, error: null },
    ]);
    expect(out[1].content).toBe("[This run failed: 401 invalid key]");
    expect(out[3].content).toBe("[No answer was recorded for this run.]");
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });
});
