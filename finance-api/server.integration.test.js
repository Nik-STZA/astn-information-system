/**
 * Integration tests for stza-finance-api.
 *
 * These test the HTTP layer — auth middleware, health endpoint, and request
 * routing — without a real database or Xero connection. The pg Pool is replaced
 * with a stub so the server can be required without a live DB.
 *
 * Run:   npx vitest run server.integration.test.js
 *
 * These deliberately do NOT hit Xero or Cloud SQL. They verify the Express
 * wiring: does a missing key 401, does an unset key 500, does the health probe
 * work, do the route files load.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "http";

// ── Environment: set BEFORE requiring the server ────────────────────────────

const TEST_API_KEY = "test-key-for-integration-tests";
process.env.FINANCE_API_KEY = TEST_API_KEY;
// Suppress the pool from connecting — there is no database.
process.env.DB_HOST = "127.0.0.1";
process.env.DB_PORT = "65432"; // nothing listens here
process.env.DB_PASSWORD = "unused";

let app, server, baseUrl;

beforeAll(async () => {
  // The server connects to pg on require, but the pool is lazy — it only opens
  // a connection when a query runs. So require is safe even without a DB.
  const mod = await import("./server.js");
  app = mod.app ?? mod.default?.app;
  if (!app) throw new Error("server.js did not export app");

  server = createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function get(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, { headers });
}

function post(path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const authHeaders = { "X-API-Key": TEST_API_KEY };

// ── Tests ───────────────────────────────────────────────────────────────────

describe("health endpoint", () => {
  it("responds without auth", async () => {
    const r = await get("/health");
    // Health tries to query the DB, which will fail without a real connection.
    // But it should NOT 401 — the auth middleware skips /health.
    expect(r.status).not.toBe(401);
  });
});

describe("auth middleware", () => {
  it("rejects requests without an API key", async () => {
    const r = await get("/api/finance/clients");
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.error).toMatch(/unauthorised/i);
  });

  it("rejects requests with a wrong API key", async () => {
    const r = await get("/api/finance/clients", { "X-API-Key": "wrong-key" });
    expect(r.status).toBe(401);
  });

  it("accepts requests with the correct API key", async () => {
    const r = await get("/api/finance/clients", authHeaders);
    // Will fail at the DB layer (no connection), but should NOT be 401.
    expect(r.status).not.toBe(401);
  });

  it("trims whitespace from the key header", async () => {
    const r = await get("/api/finance/clients", { "X-API-Key": `  ${TEST_API_KEY}  ` });
    // Trimming means this should pass auth — fail at DB, not at 401.
    expect(r.status).not.toBe(401);
  });
});

describe("auth middleware — unset key", () => {
  it("returns 500 when FINANCE_API_KEY is not configured", async () => {
    const saved = process.env.FINANCE_API_KEY;
    delete process.env.FINANCE_API_KEY;
    try {
      const r = await get("/api/finance/clients", { "X-API-Key": "anything" });
      expect(r.status).toBe(500);
      const body = await r.json();
      expect(body.error).toMatch(/not configured/i);
    } finally {
      process.env.FINANCE_API_KEY = saved;
    }
  });
});

describe("route registration", () => {
  // These verify the routes mounted by the server. They will fail at the DB
  // layer, but anything that 404s means the route file didn't load.

  const routes = [
    ["GET", "/api/finance/clients"],
    ["POST", "/api/finance/agent-runs/claim"],
  ];

  for (const [method, path] of routes) {
    it(`${method} ${path} is registered (not 404)`, async () => {
      const r = await fetch(`${baseUrl}${path}`, { method, headers: authHeaders });
      expect(r.status).not.toBe(404);
    });
  }
});

describe("JSON body parsing", () => {
  it("accepts a JSON body on POST endpoints", async () => {
    // POST to agent-runs/claim — will fail at DB, but should parse the body.
    const r = await post("/api/finance/agent-runs/claim", {}, authHeaders);
    expect(r.status).not.toBe(400); // not a parse error
    expect(r.status).not.toBe(404); // route exists
    expect(r.status).not.toBe(401); // auth passed
  });
});

describe("CORS", () => {
  it("does not set CORS headers for unknown origins", async () => {
    const r = await get("/health", { Origin: "https://evil.example.com" });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});
