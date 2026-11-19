import { describe, expect, it } from "vitest";
import { changedEdits, figureTables, isCommentaryPath, kindOfFile, whoSaved } from "./commentary";

describe("pack commentary on the page", () => {
  const sections = [{ key: "commentary", title: "Commentary", fields: [{ path: "commentary", heading: "The month", text: "Old." }, { path: "risks.0.description", heading: "Funding", text: "Same." }] }];

  it("sends only what changed", () => {
    expect(changedEdits(sections, { commentary: "New.", "risks.0.description": "Same." })).toEqual([{ path: "commentary", text: "New." }]);
    expect(changedEdits(sections, {})).toEqual([]);
  });

  it("names who saved, and which file was dropped", () => {
    expect(whoSaved("agent:fpa")).toBe("FP&A");
    expect(whoSaved("cfo@example.com")).toBe("cfo@example.com");
    expect(kindOfFile("highlights_2026-10.json")).toBe("highlights");
    expect(kindOfFile("dashboard_2026-10.json")).toBe("dashboard");
    expect(kindOfFile("budget.xlsx")).toBeNull();
  });

  it("shows the figures beside the words, for reading", () => {
    const t = figureTables({ kpis: [{ label: "Cash", value: 125000.5, period: "31 Oct" }], entities: [{ name: "Alpha Ltd", loss_month: -40000, loss_prior: -35000, cash: 9000 }] });
    expect(t.map((x) => x.title)).toEqual(["Key figures", "By company"]);
    expect(t[0].rows[0]).toEqual(["Cash", "125,000.5", "31 Oct"]);
    expect(figureTables(null)).toEqual([]);
  });

  it("lets through only the page's own calls", () => {
    for (const p of ["commentary/import", "commentary/edit", "commentary/approve"]) expect(isCommentaryPath(p), p).toBe(true);
    for (const p of ["commentary", "commentary/2026-10/files", "commentary/approve/x", "journals"]) expect(isCommentaryPath(p), p).toBe(false);
  });
});
