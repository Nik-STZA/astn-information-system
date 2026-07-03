/**
 * Shared-secret auth patch for the Cloud Run server.js
 *
 * WHY: The API is publicly reachable. CORS only restricts browser cross-origin
 * reads — it does NOT stop a direct request (curl, server-to-server, a script).
 * The Next.js app now sends an `X-API-Key` header on every call
 * (see src/lib/cloud-run.ts). This middleware makes the API reject anything
 * without the matching key.
 *
 * HOW TO APPLY (in the Cloud Run repo, not this one):
 *   1. Add this middleware AFTER `app.use(express.json())` / the CORS block,
 *      but BEFORE any route handlers.
 *   2. Set CLOUD_RUN_API_KEY on the Cloud Run service to the SAME value used in
 *      the Netlify `CLOUD_RUN_API_KEY` env var.
 *   3. Optionally exempt a health-check path (e.g. GET /health) so uptime checks
 *      keep working without the key — see ALLOW_UNAUTHENTICATED below.
 */

const REQUIRED_API_KEY = process.env.CLOUD_RUN_API_KEY;

// Paths that do NOT require the key (health checks, etc.). Keep this minimal.
const ALLOW_UNAUTHENTICATED = new Set(["/health", "/healthz"]);

app.use((req, res, next) => {
  // Fail closed: if the server has no key configured, do not silently allow all.
  if (!REQUIRED_API_KEY) {
    console.error("CLOUD_RUN_API_KEY is not set — refusing all requests.");
    return res.status(503).json({ error: "Server auth not configured" });
  }

  if (ALLOW_UNAUTHENTICATED.has(req.path)) return next();

  const provided = req.get("X-API-Key");

  // Constant-time comparison to avoid leaking the key via timing.
  const crypto = require("crypto");
  const a = Buffer.from(provided || "", "utf8");
  const b = Buffer.from(REQUIRED_API_KEY, "utf8");
  const ok =
    a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }

  next();
});
