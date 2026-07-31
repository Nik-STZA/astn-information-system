import { describe, expect, it } from "vitest";
import { parseReviewLog, parseWipFolder, WipParseError } from "@/modules/finance/lib/parse-wip";

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    ref: "b2b0c7e4-0000-4000-8000-000000000001",
    type: "vat",
    title: "VAT return, quarter ended 30 June 2026",
    amountTotal: "18420.50",
    currency: "GBP",
    drafterRole: "FM2",
    draftedAt: "2026-07-31T09:14:00Z",
    ...over,
  });

const PATH = "entities/ultraspeed-digital/wip/pending-cfo/vat/2026-07-31-q2-return";

describe("parseWipFolder", () => {
  it("reads a folder into a work item", () => {
    const item = parseWipFolder({ relativePath: PATH, manifestJson: manifest() });
    expect(item.ref).toBe("b2b0c7e4-0000-4000-8000-000000000001");
    expect(item.state).toBe("pending-cfo");
    expect(item.panel).toBe("awaiting-decision");
    expect(item.entity).toBe("ultraspeed-digital");
    expect(item.entityScope).toBe("entity");
    expect(item.title).toBe("VAT return, quarter ended 30 June 2026");
    expect(item.type).toBe("vat");
  });

  // Amounts stay as strings the whole way to a numeric column. Parsing to a
  // JavaScript number here would put back the float imprecision the money
  // handling exists to avoid.
  it("keeps the amount as a string", () => {
    const item = parseWipFolder({ relativePath: PATH, manifestJson: manifest() });
    expect(item.amountTotal).toBe("18420.50");
    expect(typeof item.amountTotal).toBe("string");
  });

  it("strips currency symbols and separators from the amount", () => {
    const item = parseWipFolder({
      relativePath: PATH,
      manifestJson: manifest({ amountTotal: "£1,705,710.49" }),
    });
    expect(item.amountTotal).toBe("1705710.49");
  });

  it("treats an unusable amount as absent rather than zero", () => {
    for (const bad of ["", null, "n/a", undefined]) {
      const item = parseWipFolder({
        relativePath: PATH,
        manifestJson: manifest({ amountTotal: bad }),
      });
      expect(item.amountTotal).toBeNull();
    }
  });

  it("reads a group-scoped item", () => {
    const item = parseWipFolder({
      relativePath: "wip/pending-cfo/month-end/2026-07-31-group-pack",
      manifestJson: manifest({ type: "month-end" }),
    });
    expect(item.entity).toBeNull();
    expect(item.entityScope).toBe("group");
  });

  // The path is what an operator can see. A manifest disagreeing with it is a
  // copy-paste, and the entity is exactly what must not be got wrong.
  it("refuses a manifest whose entity contradicts its path", () => {
    expect(() =>
      parseWipFolder({
        relativePath: PATH,
        manifestJson: manifest({ entity: "feldspar-group-holdings" }),
      })
    ).toThrow(/claims entity/);
  });

  it("accepts a manifest whose entity agrees with its path", () => {
    const item = parseWipFolder({
      relativePath: PATH,
      manifestJson: manifest({ entity: "ultraspeed-digital" }),
    });
    expect(item.entity).toBe("ultraspeed-digital");
  });

  // Identity cannot be generated, because a generated id would change on the
  // next scan and detach the item from its own history.
  it("refuses a folder with no ref", () => {
    expect(() =>
      parseWipFolder({ relativePath: PATH, manifestJson: JSON.stringify({ title: "x" }) })
    ).toThrow(WipParseError);
  });

  it("refuses a folder with no title", () => {
    expect(() =>
      parseWipFolder({ relativePath: PATH, manifestJson: JSON.stringify({ ref: "r" }) })
    ).toThrow(/no title/);
  });

  it("refuses malformed json rather than skipping the folder silently", () => {
    expect(() => parseWipFolder({ relativePath: PATH, manifestJson: "{not json" })).toThrow(
      /not valid JSON/
    );
  });

  it("refuses a path that is not a WIP folder", () => {
    expect(() =>
      parseWipFolder({ relativePath: "diary/2026-07.md", manifestJson: manifest() })
    ).toThrow(/not a WIP folder/);
  });

  it("reads a sent-back item", () => {
    const item = parseWipFolder({
      relativePath: "entities/feldspar-ltd/wip/sent-back/ap/2026-07-15-batch",
      manifestJson: manifest({ type: "ap" }),
    });
    expect(item.state).toBe("sent-back");
    expect(item.type).toBe("ap");
    expect(item.panel).toBe("in-progress-upstream");
  });

  // Same rule as the entity, and for the same reason: the path is what an
  // operator can see, so a manifest disagreeing with it is a copy-paste.
  it("refuses a manifest whose type contradicts its path", () => {
    expect(() =>
      parseWipFolder({ relativePath: PATH, manifestJson: manifest({ type: "ap" }) })
    ).toThrow(/claims type/);
  });
});

describe("parseReviewLog", () => {
  const log = [
    "## 2026-07-30 11:20 — FM2",
    "",
    "**Outcome:** Submitted",
    "**Notes:** Prepared from the July ledger.",
    "",
    "## 2026-07-31 14:02 — FC",
    "",
    "**Outcome:** Sent back",
    "**Findings:**",
    "- Box 6 excludes the July credit note",
    "- Reverse charge not applied to the EU supplier",
    "**Next step:** FM2 to re-run and resubmit",
  ].join("\n");

  it("reads each review oldest first", () => {
    const reviews = parseReviewLog(log);
    expect(reviews).toHaveLength(2);
    expect(reviews[0].reviewerRole).toBe("FM2");
    expect(reviews[1].reviewerRole).toBe("FC");
  });

  it("reads findings as a list", () => {
    const [, fc] = parseReviewLog(log);
    expect(fc.findings).toEqual([
      "Box 6 excludes the July credit note",
      "Reverse charge not applied to the EU supplier",
    ]);
    expect(fc.outcome).toBe("Sent back");
    expect(fc.nextStep).toBe("FM2 to re-run and resubmit");
  });

  it("keeps the time when given and defaults when not", () => {
    expect(parseReviewLog(log)[1].reviewedAt).toBe("2026-07-31T14:02:00Z");
    expect(parseReviewLog("## 2026-07-31 - FC\n\n**Outcome:** Approved").at(0)?.reviewedAt).toBe(
      "2026-07-31T00:00:00Z"
    );
  });

  it("accepts an em dash or a hyphen, as the diary format does", () => {
    expect(parseReviewLog("## 2026-07-31 — FC\n**Outcome:** Approved")).toHaveLength(1);
    expect(parseReviewLog("## 2026-07-31 - FC\n**Outcome:** Approved")).toHaveLength(1);
  });

  it("returns nothing for an empty or absent log", () => {
    expect(parseReviewLog("")).toEqual([]);
    expect(parseReviewLog("   ")).toEqual([]);
    expect(parseReviewLog("Some prose with no headings")).toEqual([]);
  });

  it("does not attribute findings to the wrong review", () => {
    const reviews = parseReviewLog(log);
    expect(reviews[0].findings).toEqual([]);
    expect(reviews[1].findings).toHaveLength(2);
  });
});

// The drafting agent writes wip.json. If it could also write the field that
// decides how closely its own work is read, the approval gate would have a
// self-service bypass. Same principle as posting tools being physically absent
// rather than forbidden by instruction.
describe("approval routing is derived, not declared", () => {
  const config = {
    version: 1,
    currency: "GBP",
    clientThreshold: "25000.00",
    trivialDifference: "50.00",
    typeRules: { vat: { class: "mechanical" as const, threshold: "5000.00" } },
  };

  it("refuses a manifest that classifies its own work", () => {
    for (const field of ["routingClass", "class", "materiality"]) {
      expect(() =>
        parseWipFolder({ relativePath: PATH, manifestJson: manifest({ [field]: "mechanical" }) })
      ).toThrow(WipParseError);
    }
  });

  it("names the field it refused, so the author knows what to remove", () => {
    expect(() =>
      parseWipFolder({ relativePath: PATH, manifestJson: manifest({ routingClass: "mechanical" }) })
    ).toThrow(/routingClass/);
  });

  it("derives the class from the client config", () => {
    const item = parseWipFolder({
      relativePath: PATH,
      manifestJson: manifest(),
      routingConfig: config,
    });
    // 18,420.50 against VAT's 5,000 threshold.
    expect(item.routingClass).toBe("judgement");
    expect(item.routingReason).toContain("5000.00");
  });

  it("routes everything individually when the client has no config", () => {
    const item = parseWipFolder({ relativePath: PATH, manifestJson: manifest() });
    expect(item.routingClass).toBe("judgement");
    expect(item.routingReason).toContain("no routing config");
  });
});
