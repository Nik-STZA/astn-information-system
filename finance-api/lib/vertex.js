// Gemini on Vertex AI (docs/ap-lane/ap-lane-spec.md section 4, decided 20 Oct
// 2026): gemini-3.5-flash in europe-west2, London.
//
// Always the regional endpoint, never "global": only a regional endpoint pins
// where the document is processed, and client invoices carry personal data.
//
// The project's Vertex quota was new on 20 Oct and answered 429 often, so a 429
// is retried with a growing wait; any other failure is returned at once.
// getToken and fetchImpl are injected so tests never reach Google.

const DEFAULTS = {
  project: process.env.VERTEX_PROJECT || "africanstn-research",
  location: process.env.VERTEX_LOCATION || "europe-west2",
  model: process.env.VERTEX_MODEL || "gemini-3.5-flash",
};

let auth;
async function adcToken() {
  if (!auth) {
    const { GoogleAuth } = require("google-auth-library");
    auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  const t = await auth.getAccessToken();
  return typeof t === "string" ? t : t?.token;
}

function endpoint({ project, location, model }) {
  if (!/^[a-z]+-[a-z]+\d+$/.test(location)) throw new Error(`Vertex location must be a region, got "${location}"`);
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

async function generate(body, {
  getToken = adcToken, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  attempts = 6, baseDelayMs = 15000, ...target
} = {}) {
  const t = { ...DEFAULTS, ...target };
  const url = endpoint(t);
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(baseDelayMs * i);
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (r.ok) {
      const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!text) throw new Error(`Vertex returned no text (finishReason ${json.candidates?.[0]?.finishReason || "none"})`);
      return { text, usage: json.usageMetadata || null, model: t.model, location: t.location };
    }
    last = { status: r.status, message: json.error?.message || "" };
    if (r.status !== 429) break;
  }
  const err = new Error(`Vertex ${last.status}: ${last.message}`.slice(0, 300));
  err.httpStatus = 502;
  err.detail = { stage: "vertex", ...last };
  throw err;
}

module.exports = { generate, endpoint, DEFAULTS };
