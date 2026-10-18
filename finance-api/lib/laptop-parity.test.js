// The CI parity test: the portal serves every laptop MCP tool. See
// lib/laptop-parity.js. Set LAPTOP_MCP_SERVER to the laptop's xero-server.py
// to also check the snapshot of its tool names is current (not run in CI,
// which cannot see the laptop repository).

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
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

  // The thin client: every practice tool must exist by the laptop's name, and
  // every request it makes must land on a route finance-api registers. Run
  // against a stubbed network, so a renamed route or a mistyped path in the
  // client fails here rather than in front of Nik.
  it("serves every laptop tool from the practice toolset, on registered routes", async () => {
    const { practiceTools } = await import("../mcp-server/practice-tools.js");
    const dir = mkdtempSync(join(tmpdir(), "parity-"));
    const upload = join(dir, "upload.pdf");
    writeFileSync(upload, "%PDF-1.4");
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const u = new URL(url);
      calls.push(`${opts.method || "GET"} ${u.pathname}`);
      const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
      if (u.pathname === "/api/finance/clients") return json({ data: [{ slug: "stza" }] });
      if (u.pathname.endsWith("/entities")) return json({ data: [{ slug: "stza", name: "STZA", connected: true }] });
      if (/\/(pdf|content|attachments\/[^/]+)$/.test(u.pathname)) return new Response(Buffer.from("%PDF"), { status: 200 });
      if (u.pathname.endsWith("/read/organisation")) return json({ Organisations: [{ OrganisationID: GUID }] });
      return json({});
    };
    const sample = (tool, key, schema) => {
      if (key === "entity") return "stza";
      if (key === "out_dir") return dir;
      if (key === "file_path") return upload;
      if (schema.type === "integer") return 1;
      if (schema.type === "boolean") return true;
      if (schema.type === "array") return key === "account_codes" ? ["400"] : [{}];
      if (schema.type === "object") return {};
      const fixed = {
        report_name: "TrialBalance", report: "BudgetSummary", resource_type: "Invoices", kind: "currency",
        what: { get_schedule_data: "budgets", get_payroll_reference: "settings", create_fixed_asset: "asset" }[tool] || "files",
        csv_content: "a,b", file_name: "x.pdf", new_status: "POSTED",
      };
      if (fixed[key]) return fixed[key];
      if (/(^|_)id$/.test(key)) return GUID;
      if (/date/.test(key)) return "2026-09-30";
      return "x";
    };
    try {
      const { tools, handlers } = practiceTools({ apiUrl: "http://api", apiKey: async () => "k", actorEmail: "a@b.c", log: () => {} });
      expect(tools.map((t) => t.name).sort()).toEqual([...LAPTOP_TOOLS].sort());
      const patterns = [...registered].map((r) => {
        const [method, path] = r.split(" ");
        return { r, re: new RegExp(`^${method} ${path.replace(/:[a-z]+/gi, "[^/]+")}$`) };
      });
      const offRoute = [];
      for (const t of tools) {
        if (LAPTOP_PARITY[t.name].xero_refuses) continue;
        const args = {};
        for (const [k, sch] of Object.entries(t.inputSchema.properties)) {
          if (t.inputSchema.required.includes(k) || k === "out_dir") args[k] = sample(t.name, k, sch);
        }
        calls.length = 0;
        await handlers[t.name](args);
        const own = calls.filter((c) => !/^GET \/api\/finance\/clients(\/[^/]+\/entities)?$/.test(c));
        // list_entities is the entity lookup itself, which is filtered out above.
        if (!own.length && t.name !== "list_entities") offRoute.push(`${t.name}: made no call`);
        for (const c of own) if (!patterns.some((p) => p.re.test(c))) offRoute.push(`${t.name}: ${c}`);
      }
      expect(offRoute).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const laptop = process.env.LAPTOP_MCP_SERVER;
  it.skipIf(!laptop || !existsSync(laptop))("matches the laptop's current tool list", () => {
    const src = readFileSync(laptop, "utf8");
    const names = [...src.matchAll(/@mcp\.tool\(\)\s*\ndef (\w+)/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...LAPTOP_TOOLS].sort());
  });
});
