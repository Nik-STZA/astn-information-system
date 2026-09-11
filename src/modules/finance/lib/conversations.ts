// Groups agent runs into conversations by following parent_run_id (migration
// 014). A finished run cannot be changed, so a reply is a new run naming the
// one it answers; the chain of those links is the conversation.
//
// Oldest turn first within a conversation, most recently active conversation
// first, so a reply brings its conversation back to the top. A run whose
// parent is outside the loaded list (the API returns the latest 100) starts its
// own group rather than disappearing.

import type { AgentRunRow } from "@/modules/finance/lib/api";

type Linked = Pick<AgentRunRow, "id" | "parent_run_id" | "queued_at">;

export function conversations<T extends Linked>(runs: T[]): T[][] {
  const byId = new Map(runs.map((r) => [r.id, r]));

  const rootOf = (run: T): string => {
    let cur = run;
    const seen = new Set<string>();
    // The seen set only guards against a malformed cycle; the database cannot
    // produce one, because a parent must exist before its follow-up is created.
    while (cur.parent_run_id && byId.has(cur.parent_run_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_run_id) as T;
    }
    return cur.id;
  };

  const groups = new Map<string, T[]>();
  for (const r of runs) {
    const key = rootOf(r);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const byQueued = (a: T, b: T) => a.queued_at.localeCompare(b.queued_at);
  return Array.from(groups.values())
    .map((g) => g.sort(byQueued))
    .sort((a, b) => byQueued(b[b.length - 1], a[a.length - 1]));
}
