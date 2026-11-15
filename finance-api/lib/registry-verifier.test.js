import { describe, it, expect } from "vitest";
import { buildRequest, extractJson, validateChanges, groundingSources, parseAnswer, websiteLine } from "./registry-verifier";

const today = new Date("2026-11-15T12:00:00Z");
const org = {
  astn_id: "KE-MSP-0010", organization_name: "HustleSasa", country: "Kenya", sport: "Multi-Sport",
  organization_website: "https://hustlesasa.com", operational_status: "unknown", founded_year: null,
  source_confidence: "Medium (one source)", notes: "Earlier note.",
};

describe("the request", () => {
  it("asks for grounded search, carries the record and the website check, and no personal data fields", () => {
    const req = buildRequest({ ...org, contact_email: "someone@example.com" }, { url: "https://hustlesasa.com", outcome: "live", http_status: 200, title: "Hustlesasa" }, today);
    expect(req.tools).toEqual([{ googleSearch: {} }]);
    expect(req.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    const text = req.contents[0].parts[0].text;
    expect(text).toMatch(/at most 3 searches/);
    expect(text).toMatch(/KE-MSP-0010/);
    expect(text).toMatch(/outcome live, HTTP 200, page title "Hustlesasa"/);
    expect(text).not.toMatch(/someone@example.com/);
  });

  it("describes a missing website and a moved one", () => {
    expect(websiteLine({ outcome: "no_website" })).toMatch(/no website/);
    expect(websiteLine({ url: "https://a.test", final_url: "https://b.test/", outcome: "redirect", http_status: 200, mentions_name: false }))
      .toMatch(/ended at https:\/\/b.test\/.*does not mention/);
  });
});

describe("reading the answer", () => {
  it("finds the JSON with or without a code fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
    expect(extractJson("no json")).toBeNull();
  });

  it("keeps only valid changes that differ from the record", () => {
    const { changes, errors } = validateChanges({
      organization_website: "hustlesasa.com/",   // same as now
      operational_status: "Active",
      founded_year: 2021,
      source_confidence: "High (startuplist.africa + news 2026)",
      astn_id: "XX-1",                           // not changeable
      ceased_year: 2031,                         // future
    }, org, today);
    expect(changes).toEqual({ operational_status: "active", founded_year: 2021, source_confidence: "High (startuplist.africa + news 2026)" });
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/astn_id cannot be changed/), expect.stringMatching(/ceased_year/)]));
  });

  it("marks a closed organisation ceased when a closing year is given", () => {
    expect(validateChanges({ ceased_year: 2024 }, org, today).changes).toEqual({ ceased_year: 2024, operational_status: "ceased" });
  });

  it("lists Google's sources once each", () => {
    const g = { groundingChunks: [
      { web: { uri: "https://vertexaisearch.cloud.google.com/r/1", title: "startuplist.africa" } },
      { web: { uri: "https://vertexaisearch.cloud.google.com/r/2", title: "startuplist.africa" } },
      { web: { uri: "javascript:x", title: "bad" } },
    ] };
    expect(groundingSources(g)).toEqual([{ url: "https://vertexaisearch.cloud.google.com/r/1", finding: "Search source: startuplist.africa" }]);
  });

  it("turns a good answer into a proposal with a dated note", () => {
    const text = JSON.stringify({
      verdict: "update", reason: "Active Nairobi company, founded 2021.",
      changes: { operational_status: "active", founded_year: 2021 }, notes_append: "Still operating; raised funding in 2026.",
      sources: ["startuplist.africa"],
    });
    const r = parseAnswer(text, { groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/r/1", title: "startuplist.africa" } }] }, org, today);
    expect(r.verdict).toBe("update");
    expect(r.proposal.changes).toEqual({ operational_status: "active", founded_year: 2021 });
    expect(r.proposal.notes_append).toBe("[2026-11-15] Still operating; raised funding in 2026.");
    expect(r.evidence).toHaveLength(1);
  });

  it("calls it no_change when every proposed value is already held, and says what failed checks", () => {
    const r = parseAnswer(JSON.stringify({ verdict: "update", reason: "Nothing new.", changes: { organization_website: "https://hustlesasa.com", level: "x" } }), null, org, today);
    expect(r.verdict).toBe("no_change");
    expect(r.reason).toMatch(/Not proposed .*level cannot be changed/);
  });

  it("falls back to the sites Gemini names when Google returns no links", () => {
    const r = parseAnswer(JSON.stringify({ verdict: "no_change", reason: "x", sources: ["imedias.net", "Google Play Store", "www.aip.ci"] }), { groundingChunks: [] }, org, today);
    expect(r.evidence).toEqual([
      { url: "https://imedias.net", finding: "Site Gemini named as a source: imedias.net" },
      { url: "https://aip.ci", finding: "Site Gemini named as a source: www.aip.ci" },
    ]);
  });

  it("refuses an answer that is not the JSON asked for", () => {
    expect(parseAnswer("I could not find it.", null, org, today).error).toMatch(/JSON/);
    expect(parseAnswer('{"verdict":"maybe","reason":"x"}', null, org, today).error).toMatch(/not update or no_change/);
  });
});
