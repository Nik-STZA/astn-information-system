import { describe, expect, it } from "vitest";
import { allocIssues, strippedIssues } from "./payroll-routes";

describe("what the browser may send", () => {
  const HEAD = ["EmpCode", "Basic", "Tax", "NetPay"];
  it("takes the code and the figures", () => {
    expect(strippedIssues([HEAD, ["11", 5000, 900, 3450.12]])).toEqual([]);
  });
  it("refuses any other column, without naming what was in it", () => {
    const out = strippedIssues([[...HEAD, "NINumber"], ["11", 1, 1, 1, "AB123456C"]]);
    expect(out[0]).toMatch(/1 other column refused/);
    expect(JSON.stringify(out)).not.toContain("AB123456C");
  });
  it("refuses words hidden in a figure column, and stray cells past the headings", () => {
    expect(strippedIssues([HEAD, ["11", "1 Example Street, Anytown", 1, 1]])[0]).toMatch(/something other than a code or a figure/);
    expect(strippedIssues([HEAD, ["11", 1, 1, 1, "jo@example.com"]])[0]).toMatch(/more cells/);
  });
});

describe("capitalisation shares", () => {
  it("checks projects, range and the 100% ceiling", () => {
    expect(allocIssues({ 11: { P1: 60, P2: 40 } }, ["P1", "P2"], ["11"])).toEqual([]);
    expect(allocIssues({ 11: { P1: 60, P2: 50 } }, ["P1", "P2"], ["11"])).toEqual(["employee 11: capitalised share adds to 110%, over 100%"]);
    expect(allocIssues({ 11: { P3: 10 } }, ["P1"], ["11"])).toEqual(["employee 11: P3 is not a project"]);
    expect(allocIssues({ 99: {} }, ["P1"], ["11"])).toEqual(["employee code 99 is not in this month's report"]);
  });
});
