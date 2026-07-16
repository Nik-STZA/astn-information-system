/**
 * AfricanSTN Cloud Run API server.
 *
 * Express + pg Pool connecting to Cloud SQL (PostgreSQL 17).
 * Route files are loaded via require() — they reference the global `app` and `pool`.
 *
 * Env vars (set on Cloud Run):
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *   API_KEY          — shared secret for X-API-Key auth
 *   PORT             — defaults to 8080
 *   INSTANCE_CONNECTION_NAME — Cloud SQL Unix socket path (optional)
 */

const express = require("express");
const { Pool } = require("pg");
const { NodeHtmlMarkdown } = require("node-html-markdown");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "5mb" }));

// ─── CORS ──────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://astn-information-system.netlify.app",
  "http://localhost:3000",
  "http://localhost:3001",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-API-Key, Authorization"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ─── API Key Auth ──────────────────────────────────────────────────────────

app.use("/api", (req, res, next) => {
  // Allow health check without auth
  if (req.path === "/health") return next();

  const apiKey = process.env.API_KEY;
  if (!apiKey) return next(); // No key configured = open (dev only)

  const provided = req.headers["x-api-key"];
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ error: "Unauthorized — invalid API key" });
  }
  next();
});

// ─── Database Pool ─────────────────────────────────────────────────────────

const poolConfig = {
  user: process.env.DB_USER || "africastn_app",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "africastn_os",
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

// Cloud SQL: use Unix socket when INSTANCE_CONNECTION_NAME is set
if (process.env.INSTANCE_CONNECTION_NAME) {
  poolConfig.host = `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`;
} else {
  poolConfig.host = process.env.DB_HOST || "localhost";
  poolConfig.port = parseInt(process.env.DB_PORT || "5432", 10);
}

const pool = new Pool(poolConfig);

// NodeHtmlMarkdown instance (used by agent routes)
const nhm = new NodeHtmlMarkdown();

// ─── Health Check ──────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT NOW() AS now");
    res.json({ status: "ok", db: rows[0].now });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

// ─── Mount Route Files ─────────────────────────────────────────────────────
// Route files reference the global `app`, `pool`, `nhm`, and `crypto`.

require("./server-listing-routes");
require("./server-pipeline-routes");
require("./server-client-management-routes");
require("./server-agent-routes");

// ─── Start ─────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "8080", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AfricanSTN API listening on port ${PORT}`);
  console.log(
    `DB: ${poolConfig.host}:${poolConfig.port || "socket"}/${poolConfig.database}`
  );
});
