import { describe, expect, it } from "vitest";
import { eventText, filterClients, isMasterPath, mayHaveEnded, type ClientService, type MasterClient } from "./clients";

const svc = (service: ClientService["service"], state: ClientService["state"]): ClientService =>
  ({ service, state, started_on: null, ended_on: null, closing_note: null });
let n = 0;
const client = (status: MasterClient["status"], services: ClientService[] = []): MasterClient => ({
  id: `c${++n}`, slug: `c${n}`, name: `Client ${n}`, legal_name: null, jurisdiction: null, status, pipeline_stage: null,
  contact: null, lead_email: null, ended_reason: null, created_at: "", updated_at: "", services, compliance_client_id: null, companies: 0,
});

describe("filterClients", () => {
  const list = [client("engaged"), client("internal"), client("prospect"), client("former")];
  it("counts engaged and internal as clients", () => {
    expect(filterClients(list, "clients").map((c) => c.status)).toEqual(["engaged", "internal"]);
    expect(filterClients(list, "prospects")).toHaveLength(1);
    expect(filterClients(list, "former")).toHaveLength(1);
    expect(filterClients(list, "all")).toHaveLength(4);
  });
});

describe("mayHaveEnded", () => {
  it("asks only about an engaged client with nothing active", () => {
    expect(mayHaveEnded(client("engaged", [svc("finance", "completed")]))).toBe(true);
    expect(mayHaveEnded(client("engaged", [svc("finance", "active")]))).toBe(false);
    expect(mayHaveEnded(client("internal", []))).toBe(false);
  });
});

describe("isMasterPath", () => {
  it("passes only the master's own paths", () => {
    expect(isMasterPath("")).toBe(true);
    expect(isMasterPath("jo-bloggs-ltd")).toBe(true);
    expect(isMasterPath("jo-bloggs-ltd/services/consulting")).toBe(true);
    expect(isMasterPath("jo-bloggs-ltd/services/payroll")).toBe(false);
    expect(isMasterPath("../finance/overview")).toBe(false);
  });
});

describe("eventText", () => {
  const e = (action: string, detail: Record<string, unknown>) => ({ action, detail, actor_email: "jo@example.com", at: "" });
  it("puts each change in words", () => {
    expect(eventText(e("created", {}))).toBe("Added");
    expect(eventText(e("created", { from: "data protection client list" }))).toBe("Added from the data protection client list");
    expect(eventText(e("linked", { data_protection_record: "Jo Bloggs Ltd" }))).toBe("Linked to its data protection record");
    expect(eventText(e("status", { status: { from: "prospect", to: "engaged" } }))).toBe("Status: Prospect to Client");
    expect(eventText(e("updated", { pipeline_stage: { from: "lead", to: "proposal" } }))).toBe("Stage: Proposal sent");
    expect(eventText(e("service", { service: "data_protection", from: "active", to: "completed" }))).toBe("Data protection: active to completed");
    expect(eventText(e("updated", { legal_name: {}, contact: {} }))).toBe("Changed legal name, contact");
  });
});
