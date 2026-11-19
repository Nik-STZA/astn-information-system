import { describe, expect, it } from "vitest";
import { applyEdits, contentIssues, readyForPack, sections, styleNotes } from "./pack-commentary";

const H = {
  period_label: "October 2026",
  commentary: "The loss widened in October, mostly professional fees.",
  kpis: [{ label: "Cash", value: 125000, note: "Down on September." }, { label: "Headcount", value: 9 }],
  compliance: [{ item: "Bank reconciliations", status: "GREEN", detail: "All signed." }],
  variance_comments: { "Legal & Professional": "Two suppliers drove it." },
  actions: [{ priority: "P1", owner: "CFO", action: "Chase the WIP figure." }],
  risks: [{ title: "Funding", description: "Next drawdown due in January." }],
  entities: [{ name: "Alpha Ltd", loss_month: -40000 }],
};

describe("the commentary's text fields", () => {
  it("lists every editable text by section, with its path, and leaves figures out", () => {
    const s = sections(H);
    expect(s.map((x) => x.key)).toEqual(["commentary", "kpis", "compliance", "variance_comments", "actions", "risks"]);
    expect(s.flatMap((x) => x.fields.map((f) => f.path))).toEqual([
      "commentary", "kpis.0.note", "compliance.0.detail", "variance_comments.Legal & Professional", "actions.0.action", "risks.0.description",
    ]);
    expect(s[2].fields[0]).toMatchObject({ heading: "Bank reconciliations", status: "GREEN" });
  });
});

describe("saving edits", () => {
  it("changes only the text, and reports what changed", () => {
    const out = applyEdits(H, [{ path: "commentary", text: "A better first paragraph." }, { path: "risks.0.description", text: "Next drawdown due in January." }]);
    expect(out.issues).toEqual([]);
    expect(out.changed).toEqual(["commentary"]);
    expect(out.content.commentary).toBe("A better first paragraph.");
    expect(out.content.entities).toEqual(H.entities);
    expect(H.commentary).toBe("The loss widened in October, mostly professional fees.");
  });

  it("refuses a figure, an unknown path, or something that is not words", () => {
    const out = applyEdits(H, [{ path: "kpis.0.value", text: "1" }, { path: "entities.0.loss_month", text: "0" }, { path: "commentary", text: 5 }]);
    expect(out.issues).toEqual([
      "edit 1: kpis.0.value is not a text field of the commentary; figures are not edited here",
      "edit 2: entities.0.loss_month is not a text field of the commentary; figures are not edited here",
      "edit 3: the text must be words",
    ]);
    expect(out.changed).toEqual([]);
  });

  it("keeps a variance heading with a full stop in it whole", () => {
    const out = applyEdits({ variance_comments: { "D&A inc. amortisation": "old" } }, [{ path: "variance_comments.D&A inc. amortisation", text: "new" }]);
    expect(out.content.variance_comments).toEqual({ "D&A inc. amortisation": "new" });
  });

  it("does not let a key name reach into the object's prototype", () => {
    const out = applyEdits(H, [{ path: "__proto__.polluted", text: "x" }]);
    expect(out.issues).toHaveLength(1);
    expect({}.polluted).toBeUndefined();
  });
});

describe("taking a file in", () => {
  it("wants a highlights file to have commentary sections, and any object for the dashboard", () => {
    expect(contentIssues("highlights", H)).toEqual([]);
    expect(contentIssues("highlights", { pnl_trend: [] })[0]).toMatch(/is it the highlights file/);
    expect(contentIssues("dashboard", { pnl_trend: [] })).toEqual([]);
    expect(contentIssues("dashboard", [])).toEqual(["the file must be a JSON object"]);
    expect(contentIssues("budget", {})[0]).toMatch(/kind must be/);
  });
});

describe("the CFO's standard", () => {
  it("points out the words to avoid and placeholders, field by field", () => {
    const notes = styleNotes({ ...H, commentary: "Notably, costs rose by GBP 24.0k. Furthermore this is an area to monitor. Budget TBC." });
    expect(notes).toEqual([{ path: "commentary", heading: "The month", words: ["notably", "furthermore", "an area to monitor", "GBP before a figure (write £)", "TBC"] }]);
    expect(styleNotes(H)).toEqual([]);
  });
});

describe("whether the pack can use it", () => {
  it("needs the highlights approved, and the dashboard too when there is one", () => {
    expect(readyForPack([])).toMatchObject({ ready: false });
    expect(readyForPack([{ kind: "highlights", status: "draft" }]).why).toMatch(/draft/);
    expect(readyForPack([{ kind: "highlights", status: "approved" }, { kind: "dashboard", status: "draft" }]).ready).toBe(false);
    expect(readyForPack([{ kind: "highlights", status: "approved" }]).ready).toBe(true);
    expect(readyForPack([{ kind: "highlights", status: "approved" }, { kind: "dashboard", status: "approved" }]).ready).toBe(true);
  });
});
