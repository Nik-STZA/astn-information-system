import { describe, it, expect } from "vitest";
import { conversations } from "@/modules/finance/lib/conversations";

const run = (id: string, queued_at: string, parent_run_id: string | null = null) => ({
  id,
  parent_run_id,
  queued_at,
});

describe("conversations", () => {
  it("puts follow-ups under their root, oldest turn first", () => {
    // The API returns newest first, so feed it that way.
    const out = conversations([
      run("c", "2026-09-11T12:10:00Z", "b"),
      run("b", "2026-09-11T12:05:00Z", "a"),
      run("a", "2026-09-11T12:00:00Z"),
    ]);
    expect(out.map((g) => g.map((r) => r.id))).toEqual([["a", "b", "c"]]);
  });

  it("brings a conversation with a new reply back to the top", () => {
    const out = conversations([
      run("new", "2026-09-11T11:00:00Z"),
      run("old", "2026-09-10T09:00:00Z"),
      run("reply", "2026-09-11T12:00:00Z", "old"),
    ]);
    expect(out.map((g) => g[0].id)).toEqual(["old", "new"]);
  });

  it("keeps a follow-up whose parent was not loaded as its own conversation", () => {
    const out = conversations([run("x", "2026-09-11T12:00:00Z", "not-loaded")]);
    expect(out.map((g) => g.map((r) => r.id))).toEqual([["x"]]);
  });

  it("does not loop forever on a malformed cycle", () => {
    const out = conversations([
      run("p", "2026-09-11T12:00:00Z", "q"),
      run("q", "2026-09-11T12:01:00Z", "p"),
    ]);
    expect(out.flat().map((r) => r.id).sort()).toEqual(["p", "q"]);
  });
});
