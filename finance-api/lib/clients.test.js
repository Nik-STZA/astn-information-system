import { describe, expect, it } from "vitest";
import { clientChanges, diff, freeSlug, serviceChange, servicesView, slugify } from "./clients.js";

describe("slugify and freeSlug", () => {
  it("makes a URL-safe slug from a name", () => {
    expect(slugify("Feldspar Sport Group")).toBe("feldspar-sport-group");
    expect(slugify("Smith & Jones (Pty) Ltd")).toBe("smith-and-jones-pty-ltd");
    expect(slugify("Café Société")).toBe("cafe-societe");
    expect(slugify("  !!  ")).toBe("client");
  });
  it("takes the first free slug", () => {
    expect(freeSlug("acme", [])).toBe("acme");
    expect(freeSlug("acme", ["acme", "acme-2"])).toBe("acme-3");
  });
});

describe("clientChanges", () => {
  it("keeps only the fields sent, trimmed", () => {
    expect(clientChanges({ name: "  Jo Bloggs Ltd ", contact: "" })).toEqual({ set: { name: "Jo Bloggs Ltd", contact: null }, issues: [] });
  });
  it("refuses an empty name, a bad status and a bad email", () => {
    const { issues } = clientChanges({ name: " ", status: "active", lead_email: "nope" });
    expect(issues).toHaveLength(3);
  });
  it("starts a new prospect at lead", () => {
    expect(clientChanges({ status: "prospect" }, { status: "engaged", pipeline_stage: null }).set).toEqual({ status: "prospect", pipeline_stage: "lead" });
  });
  it("clears the stage when a prospect becomes a client", () => {
    expect(clientChanges({ status: "engaged" }, { status: "prospect", pipeline_stage: "agreed" }).set).toEqual({ status: "engaged", pipeline_stage: null });
  });
  it("refuses a stage on a client that is not a prospect", () => {
    expect(clientChanges({ pipeline_stage: "proposal" }, { status: "engaged" }).issues[0]).toMatch(/Only a prospect/);
  });
  it("moves a prospect between stages", () => {
    expect(clientChanges({ pipeline_stage: "proposal" }, { status: "prospect", pipeline_stage: "lead" })).toEqual({ set: { pipeline_stage: "proposal" }, issues: [] });
  });
});

describe("serviceChange", () => {
  it("accepts active, completed and not taken", () => {
    expect(serviceChange("finance", { state: "active", started_on: "2026-07-01" })).toMatchObject({ state: "active", started_on: "2026-07-01", ended_on: null });
    expect(serviceChange("consulting", { state: "completed", ended_on: "2026-10-28", closing_note: " Delivered the model. " }))
      .toMatchObject({ state: "completed", ended_on: "2026-10-28", closing_note: "Delivered the model." });
    expect(serviceChange("data_protection", { state: null })).toMatchObject({ state: null, issues: [] });
  });
  it("refuses an unknown service or state, and a bad date", () => {
    expect(serviceChange("payroll", { state: "active" }).issues[0]).toMatch(/service must be/);
    expect(serviceChange("finance", { state: "paused" }).issues[0]).toMatch(/state must be/);
    expect(serviceChange("finance", { state: "completed", ended_on: "28/10/2026" }).issues[0]).toMatch(/ended_on/);
  });
  it("refuses an end date or closing note on an active service", () => {
    expect(serviceChange("finance", { state: "active", closing_note: "done" }).issues[0]).toMatch(/active service/);
  });
});

describe("diff", () => {
  it("records only what changed", () => {
    expect(diff({ name: "A", status: "engaged" }, { name: "A", status: "former" })).toEqual({ status: { from: "engaged", to: "former" } });
  });
});

describe("servicesView", () => {
  it("lists every service in a fixed order, null for not taken", () => {
    const out = servicesView([{ service: "data_protection", state: "completed", started_on: null, ended_on: "2026-10-01", closing_note: "x" }]);
    expect(out.map((s) => [s.service, s.state])).toEqual([["finance", null], ["data_protection", "completed"], ["consulting", null]]);
  });
});
