import { describe, expect, it } from "vitest";
import {
  isTokenRejection,
  normaliseIp,
  readAuthEventId,
  selectTenant,
  shouldPersistRefreshToken,
} from "./xero.js";

// Fixtures shaped like the real Feldspar connections. The names are the actual
// ones, because the bug this pins was a mix-up between them.
const UDL = { tenantId: "t-udl", tenantName: "Ultraspeed Digital Limited", authEventId: "evt-1" };
const FGH = { tenantId: "t-fgh", tenantName: "Feldspar Group Holdings Limited", authEventId: "evt-2" };
const FSL = { tenantId: "t-fsl", tenantName: "Feldspar Ltd", authEventId: "evt-3" };

function idToken(payload) {
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${b64}.signature`;
}

describe("selectTenant", () => {
  // The exact production failure. Three organisations reachable, Ultraspeed
  // listed first, the operator authorising Feldspar Group Holdings. Taking
  // connections[0] mapped FGH to Ultraspeed and would have posted FGH journals
  // into Ultraspeed's ledger.
  it("picks the organisation the auth event granted, not the first listed", () => {
    const result = selectTenant([UDL, FGH, FSL], "evt-2");
    expect(result.ok).toBe(true);
    expect(result.tenant.tenantName).toBe("Feldspar Group Holdings Limited");
    expect(result.tenant).not.toBe(UDL);
  });

  it("works regardless of ordering", () => {
    for (const order of [[UDL, FGH, FSL], [FSL, FGH, UDL], [FGH, UDL, FSL]]) {
      expect(selectTenant(order, "evt-3").tenant.tenantName).toBe("Feldspar Ltd");
    }
  });

  it("accepts a single connection with no auth event", () => {
    const r = selectTenant([UDL], null);
    expect(r.ok).toBe(true);
    expect(r.tenant.tenantName).toBe("Ultraspeed Digital Limited");
  });

  // Refusing is the whole point. A wrong tenant is a journal in another
  // company's books; a retry is an inconvenience.
  it("refuses rather than guessing when several are reachable and the event is unknown", () => {
    const r = selectTenant([UDL, FGH, FSL], null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-auth-event");
    expect(r.matched).toBe(3);
  });

  it("refuses when the auth event matches nothing", () => {
    const r = selectTenant([UDL, FGH], "evt-unknown");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-match");
  });

  it("refuses when one event granted several organisations at once", () => {
    const a = { ...UDL, authEventId: "evt-bulk" };
    const b = { ...FGH, authEventId: "evt-bulk" };
    const r = selectTenant([a, b], "evt-bulk");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ambiguous");
    expect(r.matched).toBe(2);
  });

  it("refuses on an empty or malformed connection list", () => {
    expect(selectTenant([], "evt-1").ok).toBe(false);
    expect(selectTenant(null, "evt-1").ok).toBe(false);
    expect(selectTenant(undefined, "evt-1").ok).toBe(false);
  });
});

describe("readAuthEventId", () => {
  it("reads the event id from an id token", () => {
    expect(readAuthEventId(idToken({ authentication_event_id: "evt-2", sub: "x" }))).toBe("evt-2");
  });

  it("returns null rather than throwing on anything malformed", () => {
    expect(readAuthEventId(null)).toBeNull();
    expect(readAuthEventId("")).toBeNull();
    expect(readAuthEventId("not-a-jwt")).toBeNull();
    expect(readAuthEventId("a.!!!notbase64!!!.c")).toBeNull();
    expect(readAuthEventId(idToken({ sub: "x" }))).toBeNull();
    expect(readAuthEventId(12345)).toBeNull();
  });

  // A null here must degrade to refusing the connection, never to guessing.
  it("a missing event id leads selectTenant to refuse when ambiguous", () => {
    const eventId = readAuthEventId("garbage");
    expect(selectTenant([UDL, FGH], eventId).ok).toBe(false);
  });
});

describe("normaliseIp", () => {
  // The exact header that rolled back a live Xero connection.
  it("reduces the production forwarded chain to one address", () => {
    expect(normaliseIp("5.69.166.27,136.68.115.112,2600:1900:0:4301::1b00")).toBe("5.69.166.27");
  });

  it("handles single addresses, spacing and ports", () => {
    expect(normaliseIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normaliseIp(" 203.0.113.9 , 70.41.3.18 ")).toBe("203.0.113.9");
    expect(normaliseIp("203.0.113.9:41234")).toBe("203.0.113.9");
    expect(normaliseIp("[2600:1900:0:4301::1b00]:443")).toBe("2600:1900:0:4301::1b00");
    expect(normaliseIp("2600:1900:0:4301::1b00")).toBe("2600:1900:0:4301::1b00");
  });

  it("returns null for anything Postgres inet would reject", () => {
    expect(normaliseIp(null)).toBeNull();
    expect(normaliseIp("")).toBeNull();
    expect(normaliseIp("unknown")).toBeNull();
    expect(normaliseIp("999.1.1.1")).toBeNull();
    expect(normaliseIp("not an ip, 203.0.113.9")).toBeNull();
  });
});

describe("shouldPersistRefreshToken", () => {
  it("persists a rotated token", () => {
    expect(shouldPersistRefreshToken("old", { refresh_token: "new" })).toBe(true);
  });

  it("does not rewrite an unchanged token", () => {
    expect(shouldPersistRefreshToken("same", { refresh_token: "same" })).toBe(false);
  });

  it("does not treat a missing token as a rotation", () => {
    expect(shouldPersistRefreshToken("old", {})).toBe(false);
    expect(shouldPersistRefreshToken("old", { refresh_token: "" })).toBe(false);
    expect(shouldPersistRefreshToken("old", null)).toBe(false);
  });
});

describe("isTokenRejection", () => {
  // The live 401 from /Journals on Feldspar Group Holdings, 14 Aug 2026. The
  // scope was never granted, so the token is fine and always will be. Dropping
  // the cache here makes a script that loops over this resource refresh - and
  // therefore rotate the Xero refresh token - on every single call.
  const SCOPE_401 =
    '{"Type":null,"Title":"Unauthorized","Status":401,"Detail":"AuthorizationUnsuccessful"}';

  it("does not treat a missing scope as a bad token", () => {
    expect(isTokenRejection("", SCOPE_401)).toBe(false);
  });

  it("does not treat insufficient_scope as a bad token", () => {
    expect(isTokenRejection('Bearer error="insufficient_scope"', SCOPE_401)).toBe(false);
  });

  it("treats invalid_token as a bad token", () => {
    expect(isTokenRejection('Bearer error="invalid_token"', "")).toBe(true);
  });

  it("treats AuthenticationUnsuccessful as a bad token when no header is given", () => {
    expect(isTokenRejection("", '{"Detail":"AuthenticationUnsuccessful"}')).toBe(true);
  });

  // The header wins: a scope failure that happens to mention expiry in its body
  // must not be read as an expired token.
  it("prefers the header over the body", () => {
    expect(isTokenRejection('Bearer error="insufficient_scope"', "TokenExpired")).toBe(false);
  });

  it("defaults to false on anything unrecognised", () => {
    expect(isTokenRejection("", "")).toBe(false);
    expect(isTokenRejection(null, undefined)).toBe(false);
    expect(isTokenRejection("", "some unrelated gateway error")).toBe(false);
  });
});
