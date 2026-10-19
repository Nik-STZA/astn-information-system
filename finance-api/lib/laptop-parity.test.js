// The CI parity test: the portal serves every laptop MCP tool. See
// lib/laptop-parity.js. Set LAPTOP_MCP_SERVER to the laptop's xero-server.py
// to also check the snapshot of its tool names is current (not run in CI,
// which cannot see the laptop repository).

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { LAPTOP_PARITY, LAPTOP_TOOLS, routeOf, WRITE_PREFIX } from "./laptop-parity";
import { resolveRead, XERO_READ_REPORTS } from "./xero-read";

process.env.FINANCE_API_KEY = process.env.FINANCE_API_KEY || "parity-test";
process.env.DB_HOST = "127.0.0.1";
process.env.DB_PORT = "65432";
process.env.DB_PASSWORD = "unused";

const GUID = "6306a21a-8684-4fd8-8c71-4180c464b6b9";
let registered;

beforeAll(async () => {
  const { app } = await import("../server.js");
  registered = new Set(
    app._router.stack
      .filter((l) => l.route)
      .flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`))
  );
});

describe("laptop parity", () => {
  it("has an entry for every laptop tool, and none for tools that do not exist", () => {
    expect(Object.keys(LAPTOP_PARITY).sort()).toEqual([...LAPTOP_TOOLS].sort());
  });

  it("gives every entry either routes or a reason Xero refuses it", () => {
    for (const [tool, e] of Object.entries(LAPTOP_PARITY)) {
      const ok = (Array.isArray(e.serves) && e.serves.length > 0) !== Boolean(e.xero_refuses);
      expect(ok, `${tool} must have serves or xero_refuses, not both or neither`).toBe(true);
    }
  });

  it("serves every laptop tool from a registered route", () => {
    const missing = [];
    for (const [tool, e] of Object.entries(LAPTOP_PARITY)) {
      for (const item of e.serves || []) {
        if (!registered.has(routeOf(item))) missing.push(`${tool}: ${routeOf(item)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("resolves every read and report the map relies on", () => {
    const bad = [];
    for (const [tool, e] of Object.entries(LAPTOP_PARITY)) {
      for (const item of e.serves || []) {
        if (item.read) {
          const r = resolveRead({ resource: item.read, id: item.id ? GUID : undefined, sub: item.sub });
          if (!r.ok) bad.push(`${tool}: ${item.read}${item.id ? "/:id" : ""}${item.sub ? `/${item.sub}` : ""} -> ${r.error}`);
        }
        if (item.report && !XERO_READ_REPORTS[item.report]) bad.push(`${tool}: report ${item.report}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("claims every portal write route for a laptop tool", () => {
    const claimed = new Set(Object.values(LAPTOP_PARITY).flatMap((e) => (e.serves || []).map(routeOf)));
    const unclaimed = [...registered].filter((r) => r.startsWith(`POST ${WRITE_PREFIX}`) && !claimed.has(r));
    expect(unclaimed).toEqual([]);
  });

  const laptop = process.env.LAPTOP_MCP_SERVER;
  it.skipIf(!laptop || !existsSync(laptop))("matches the laptop's current tool list", () => {
    const src = readFileSync(laptop, "utf8");
    const names = [...src.matchAll(/@mcp\.tool\(\)\s*\ndef (\w+)/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...LAPTOP_TOOLS].sort());
  });
});
