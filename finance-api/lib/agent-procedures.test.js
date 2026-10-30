import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { library, proceduresFor, systemPrompt, readProcedure, readProcedureTool, toolsFor, PRELOADED } from "./agent-procedures";
import { agentLedger } from "./agent-ledger";
import { NAMES as DOCUMENT_TOOLS } from "./agent-documents";
import { agentWork } from "./agent-work";

const ROLES = ["ap-clerk", "ar-clerk", "fc", "fm1", "fm2", "fpa"];

// Procedures the month-end close names that are still to be written. Remove a
// name here when its file lands; the test then requires it to exist.
const TO_WRITE = ["bank-reconciliation", "accruals-and-prepayments", "revenue-and-deferred-revenue", "fixed-assets"];

// Every tool the runner can offer, read from runner.js itself so this cannot
// drift from it, plus the Work, ledger and procedure tools.
const runnerSrc = fs.readFileSync(path.join(__dirname, "..", "runner.js"), "utf8");
const buildTools = runnerSrc.slice(runnerSrc.indexOf("function buildTools"), runnerSrc.indexOf("// Map tool name"));
const ALL_TOOLS = new Set([
  ...[...buildTools.matchAll(/^\s+name: "([a-z_]+)"/gm)].map((m) => m[1]),
  ...agentWork({}).names,
  ...agentLedger({}).names,
  ...DOCUMENT_TOOLS,
  "read_procedure",
]);

const files = () => {
  const dir = path.join(__dirname, "..", "agents");
  return ["roles", "procedures"].flatMap((d) =>
    fs.readdirSync(path.join(dir, d)).map((f) => ({ file: `${d}/${f}`, text: fs.readFileSync(path.join(dir, d, f), "utf8") })));
};

describe("the agents' library", () => {
  it("has the six roles and the preloaded procedures", () => {
    const { roles, procedures } = library();
    expect(Object.keys(roles).sort()).toEqual(ROLES);
    for (const n of PRELOADED) expect(procedures[n]).toBeDefined();
    for (const p of Object.values(procedures)) {
      expect(p.version, p.name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.summary, p.name).toBeTruthy();
      expect(p.title, p.name).toBeTruthy();
    }
  });

  it("gives each role only tools that exist", () => {
    for (const r of Object.values(library().roles)) {
      expect(r.tools?.length, r.name).toBeGreaterThan(0);
      for (const t of r.tools) expect(ALL_TOOLS.has(t), `${r.name}: ${t}`).toBe(true);
    }
  });

  it("names only procedures that exist", () => {
    const { roles, procedures } = library();
    for (const r of Object.values(roles)) for (const p of r.procedures) expect(procedures[p], `${r.name}: ${p}`).toBeDefined();
    for (const p of Object.values(procedures)) for (const r of p.roles || []) expect(roles[r], `${p.name}: ${r}`).toBeDefined();
  });

  it("refers only to tools and procedures that exist", () => {
    const { procedures } = library();
    for (const { file, text } of files()) {
      for (const [, word] of text.matchAll(/`([a-z][a-z0-9_-]*)`/g)) {
        if (/^(get|list|check|recommend|create|add|update|read)_[a-z_]+$/.test(word)) {
          expect(ALL_TOOLS.has(word), `${file}: tool ${word}`).toBe(true);
        } else if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(word)) {
          expect(Boolean(procedures[word]) || TO_WRITE.includes(word), `${file}: procedure ${word}`).toBe(true);
        }
      }
    }
  });

  it("carries nothing from the laptop or about a named client", () => {
    const banned = [/wip\//i, /clients\//, /CLAUDE\.md/, /\.json\b/, /mcp__/, /I:\\/, /\bdiary\//, /feldspar/i, /ultraspeed/i, /\bFSL-/, /\bFGH-/, /\bUDL\b/, /\bNik\b/];
    for (const { file, text } of files()) for (const re of banned) expect(re.test(text), `${file}: ${re}`).toBe(false);
  });

  it("keeps the drafting tools to the roles that draft", () => {
    const all = [...ALL_TOOLS].map((name) => ({ name }));
    const names = (agent) => toolsFor(agent, all).map((t) => t.name);
    expect(names("fm2")).not.toContain("create_draft_journal");
    expect(names("fm2")).not.toContain("recommend_bill_coding");
    expect(names("fc")).not.toContain("create_draft_journal");
    expect(names("ap-clerk")).toContain("recommend_bill_coding");
    expect(names("fm1")).toContain("create_draft_journal");
    for (const r of ROLES) expect(names(r)).toContain("read_procedure");
    // No role: a general session keeps every tool, as before.
    expect(names(undefined)).toHaveLength(all.length);
  });
});

describe("client rules", () => {
  const addition = { procedure: "vat-return", kind: "addition", body: "This client files monthly under the flat rate scheme." };

  it("puts the controls and the index in the prompt, not every procedure", () => {
    const p = systemPrompt("fm1", "BASE");
    expect(p).toContain("# Practice controls");
    expect(p).toContain("# How work moves");
    expect(p).toContain("- vat-return:");
    expect(p).not.toContain("Treatments that are commonly got wrong");
  });

  it("appends an addition after the standard text, taking precedence", () => {
    const r = readProcedure("fm1", "vat-return", [addition]);
    expect(r.text).toContain("Treatments that are commonly got wrong");
    expect(r.text).toMatch(/## Client rules for this client[\s\S]*take precedence[\s\S]*flat rate scheme/);
    expect(systemPrompt("fm1", "BASE", [addition])).toContain("vat-return: Preparing a VAT");
    expect(proceduresFor("fm1", [addition]).find((p) => p.name === "vat-return").client_rules).toBe(true);
  });

  it("replaces a procedure with the client's own version", () => {
    const r = readProcedure("fm1", "payroll-journal", [{ procedure: "payroll-journal", kind: "replacement", body: "In-house payroll, run weekly." }]);
    expect(r.text).toContain("replacing standard payroll-journal");
    expect(r.text).toContain("In-house payroll, run weekly.");
    expect(r.text).not.toContain("net pay control that clears");
  });

  it("offers a client's own procedure to the roles it names", () => {
    const own = { procedure: "grant-claim", kind: "own", title: "Grant claim", summary: "Quarterly grant claim", body: "Claim costs quarterly.", roles: ["fm1"] };
    expect(proceduresFor("fm1", [own]).map((p) => p.name)).toContain("grant-claim");
    expect(proceduresFor("fpa", [own]).map((p) => p.name)).not.toContain("grant-claim");
    expect(readProcedure("fm1", "grant-claim", [own]).text).toContain("Claim costs quarterly.");
    expect(readProcedureTool("fm1", [own]).input_schema.properties.name.enum).toContain("grant-claim");
  });

  it("adds client rules to the preloaded controls, which a client may only tighten", () => {
    const p = systemPrompt("fc", "BASE", [{ procedure: "practice-controls", kind: "addition", body: "Every journal over £1,000 goes to the CFO individually." }]);
    expect(p).toContain("Every journal over £1,000");
    expect(p).toContain("never loosen them");
  });

  it("refuses a procedure the role cannot open", () => {
    const r = readProcedure("ap-clerk", "vat-return");
    expect(r.error).toMatch(/No procedure/);
    expect(r.available).toContain("bills-coding");
  });
});
