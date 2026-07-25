/**
 * Shared dual-model resolution engine (jurisdiction-agnostic).
 *
 * Extracted from server-remediation-resolution-routes.js so BOTH the legacy remediation
 * board and the V2 jurisdiction-native board (server-remediation-v2-routes.js) use one
 * implementation — no duplicated model logic, no per-framework hardcoding.
 * See docs/compliance-engine-principles.md (Invariants 1 & 5).
 *
 * Requires GEMINI_API_KEY + ANTHROPIC_API_KEY (Cloud Run secrets).
 * DPA-tier note: safe on STZA's own data; client personal data needs DPA-covered AI tiers.
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-pro-latest";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";
const MAX_CHARS = 40000;

// Which document types are most relevant per finding category (by domain code OR legacy category).
const CATEGORY_DOCS = {
  special_categories: ["privacy_policy", "impact_assessment"],
  breach_notification: ["breach_procedure", "privacy_policy"],
  security_safeguards: ["security_policy", "privacy_policy"],
  cross_border_transfer: ["data_processing_agreement", "privacy_policy"],
  information_officer: ["privacy_policy", "other"],
  data_subject_rights: ["privacy_policy"],
  consent_mechanism: ["privacy_policy", "consent_form"],
  retention_and_purpose: ["privacy_policy", "retention_policy"],
  lawful_processing: ["privacy_policy", "data_processing_agreement"],
  direct_marketing: ["privacy_policy", "marketing_policy"],
};

const RESOLUTION_SYSTEM = `You are a data-protection compliance assessor. You are given ONE remediation finding and the client's actual document(s). Produce a concrete, specific resolution.
Rules:
- Identify EXACTLY what is missing or wrong in the client's document text for this finding — quote the relevant wording where possible.
- Provide a concrete redraft: the corrected clause/paragraph the client could adopt (mark it as a draft, pending the client's own legal review).
- Cite the EXACT statutory section/article numbers that apply, IN THE FRAMEWORK OF THIS FINDING (the finding states its regime and citation — stay within it; do not switch frameworks). Do not invent sections. Be precise.
- Judge only from the document text; do not assume facts not stated.
- LEGAL CAUTION — be precise and appropriately hedged, do not overstate:
  * Do NOT assert that prior authorisation from the regulator is required unless the finding's regime clearly requires it; frame conditional obligations as "may apply ... where applicable" and note they should be assessed, not assumed.
  * Do NOT pre-select a single lawful basis as invariably applicable. Present the basis as "may include" the relevant provision; the applicable ground depends on the circumstances and should be confirmed by the client's legal counsel.
  * Prefer "does not intentionally collect / solicit" over "does not collect".
  * Where it affects obligations, note whether the party is acting as a controller / responsible party or a processor / operator.
- Respond with ONLY a JSON object:
  {"summary":"one sentence on the core gap","gaps":["specific gap 1","gap 2"],"redraft":"the suggested corrected clause text","citations":["<exact citations in the finding's framework>"]}`;

const RESOLUTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    gaps: { type: "ARRAY", items: { type: "STRING" } },
    redraft: { type: "STRING" },
    citations: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary", "gaps", "redraft", "citations"],
};

function stripHtml(h) {
  return (h || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJson(t) {
  if (!t) return null;
  const m = t.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(m ? m[0] : t);
  } catch {
    return null;
  }
}

async function callGemini(user) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: RESOLUTION_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          thinkingConfig: { thinkingBudget: -1 },
          responseMimeType: "application/json",
          responseSchema: RESOLUTION_SCHEMA,
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  return extractJson(d?.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function callClaude(user, attempt = 0) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      thinking: { type: "adaptive" },
      system: RESOLUTION_SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (r.status === 529 && attempt < 2) {
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    return callClaude(user, attempt + 1); // retry on overload
  }
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  const text = (d.content || []).find((b) => b.type === "text")?.text;
  return extractJson(text);
}

// Normalise a citation for comparison (strip spaces/case, keep section digits+letters).
const normCite = (s) => (s || "").toLowerCase().replace(/[^a-z0-9()]/g, "");

function crossCheck(g, c) {
  const gc = new Set((g?.citations || []).map(normCite).filter(Boolean));
  const cc = new Set((c?.citations || []).map(normCite).filter(Boolean));
  if (!gc.size || !cc.size) return "flagged";
  // Prefix-tolerant so a general vs specific cite (s27 ~ s27(1)(b)) still agrees.
  const [small, big] = gc.size <= cc.size ? [gc, cc] : [cc, gc];
  const contained = [...small].every((x) =>
    [...big].some((y) => y.startsWith(x) || x.startsWith(y)),
  );
  return contained ? "agreed" : "flagged";
}

function composeResolution(primary, other, agreement) {
  const lines = [];
  if (agreement === "flagged") {
    lines.push(
      "REVIEW: the two models cited different provisions — confirm which is correct before adopting.",
    );
  }
  if (primary?.summary) lines.push(primary.summary);
  if (primary?.gaps?.length) lines.push("Gaps:\n- " + primary.gaps.join("\n- "));
  if (primary?.redraft) lines.push("Suggested redraft (pending client legal review):\n" + primary.redraft);
  const cites = [...new Set([...(primary?.citations || []), ...(other?.citations || [])])];
  if (cites.length) lines.push("Citations: " + cites.join(", "));
  return lines.join("\n\n");
}

/**
 * Fetch the most-relevant document corpus for a client + finding category.
 * category is a domain code or legacy category key; falls back to privacy_policy, then all docs.
 */
async function fetchCorpus(pool, clientId, category) {
  const wantTypes = CATEGORY_DOCS[category] || ["privacy_policy"];
  const { rows: docs } = await pool.query(
    `SELECT document_type, title, COALESCE(raw_content, processed_content, '') AS content
     FROM compliance_documents WHERE client_id = $1`,
    [clientId],
  );
  let rel = docs.filter((d) => wantTypes.includes(d.document_type));
  if (!rel.length) rel = docs.filter((d) => d.document_type === "privacy_policy");
  if (!rel.length) rel = docs;
  return rel
    .map((d) => `## ${d.title} (${d.document_type})\n${stripHtml(d.content)}`)
    .join("\n\n")
    .slice(0, MAX_CHARS);
}

/**
 * Run the dual-model resolution for a single finding.
 * finding: { title, reference, description, recommendation, corpus }
 * Returns { gemini, claude, agreement, resolutionText, status, models }.
 */
async function generateDualModelResolution(finding) {
  const user = `FINDING: ${finding.title} (${finding.reference || ""})
Current finding: ${finding.description || ""}
Standard recommendation: ${finding.recommendation || ""}

CLIENT DOCUMENT(S):
"""
${finding.corpus}
"""`;

  const [g, c] = await Promise.all([callGemini(user), callClaude(user)]);
  if (!g && !c) throw new Error("both models returned no parseable output");
  const agreement = g && c ? crossCheck(g, c) : "flagged";
  const primary = c || g; // prefer Claude as primary, fall back to Gemini
  const other = c ? g : null;
  const resolutionText = composeResolution(primary, other, agreement);
  const status = agreement === "flagged" ? "needs_review" : "draft";
  return {
    gemini: g,
    claude: c,
    agreement,
    resolutionText,
    status,
    models: { gemini: g, claude: c, models: [GEMINI_MODEL, CLAUDE_MODEL] },
  };
}

module.exports = {
  CATEGORY_DOCS,
  RESOLUTION_SYSTEM,
  RESOLUTION_SCHEMA,
  stripHtml,
  extractJson,
  callGemini,
  callClaude,
  crossCheck,
  composeResolution,
  fetchCorpus,
  generateDualModelResolution,
};
