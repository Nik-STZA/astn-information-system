import { describe, it, expect } from "vitest";
import {
  normaliseWebsite, domainOf, normaliseName, parseSubmission, parseBatch, similarity,
  rankMatches, searchTerms, nextAstnId, bandOf, validateProposal, validateVerdict,
  cleanEvidence, approvalNote, MAX_BATCH,
} from "./registry-candidates";

const refs = {
  countries: new Map([["NG", "Nigeria"], ["ZA", "South Africa"]]),
  sports: new Map([["FTB", "Football"], ["MSP", "Multi-Sport"]]),
};

const goodProposal = {
  organization_name: "Example Football Analytics",
  country_iso: "ng",
  sport_code: "FTB",
  level: "Sports Tech Startup",
  organization_type: "Sports Tech Startup",
  astn_vertical: "Performance & Elite Sport",
  organization_website: "example-fa.com/",
  founded_year: 2023,
  operational_status: "active",
  source_confidence: "Medium-High (website + LinkedIn)",
  verification_source: "website_check + linkedin",
  notes: "Football analytics platform, Lagos.",
};

describe("websites", () => {
  it("adds https, lower-cases the host and drops the trailing slash", () => {
    expect(normaliseWebsite("Example.COM/")).toBe("https://example.com");
    expect(normaliseWebsite("http://www.example.com/about/")).toBe("https://www.example.com/about");
  });

  it("refuses what is not a web address", () => {
    expect(normaliseWebsite("not a site")).toBeNull();
    expect(normaliseWebsite("ftp://example.com")).toBeNull();
    expect(normaliseWebsite("localhost")).toBeNull();
    expect(normaliseWebsite("")).toBeNull();
  });

  it("compares sites by domain without www", () => {
    expect(domainOf("https://www.example.com/x")).toBe("example.com");
  });
});

describe("submissions", () => {
  it("needs only a name and cleans the rest", () => {
    expect(parseSubmission({ name: "  Acme  Sports " }).value).toEqual({
      name: "Acme Sports", website: null, country: null, sport: null, note: null,
    });
  });

  it("refuses a missing name or a bad website, naming the entry", () => {
    expect(parseSubmission({ name: " " }).error).toMatch(/name is required/);
    expect(parseSubmission({ name: "Acme", website: "not a site" }).error).toMatch(/Acme.*not a web address/);
  });

  it("limits a batch", () => {
    expect(parseBatch([]).error).toMatch(/nothing/);
    expect(parseBatch(Array.from({ length: MAX_BATCH + 1 }, () => ({ name: "x" }))).error).toMatch(/at most/);
    expect(parseBatch([{ name: "A" }, { name: "B" }]).values).toHaveLength(2);
  });
});

describe("duplicate check", () => {
  it("ignores company-form words and accents in names", () => {
    expect(normaliseName("The Acmé Sports (Pty) Ltd")).toBe("acme sports");
  });

  it("treats the same website as decisive", () => {
    const s = similarity({ name: "Totally Different", website: "acme.com" }, { organization_name: "Acme", organization_website: "https://www.acme.com" });
    expect(s.score).toBe(1);
    expect(s.reasons[0]).toMatch(/same website/);
  });

  it("scores the same name highly and partial overlap lower", () => {
    expect(similarity({ name: "Acme Sports Ltd" }, { organization_name: "Acme Sports" }).score).toBe(0.95);
    const partial = similarity({ name: "Acme Sports Lagos" }, { organization_name: "Acme Sports" });
    expect(partial.score).toBeGreaterThan(0.5);
    expect(partial.score).toBeLessThan(0.95);
    expect(similarity({ name: "Zebra Golf" }, { organization_name: "Acme Sports" }).score).toBe(0);
  });

  it("keeps likely matches only, best first", () => {
    const rows = [
      { id: "1", astn_id: "NG-FTB-0001", organization_name: "Acme Sports Lagos" },
      { id: "2", astn_id: "NG-FTB-0002", organization_name: "Acme Sports" },
      { id: "3", astn_id: "NG-FTB-0003", organization_name: "Unrelated Club" },
    ];
    const m = rankMatches({ name: "Acme Sports" }, rows);
    expect(m.map((r) => r.organization_id)).toEqual(["2", "1"]);
    expect(m[0].why).toBe("same name");
  });

  it("searches on words long enough to mean something", () => {
    expect(searchTerms("The Acme FC Sports Ltd")).toEqual(["acme", "sports"]);
  });
});

describe("ASTN IDs and confidence bands", () => {
  it("numbers from the highest in use, zero-padded", () => {
    expect(nextAstnId("NG", "FTB", 170)).toBe("NG-FTB-0171");
    expect(nextAstnId("ZA", "MSP", null)).toBe("ZA-MSP-0001");
  });

  it("reads Medium-High and Medium-Low before Medium", () => {
    expect(bandOf("Medium-High (website)")).toBe("Medium-High");
    expect(bandOf("Medium-Low")).toBe("Medium-Low");
    expect(bandOf("medium")).toBe("Medium");
    expect(bandOf("Probably fine")).toBeNull();
  });
});

describe("proposals", () => {
  it("cleans a good proposal and takes names from the lookups", () => {
    const { value, errors } = validateProposal(goodProposal, refs, new Date("2026-11-15"));
    expect(errors).toBeUndefined();
    expect(value).toMatchObject({
      country_iso: "NG", country: "Nigeria", sport_code: "FTB", sport: "Football",
      organization_website: "https://example-fa.com", operational_status: "active",
    });
  });

  it("lists every problem at once", () => {
    const { errors } = validateProposal({
      ...goodProposal, country_iso: "XX", sport_code: "", astn_vertical: "Fan Engagement",
      founded_year: 2031, source_confidence: "pretty sure", notes: "",
    }, refs, new Date("2026-11-15"));
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/XX is not in lookup_countries/),
      expect.stringMatching(/sport_code is required/),
      expect.stringMatching(/astn_vertical must be one of/),
      expect.stringMatching(/founded_year/),
      expect.stringMatching(/source_confidence must start with a band/),
      expect.stringMatching(/notes is required/),
    ]));
  });

  it("refuses an over-long field instead of cutting it", () => {
    const long = `Medium (${"evidence ".repeat(40)})`;
    const { errors, value } = validateProposal({ ...goodProposal, source_confidence: long }, refs, new Date("2026-11-15"));
    expect(value).toBeUndefined();
    expect(errors).toEqual([`source_confidence is ${long.length} characters; keep it to 300`]);
  });

  it("needs a known verdict and a reason", () => {
    expect(validateVerdict("add", "Active Nigerian startup")).toBeNull();
    expect(validateVerdict("maybe", "x")).toMatch(/verdict must be/);
    expect(validateVerdict("reject", " ")).toMatch(/say why/);
  });

  it("keeps evidence that has a web address and a finding", () => {
    expect(cleanEvidence([
      { url: "https://acme.com", finding: "Live site, Lagos address" },
      { url: "not a url", finding: "x" },
      { url: "https://b.com" },
    ])).toEqual([{ url: "https://acme.com", finding: "Live site, Lagos address" }]);
  });

  it("dates the note and says where the row came from, without who approved it", () => {
    const note = approvalNote("Football analytics.", { candidateId: "c1", date: new Date("2026-11-15T10:00:00Z") });
    expect(note).toBe("[2026-11-15] Football analytics.\n[2026-11-15] Added from registry candidate c1, reviewed by agent and approved in os.stza.io.");
    expect(note).not.toMatch(/@/);
  });
});
