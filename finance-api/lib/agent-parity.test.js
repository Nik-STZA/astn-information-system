import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AGENT_PARITY, toBuild } from "./agent-parity";
import { LAPTOP_PARITY, LAPTOP_TOOLS } from "./laptop-parity";
import { library } from "./agent-procedures";
import { agentLedger } from "./agent-ledger";
import { agentXeroReads } from "./agent-xero-reads";
import { agentWork } from "./agent-work";
import { NAMES as DOCUMENT_TOOLS } from "./agent-documents";
import { NAMES as REC_TOOLS } from "./agent-recs";
import { NAMES as JOURNAL_TOOLS } from "./agent-journals";

// Every tool the runner can offer, read from runner.js and the agent modules.
const runnerSrc = fs.readFileSync(path.join(__dirname, "..", "runner.js"), "utf8");
const buildTools = runnerSrc.slice(runnerSrc.indexOf("function buildTools"), runnerSrc.indexOf("// Map tool name"));
const ALL_TOOLS = new Set([
  ...[...buildTools.matchAll(/^\s+name: "([a-z_]+)"/gm)].map((m) => m[1]),
  ...agentWork({}).names, ...agentLedger({}).names, ...agentXeroReads({}).names,
  ...DOCUMENT_TOOLS, ...REC_TOOLS, ...JOURNAL_TOOLS,
]);
const ROLE_TOOLS = new Set(Object.values(library().roles).flatMap((r) => r.tools || []));
const isWrite = (tool) => (LAPTOP_PARITY[tool]?.serves || []).some((s) => s.write || /^POST /.test(s.route || ""));

describe("agents can do what Cowork can", () => {
  it("has an entry for every Cowork tool, and no others", () => {
    expect(Object.keys(AGENT_PARITY).sort()).toEqual([...LAPTOP_TOOLS].sort());
  });

  it("names only agent tools that exist and that some role is given", () => {
    for (const [tool, e] of Object.entries(AGENT_PARITY)) {
      for (const a of e.agent || []) {
        expect(ALL_TOOLS.has(a), `${tool} -> ${a} is not an agent tool`).toBe(true);
        expect(ROLE_TOOLS.has(a), `${tool} -> ${a} is given to no role`).toBe(true);
      }
      const kinds = ["agent", "xero_refuses", "to_build"].filter((k) => e[k]);
      expect(kinds, tool).toHaveLength(1);
    }
  });

  it("marks as refused only what Xero refuses on the laptop too", () => {
    for (const [tool, e] of Object.entries(AGENT_PARITY)) {
      if (e.xero_refuses) expect(LAPTOP_PARITY[tool]?.xero_refuses, tool).toBeTruthy();
    }
  });

  it("leaves no read unbuilt: only writes may wait", () => {
    for (const { tool, proposal } of toBuild()) {
      expect(isWrite(tool), `${tool} is a read and must have an agent tool`).toBe(true);
      expect(proposal.length, tool).toBeGreaterThan(10);
    }
  });
});
