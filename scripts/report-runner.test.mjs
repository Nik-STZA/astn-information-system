import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { draftStamp, monthOf, planFor } from "./report-runner.mjs";

describe("report runner plan", () => {
  it("runs Feldspar's documented close command for the month", () => {
    const p = planFor("feldspar-sport-group", "2026-07");
    expect(p.args).toEqual([
      "scripts\\monthly_close.py",
      "--reporting-month", "2026-07",
      "--prior-years", "2023", "2024", "2025",
    ]);
  });

  it("saves drafts under that month's folder on the shared drive", () => {
    const p = planFor("feldspar-sport-group", "2026-07");
    expect(p.folder.endsWith(join("FY26", "2607", "Drafts"))).toBe(true);
  });

  it("names files the way the shared drive already does", () => {
    const p = planFor("feldspar-sport-group", "2026-06");
    expect(p.outputs.map((o) => o.name + o.ext)).toEqual([
      "Feldspar Group - Management Pack - Jun2026.xlsx",
      "Feldspar Group - Board Pack - June 2026.pptx",
    ]);
    expect(p.outputs[0].from.endsWith("Management_Pack_Jun2026.xlsx")).toBe(true);
    expect(p.outputs[1].from.endsWith("Feldspar_Board_Pack_Jun2026.pptx")).toBe(true);
  });

  it("needs the month's highlights and dashboard files first", () => {
    const p = planFor("feldspar-sport-group", "2026-07");
    expect(p.prerequisites.map((f) => f.split(/[\\/]/).pop())).toEqual([
      "highlights_2026-07.json",
      "dashboard_2026-07.json",
    ]);
  });

  it("has no plan for a client without a pipeline", () => {
    expect(planFor("stza", "2026-07")).toBeNull();
  });

  it("rejects a malformed period", () => {
    expect(() => monthOf("2026-13")).toThrow();
    expect(() => monthOf("July")).toThrow();
  });

  it("stamps drafts without characters Windows forbids in file names", () => {
    expect(draftStamp(new Date(2026, 8, 11, 14, 2))).toBe("2026-09-11 1402");
  });
});
