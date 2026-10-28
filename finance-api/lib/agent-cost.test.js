import { describe, expect, it } from "vitest";
import { NO_USAGE, addUsage, cachedSystem, runCost, withCacheMarker } from "./agent-cost.js";

describe("addUsage", () => {
  it("adds every call's tokens, cached ones separately", () => {
    let t = NO_USAGE;
    t = addUsage(t, { input_tokens: 5000, output_tokens: 300, cache_creation_input_tokens: 8000 });
    t = addUsage(t, { input_tokens: 400, output_tokens: 200, cache_read_input_tokens: 8000 });
    t = addUsage(t, undefined);
    expect(t).toEqual({ input: 5400, output: 500, cacheRead: 8000, cacheWrite: 8000 });
  });
});

describe("runCost", () => {
  it("prices Sonnet 5 at $2 in and $10 out per million", () => {
    expect(runCost("claude-sonnet-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(2);
    expect(runCost("claude-sonnet-5", { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(10);
  });

  it("bills cache reads at a tenth and cache writes at 1.25 times the input price", () => {
    expect(runCost("claude-sonnet-5", { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toBe(0.2);
    expect(runCost("claude-sonnet-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 })).toBe(2.5);
  });

  it("gives no cost for a model it has no price for, rather than a guess", () => {
    expect(runCost("some-other-model", { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});

describe("withCacheMarker", () => {
  it("marks only the newest block, on a copy", () => {
    const messages = [
      { role: "user", content: "Pull the P&L" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] },
    ];
    const out = withCacheMarker(messages);
    expect(out[2].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(out[0]).toBe(messages[0]);
    expect(messages[2].content[0].cache_control).toBeUndefined();
  });

  it("turns a plain-text newest message into a marked text block", () => {
    const out = withCacheMarker([{ role: "user", content: "What is outstanding?" }]);
    expect(out).toEqual([
      { role: "user", content: [{ type: "text", text: "What is outstanding?", cache_control: { type: "ephemeral" } }] },
    ]);
  });

  it("never leaves more than one marker in the messages, however many turns run", () => {
    let messages = [{ role: "user", content: "Start" }];
    for (let turn = 0; turn < 25; turn++) {
      const sent = withCacheMarker(messages);
      const markers = sent.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.cache_control);
      expect(markers).toHaveLength(1);
      messages = [
        ...messages,
        { role: "assistant", content: [{ type: "tool_use", id: `t${turn}`, name: "x", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: `t${turn}`, content: "{}" }] },
      ];
    }
  });
});

describe("cachedSystem", () => {
  it("is one marked text block", () => {
    expect(cachedSystem("You are FC.")).toEqual([{ type: "text", text: "You are FC.", cache_control: { type: "ephemeral" } }]);
  });
});
