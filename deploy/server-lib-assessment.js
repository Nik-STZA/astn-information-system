/**
 * Shared dual-model ASSESSMENT engine (jurisdiction-agnostic).
 *
 * For ONE compliance requirement, two models (Gemini + Claude) independently judge whether the
 * client's documents show it as present / partial / absent, each citing a VERBATIM evidence quote.
 * Quotes are verified against the source text (anti-hallucination), then the two verdicts are
 * adjudicated: agree + both verified → high confidence; agree + quote issue → medium, review;
 * disagree → the more conservative status wins, low confidence, flagged for human review.
 *
 * This is the substance-reading counterpart to the keyword engine (which only counts keyword hits
 * and so marks documents "present" too readily — the false-present problem). It writes the SAME
 * assessment_findings / compliance_assessments shape, so the board, scores, and radar consume it
 * unchanged. Nothing here names a framework — the requirement row carries the regime.
 * See docs/compliance-engine-principles.md (Invariants 1, 4, 5).
 *
 * Requires GEMINI_API_KEY + ANTHROPIC_API_KEY (Cloud Run secrets).
 * DPA-tier note: safe on STZA's own data; client personal data needs DPA-covered AI tiers.
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-pro-latest";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

// 0-9 per-severity score, identical to the keyword engine so scoring stays comparable.
const SEVERITY_SCORES = { compliant: 9, info: 8, low: 7, medium: 4, high: 2, critical: 0 };

const JUDGE_SYSTEM = `You are a data-protection compliance assessor. You are given ONE requirement and one or more of a client's actual documents. Decide, using ONLY the supplied document text, whether the documents satisfy the requirement.

Rules:
- "status" is exactly one of: "present", "partial", "absent".
  * present = the documents fully address what the requirement needs.
  * partial = the topic is addressed but incompletely (e.g. mentioned without the specifics the requirement needs, such as "as long as necessary" instead of a defined retention period).
  * absent = the documents do not address the requirement.
- If status is "present" or "partial", "evidence_quote" MUST be an EXACT verbatim substring copied character-for-character from one of the documents. Do not paraphrase, summarise, translate, re-punctuate, or fix typos. Copy the source's own quotation marks and spelling. Set "evidence_doc" to the title of the document you quoted.
- If status is "absent", "evidence_quote" and "evidence_doc" MUST be null. Never invent, complete, or approximate a quote.
- Judge ONLY from the supplied document text. Do not rely on outside knowledge of the client, and do not assume facts, controls, or clauses that are not written in the documents. Absence of text is absence of evidence.
- Do not infer the governing law or import requirements from any other framework; assess only against the requirement as stated in the user message.
- Respond with ONLY a JSON object and nothing else:
  {"status":"...","evidence_quote":"..." or null,"evidence_doc":"..." or null,"reasoning":"one to two sentences linking the quote to the requirement"}`;

const JUDGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["present", "partial", "absent"] },
    evidence_quote: { type: "STRING", nullable: true },
    evidence_doc: { type: "STRING", nullable: true },
    reasoning: { type: "STRING" },
  },
  required: ["status", "reasoning"],
};

function extractJson(t) {
  if (!t) return null;
  const m = t.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(m ? m[0] : t);
  } catch {
    return null;
  }
}

// Normalise for the verbatim-quote check: fold smart quotes/dashes, collapse whitespace, lowercase.
// (PDF-extracted text often carries curly quotes/en-dashes that would otherwise fail verification.)
const norm = (s) =>
  (s || "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

async function callGeminiJudge(user) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: JUDGE_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          thinkingConfig: { thinkingBudget: -1 },
          responseMimeType: "application/json",
          responseSchema: JUDGE_SCHEMA,
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  return extractJson(d?.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function callClaudeJudge(user, attempt = 0) {
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
      max_tokens: 1500,
      thinking: { type: "adaptive" },
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (r.status === 529 && attempt < 2) {
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    return callClaudeJudge(user, attempt + 1); // retry on overload
  }
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  const text = (d.content || []).find((b) => b.type === "text")?.text;
  return extractJson(text);
}

// A present/partial verdict must cite a quote that actually appears in the corpus; absent must
// carry no quote. Returns true if the verdict is internally consistent and (if citing) verified.
function verifyQuote(corpus, v) {
  if (v?.status === "absent") return v.evidence_quote == null;
  if (!v?.evidence_quote) return false;
  return norm(corpus).includes(norm(v.evidence_quote));
}

const CONSERVATISM = { absent: 0, partial: 1, present: 2 }; // lower = more severe → wins ties on disagreement

/**
 * Adjudicate two model verdicts for one requirement.
 * Returns { final_status, confidence, agreement, needs_review, review_reason, gemini, claude }.
 */
function adjudicate(corpus, g, c) {
  const gv = verifyQuote(corpus, g);
  const cv = verifyQuote(corpus, c);
  const gStatus = g?.status || "absent";
  const cStatus = c?.status || "absent";
  const agree = gStatus === cStatus;

  const stamp = (v, verified) => ({
    status: v?.status || null,
    evidence_quote: v?.evidence_quote || null,
    evidence_doc: v?.evidence_doc || null,
    reasoning: v?.reasoning || null,
    quote_verified: verified,
  });
  const gemini = stamp(g, gv);
  const claude = stamp(c, cv);

  if (agree && gv && cv) {
    return { final_status: gStatus, confidence: "high", agreement: "agree", needs_review: false, review_reason: null, gemini, claude };
  }
  if (agree) {
    return {
      final_status: gStatus,
      confidence: "medium",
      agreement: "agree_quote_issue",
      needs_review: true,
      review_reason: "Both models agree on status but a cited quote could not be verified verbatim in the source — check the evidence.",
      gemini,
      claude,
    };
  }
  // Disagree → the more conservative (more severe) status wins, flagged for a human.
  const conservative = CONSERVATISM[gStatus] <= CONSERVATISM[cStatus] ? gStatus : cStatus;
  return {
    final_status: conservative,
    confidence: "low",
    agreement: "disagree",
    needs_review: true,
    review_reason: `Models disagree (Gemini: ${gStatus}, Claude: ${cStatus}). Taken as "${conservative}" (more conservative) pending your review.`,
    gemini,
    claude,
  };
}

/**
 * Judge a single requirement against the corpus with both models and adjudicate.
 * requirement: { name, legislation_ref, domain } (domain = human domain name, for context).
 */
async function judgeRequirement(requirement, corpus) {
  const user = `REQUIREMENT: ${requirement.name} (${requirement.legislation_ref || ""}) [domain: ${requirement.domain || ""}]

DOCUMENTS:
"""
${corpus}
"""`;
  const [g, c] = await Promise.all([callGeminiJudge(user), callClaudeJudge(user)]);
  return adjudicate(corpus, g, c);
}

module.exports = {
  GEMINI_MODEL,
  CLAUDE_MODEL,
  SEVERITY_SCORES,
  JUDGE_SYSTEM,
  norm,
  verifyQuote,
  adjudicate,
  judgeRequirement,
};
