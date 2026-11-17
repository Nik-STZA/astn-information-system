import { describe, expect, it } from "vitest";
import { accountKey, emailInitials, meFrom, recSubjects, subjectHref } from "./threads";

const CO = "11111111-1111-1111-1111-111111111111";

describe("who is signed in", () => {
  it("uses their profile, else initials from the email", () => {
    expect(meFrom("CFO@example.com", [{ email: "cfo@example.com", initials: "NM", display_name: "Nik M" }])).toEqual({ initials: "NM", name: "Nik M" });
    expect(meFrom("jo.bloggs@example.com", [])).toEqual({ initials: "JB", name: "jo.bloggs@example.com" });
    expect(meFrom(null, null)).toEqual({ initials: "?", name: "You" });
    expect(emailInitials("fm1@agents.example.com")).toBe("F");
  });
});

describe("a reconciliation's threads", () => {
  it("are its own and each of its accounts', once each", () => {
    expect(recSubjects("r1", [{ entity_id: CO, code: "776" }, { entity_id: CO, code: "776" }, { entity_id: CO, code: null }]))
      .toEqual(["reconciliation|r1", `account|${CO}:776`]);
    expect(accountKey(CO, null)).toBeNull();
  });
});

describe("where an entry is worked on", () => {
  it("opens the reconciliation, or the Fixed assets page for the month", () => {
    const recs = new Map([[`${CO}:776`, "r1"]]);
    expect(subjectHref("acme", { subject_kind: "account", subject_key: `${CO}:776`, period: "2026-10" }, recs)).toBe("/finance/clients/acme/reconciliations/r1");
    expect(subjectHref("acme", { subject_kind: "account", subject_key: `${CO}:780`, period: "2026-10" }, recs)).toBe("/finance/clients/acme/fixed-assets?period=2026-10");
    expect(subjectHref("acme", { subject_kind: "reconciliation", subject_key: "r2", period: null })).toBe("/finance/clients/acme/reconciliations/r2");
    expect(subjectHref("acme", { subject_kind: "asset", subject_key: "a1", period: null })).toBe("/finance/clients/acme/fixed-assets");
  });
});
