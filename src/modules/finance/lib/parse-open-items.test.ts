import { describe, expect, it } from "vitest";
import { parseOpenItems } from "@/modules/finance/lib/parse-open-items";

const HEADER = "| # | Item | Owner | Pri | Status | Surfaced | Last update |";
const RULE = "|---|---|---|---|---|---|---|";

describe("parseOpenItems", () => {
  it("reads an active item with its category", () => {
    const md = [
      "## Active items",
      "",
      "### Financial reporting",
      "",
      HEADER,
      RULE,
      "| 1 | DLA documentation | CEO (Alvina) | P1 | Awaiting confirmation | 2026-06-02 | 2026-06-02 |",
    ].join("\n");

    const [item] = parseOpenItems(md, "open-items.md");
    expect(item.ref).toBe("1");
    expect(item.title).toBe("DLA documentation");
    expect(item.category).toBe("Financial reporting");
    expect(item.ownerLabel).toBe("CEO (Alvina)");
    expect(item.priority).toBe("P1");
    expect(item.status).toBe("Awaiting confirmation");
    expect(item.raisedAt).toBe("2026-06-02");
    expect(item.isClosed).toBe(false);
  });

  // The live register resumes a table after a blank line without repeating the
  // header. Items 14 to 18 sit in such a block and were silently dropped by an
  // earlier version of this parser.
  it("keeps reading a table that resumes after a blank line with no header", () => {
    const md = [
      "## Active items",
      "",
      "### Financial reporting",
      "",
      HEADER,
      RULE,
      "| 1 | First item | CFO | P1 | In progress | 2026-06-02 | 2026-06-02 |",
      "",
      "| 14 | Detached item | CFO | P2 | In progress | 2026-06-03 | 2026-06-29 |",
      "| 15 | Another detached | CFO | P2 | Awaiting rebuild | 2026-06-03 | 2026-06-03 |",
    ].join("\n");

    const items = parseOpenItems(md, "open-items.md");
    expect(items.map((i) => i.ref)).toEqual(["1", "14", "15"]);
    expect(items[1].category).toBe("Financial reporting");
    expect(items[2].title).toBe("Another detached");
  });

  it("accepts alphanumeric refs such as 2b and C12", () => {
    const md = [
      "## Active items",
      "### Financial reporting",
      HEADER,
      RULE,
      "| 2b | VAT December return | CFO + CEO | P1 | Blocked | 2026-06-03 | 2026-07-22 |",
    ].join("\n");

    const [item] = parseOpenItems(md, "open-items.md");
    expect(item.ref).toBe("2b");
  });

  it("reads the closed section with its different columns", () => {
    const md = [
      "## Closed / superseded items",
      "",
      "| # | Item | Owner | Closed | Resolution |",
      "|---|---|---|---|---|",
      "| C12 | Balance Control residuals | CFO | 2026-07-13 | RESOLVED. Presentation-only issue. |",
    ].join("\n");

    const [item] = parseOpenItems(md, "open-items.md");
    expect(item.ref).toBe("C12");
    expect(item.isClosed).toBe(true);
    expect(item.closedAt).toBe("2026-07-13");
    expect(item.resolution).toContain("Presentation-only");
    expect(item.status).toBe("Closed");
    expect(item.priority).toBeNull();
  });

  // Item descriptions contain pipes inside inline code and bold markup, which
  // a naive split on "|" over-splits.
  it("does not lose text when a cell contains pipes", () => {
    const md = [
      "## Active items",
      "### Financial reporting",
      HEADER,
      RULE,
      "| 8 | Budget overlay: run `a | b | c` then check | CFO | P2 | DONE | 2026-06-02 | 2026-06-03 |",
    ].join("\n");

    const [item] = parseOpenItems(md, "open-items.md");
    expect(item.ref).toBe("8");
    expect(item.title).toContain("a | b | c");
    expect(item.priority).toBe("P2");
    expect(item.status).toBe("DONE");
    expect(item.raisedAt).toBe("2026-06-02");
  });

  it("separates categories across headings", () => {
    const md = [
      "## Active items",
      "### Financial reporting",
      HEADER,
      RULE,
      "| 1 | Reporting item | CFO | P1 | In progress | 2026-06-02 | 2026-06-02 |",
      "",
      "### HR / payroll structural",
      HEADER,
      RULE,
      "| 9 | EMI scheme registration | CEO + CFO | P2 | Pending | 2026-06-02 | 2026-06-02 |",
    ].join("\n");

    const items = parseOpenItems(md, "open-items.md");
    expect(items[0].category).toBe("Financial reporting");
    expect(items[1].category).toBe("HR / payroll structural");
  });

  it("ignores separator rows and malformed dates", () => {
    const md = [
      "## Active items",
      "### Financial reporting",
      HEADER,
      RULE,
      "| 1 | Item | CFO | P1 | In progress | not-a-date | 2026-06-02 |",
    ].join("\n");

    const items = parseOpenItems(md, "open-items.md");
    expect(items).toHaveLength(1);
    expect(items[0].raisedAt).toBeNull();
    expect(items[0].lastUpdateAt).toBe("2026-06-02");
  });

  it("returns nothing for a register with no tables", () => {
    expect(parseOpenItems("# Register\n\nProse only.", "open-items.md")).toEqual([]);
  });
});
