import { describe, it, expect } from "vitest";
import { MAX_BATCH, parseCandidateLines, safeHref } from "@/lib/data/registry-candidates-shared";

describe("pasting candidates", () => {
  it("reads one name per line, with an optional website at the end", () => {
    expect(parseCandidateLines("Acme Sports acme.co.za\n\n  Lagos Hoops  \n").values).toEqual([
      { name: "Acme Sports", website: "acme.co.za" },
      { name: "Lagos Hoops" },
    ]);
  });

  it("reads columns split by | or tabs, keeping a note that contains |", () => {
    expect(parseCandidateLines("Acme | acme.com | Kenya | Rugby | heard at | the summit").values).toEqual([
      { name: "Acme", website: "acme.com", country: "Kenya", sport: "Rugby", note: "heard at | the summit" },
    ]);
    expect(parseCandidateLines("Acme\t\tGhana").values[0]).toEqual({ name: "Acme", website: null, country: "Ghana", sport: null, note: null });
  });

  it("does not take a last word for a website unless it looks like one", () => {
    expect(parseCandidateLines("Team Africa FC").values).toEqual([{ name: "Team Africa FC" }]);
  });

  it("refuses a line with no name and too many lines", () => {
    expect(parseCandidateLines("| acme.com").error).toMatch(/no name/);
    expect(parseCandidateLines(Array.from({ length: MAX_BATCH + 1 }, (_, i) => `Org ${i}`).join("\n")).error).toMatch(/At most/);
  });
});

describe("links", () => {
  it("allows only web links", () => {
    expect(safeHref("acme.com")).toBe("https://acme.com/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
