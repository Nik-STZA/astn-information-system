import { describe, expect, it } from "vitest";
import { parseDiary } from "@/modules/finance/lib/parse-diary";

// The heading variants below are all taken from the live Feldspar diary. They
// are the reason this parser exists in the shape it does, so each one is
// pinned here.

describe("parseDiary", () => {
  it("reads a dated entry with a role and name", () => {
    const md = [
      "# Diary",
      "",
      "## 2026-06-02 - CFO (Nik) / STZA Fractional FD",
      "",
      "**Action:** Month-end review.",
      "",
      "**Status:** Complete.",
    ].join("\n");

    const [entry] = parseDiary(md, "diary/2026-06.md");
    expect(entry.occurredAt).toBe("2026-06-02T00:00:00Z");
    expect(entry.occurredPrecision).toBe("day");
    expect(entry.role).toBe("CFO");
    expect(entry.agentName).toBe("Nik");
    expect(entry.action).toBe("Month-end review.");
    expect(entry.status).toBe("Complete.");
    expect(entry.sourceFile).toBe("diary/2026-06.md");
  });

  it("keeps the time when the heading carries one", () => {
    const md = "## 2026-05-28 09:30 - CFO (Nik) / STZA Fractional FD\n\n**Action:** Pull TB.";
    const [entry] = parseDiary(md, "diary/2026-05.md");
    expect(entry.occurredAt).toBe("2026-05-28T09:30:00Z");
    expect(entry.occurredPrecision).toBe("minute");
  });

  // A month-only heading must not become the first of the month, or the UI
  // would state a date that the source never claimed.
  it("marks a month-only heading as month precision", () => {
    const md = "## 2026-04 - PEAK Las Vegas (Alvina, Tim)\n\nEvent note.";
    const [entry] = parseDiary(md, "diary/2026-04.md");
    expect(entry.occurredPrecision).toBe("month");
    expect(entry.occurredAt).toBe("2026-04-01T00:00:00Z");
  });

  it("accepts both an em dash and a hyphen as the separator", () => {
    const withEmDash = parseDiary("## 2026-06-02 — CFO (Nik) / STZA\n\n**Action:** A.", "d.md");
    const withHyphen = parseDiary("## 2026-06-02 - CFO (Nik) / STZA\n\n**Action:** A.", "d.md");
    expect(withEmDash).toHaveLength(1);
    expect(withHyphen).toHaveLength(1);
    expect(withEmDash[0].role).toBe("CFO");
    expect(withHyphen[0].role).toBe("CFO");
  });

  it("handles parenthetical qualifiers in the heading", () => {
    const md = [
      "## 2026-06-02 (later) - CFO (Nik) / STZA",
      "",
      "**Action:** Second session.",
      "",
      "## 2026-07-22 (Tue, continued) - Pack restructure",
      "",
      "**Action:** Restructure.",
    ].join("\n");

    const entries = parseDiary(md, "diary/2026-06.md");
    expect(entries).toHaveLength(2);
    expect(entries[0].occurredAt).toBe("2026-06-02T00:00:00Z");
    expect(entries[1].occurredAt).toBe("2026-07-22T00:00:00Z");
  });

  // The file month is not authoritative: diary/2026-06.md really does contain
  // entries dated in July.
  it("takes the date from the heading, not the filename", () => {
    const md = "## 2026-07-13 (Mon) - Balance Control residuals closed\n\n**Action:** Closed.";
    const [entry] = parseDiary(md, "diary/2026-06.md");
    expect(entry.occurredAt).toBe("2026-07-13T00:00:00Z");
  });

  it("ignores headings that are prose rather than entries", () => {
    const md = [
      "## Logging convention",
      "",
      "Some explanation.",
      "",
      "## Carry-forward to May",
      "",
      "More prose.",
      "",
      "## 2026-04-30 - Group intercompany reconciliation",
      "",
      "**Action:** Reconciled.",
    ].join("\n");

    const entries = parseDiary(md, "diary/2026-04.md");
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("Reconciled.");
  });

  it("falls back to the heading text when there is no Action field", () => {
    const md = "## 2026-04-30 - Group intercompany reconciliation\n\nNo bold fields here.";
    const [entry] = parseDiary(md, "diary/2026-04.md");
    expect(entry.action).toBe("Group intercompany reconciliation");
    expect(entry.role).toBeNull();
  });

  it("captures each field up to the next bold label", () => {
    const md = [
      "## 2026-06-02 - CFO (Nik) / STZA",
      "",
      "**Action:** Did the thing.",
      "",
      "**Where:**",
      "- path/one.xlsx",
      "- path/two.xlsx",
      "",
      "**Status:** Done.",
      "",
      "**Notes:**",
      "",
      "### A subsection",
      "Detail here.",
    ].join("\n");

    const [entry] = parseDiary(md, "d.md");
    expect(entry.action).toBe("Did the thing.");
    expect(entry.wherePath).toContain("path/one.xlsx");
    expect(entry.wherePath).toContain("path/two.xlsx");
    expect(entry.wherePath).not.toContain("Done.");
    expect(entry.status).toBe("Done.");
    expect(entry.notes).toContain("A subsection");
  });

  it("returns nothing for a file with no dated headings", () => {
    expect(parseDiary("# Title\n\nJust prose.", "d.md")).toEqual([]);
  });

  it("records the line number of each heading for provenance", () => {
    const md = ["# Diary", "", "## 2026-06-02 - CFO (Nik) / STZA", "", "**Action:** A."].join("\n");
    const [entry] = parseDiary(md, "d.md");
    expect(entry.sourceLine).toBe(3);
  });
});
