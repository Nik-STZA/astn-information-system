/**
 * Independent reviewer: the last check before Nik's sign-off.
 * Design: docs/brief-pipeline-design.md, section 6.
 *
 * Sees only the draft, the verifier's record for each item and the source
 * texts the verifier read. It never sees the editor's reasoning or drafts.
 * It does not edit: it returns pass or fail with findings in the
 * style-review format (location, rule, text, suggested fix, severity).
 *
 * Code checks (server-lib-brief-checks.js) cover what code does reliably:
 * links, lede length, lead length, empty and one-item sections, the
 * editor's note, banned words, ambiguous countries, "ASTN". Claude Opus 5.5
 * covers the rest of the africanstn-editorial section 7 checklist and
 * stza-house-style section 4. The result is computed in code: any
 * 'must fix' finding or any failed checklist line fails the brief.
 *
 * Behind the REVIEW flag ("on"). Needs ANTHROPIC_API_KEY.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { codeChecks, markdownHash } = require("./server-lib-brief-checks");

const REVIEW_MODEL = process.env.REVIEW_MODEL || "claude-opus-5-5";
const REVIEW_VERSION = "reviewer-1";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SOURCE_CHARS = 6000; // per source; enough for a news article's substance

// africanstn-editorial section 7, the lines the model judges. Lines that
// code judges (links, lede length, lead and sections, brand) are merged in.
const CHECKLIST = [
  { id: "named_source", text: "Every item names its source publication or organisation in the copy." },
  { id: "new_in_week", text: "Every item is new in the week covered, or says what is new this week." },
  { id: "figures_match", text: "Every figure matches its source; database figures come from published_figures with an as-at date." },
  { id: "in_scope", text: "No item is out of scope: each involves African sport, African sports organisations or African markets, with a business or technology angle (not a result, transfer, injury or ban on its own)." },
  { id: "technology", text: "Every item names the technology involved, or says plainly why there is none." },
  { id: "ledes", text: "Ledes say who did what, where and how much." },
  { id: "why_it_matters", text: "\"Why it matters\" lines add something the facts do not, and are kept separate from the news." },
  { id: "analysis_supported", text: "Nothing in the editor's note, \"why it matters\" lines or any summary or context section states a fact the items do not support." },
  { id: "ai_writing", text: "stza-house-style section 4 (AI-writing check) passes: no staging, rhythm by rule, inflation, decorative formatting or chatbot leftovers." },
];

const REVIEW_SYSTEM_PROMPT = `You are the independent reviewer for AfricanSTN's Weekly Intelligence Brief, a neutral specialist news outlet on the business and technology of sport in Africa, written in British English. You did not write this brief and you do not rewrite it. You check it and report.

You are given: the draft brief in markdown; for each item it is meant to contain, the verifier's record (its verdict, the problems it found, the edits it required, the claims it checked with the supporting source sentence); and the source articles' text as the verifier read them. Judge only from these. Do not use outside knowledge to confirm or deny anything.

For each checklist line, answer pass or fail with a one-sentence note naming the item or passage. Then list findings: every specific problem, with its location (item headline or section), the rule, the exact text (quote it), a suggested fix, and a severity:
- must fix: a factual risk (a claim or figure the sources do not support, an item the verifier failed or could not verify, a required edit from the verifier that the copy ignores, a fact in analysis that no item supports, an out-of-scope item), or AI-writing patterns 1 to 5 (contrasts that stage instead of state, dramatic closers, empty sayings, run-ups before the point, arguing with an imagined objector);
- should fix: other AI-writing patterns, house style, missing technology line, weak "why it matters";
- note: preference.

Ignore the HTML comment that marks the editor's note as a draft for Nik: it is deliberate, and the publish gate makes sure it is removed. Review the note's text as written.

Be specific and complete, but do not invent problems: if a line passes, say so. Check every sentence of any summary, context or editor's note section against the items: each fact there must appear in an item in this brief.`;

const SCHEMA = {
  type: "object",
  properties: {
    checklist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: CHECKLIST.map((c) => c.id) },
          result: { type: "string", enum: ["pass", "fail"] },
          note: { type: "string" },
        },
        required: ["id", "result", "note"],
        additionalProperties: false,
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          location: { type: "string" },
          rule: { type: "string" },
          text: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string", enum: ["must fix", "should fix", "note"] },
        },
        required: ["location", "rule", "text", "fix", "severity"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["checklist", "findings", "summary"],
  additionalProperties: false,
};

function verifierBlock(v, i) {
  if (!v) return `${i + 1}. No verifier record.`;
  const r = v.reading || {};
  const claims = (r.claims || []).map((c) => `   - ${c.claim} [${c.in_source}${c.is_estimate ? ", estimate" : ""}] source: "${String(c.source_quote).slice(0, 200)}"`).join("\n");
  return `${i + 1}. ${v.title}
   Link: ${v.url}
   Verifier: ${v.decision.toUpperCase()}. ${v.reason}
   Problems: ${(v.problems || []).join(" | ") || "none"}
   Required edits: ${(v.required_edits || []).join(" | ") || "none"}
   Event date: ${r.event_date || "unknown"}; technology: ${r.technology || "unknown"}
   Claims checked:
${claims || "   (none)"}`;
}

function userMessage({ markdown, weekLabel, verified, sources }) {
  const src = sources.map((s, i) => `--- Source ${i + 1}: ${s.url}\n${String(s.text || "(not available)").slice(0, SOURCE_CHARS)}`).join("\n\n");
  return `Week covered: ${weekLabel}

CHECKLIST
${CHECKLIST.map((c) => `- ${c.id}: ${c.text}`).join("\n")}

DRAFT BRIEF
${markdown}

VERIFIER RECORDS FOR THE ITEMS
${verified.map(verifierBlock).join("\n\n")}

SOURCE TEXTS
${src}`;
}

// Checklist lines judged by code, from the code findings.
function codeChecklist(findings) {
  const failed = (re) => findings.some((f) => re.test(f.rule) && f.severity === "must fix");
  return [
    { id: "source_link", text: "Every item has a working source link.", result: failed(/source link/) ? "fail" : "pass", note: "code check" },
    { id: "structure", text: "The issue has a lead story, varied item lengths and no empty sections.",
      result: failed(/lead story|empty sections|thin weeks/) ? "fail" : "pass", note: "code check" },
    { id: "brand", text: "Names follow africanstn-brand (never ASTN externally).", result: failed(/ASTN/) ? "fail" : "pass", note: "code check" },
  ];
}

/**
 * Review a draft.
 * @param {object} p
 * @param {string} p.markdown         the brief as it will be published
 * @param {string} p.weekLabel        e.g. "2026-11-13 to 2026-11-19"
 * @param {object[]} p.verified       verifier records for the brief's items
 * @param {object[]} p.sources        [{url, text}] as the verifier read them
 * @returns {Promise<{result, markdown_hash, checklist, findings, summary, usage, model, version}>}
 */
async function reviewBrief({ markdown, weekLabel, verified = [], sources = [] }, { anthropic = new Anthropic() } = {}) {
  const code = codeChecks(markdown);
  let model = { checklist: [], findings: [], summary: "Model review not completed." };
  let usage = null, error = null;
  try {
    // Streamed: a review at high effort can run long, and the SDK refuses a
    // non-streamed request whose max_tokens could exceed its timeout.
    const msg = await anthropic.beta.messages.stream({
      model: REVIEW_MODEL,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: REVIEW_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage({ markdown, weekLabel, verified, sources }) }],
    }).finalMessage();
    usage = msg.usage;
    if (msg.stop_reason === "refusal") error = "refusal";
    else model = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  } catch (e) {
    error = e.message;
  }

  const checklist = [
    ...codeChecklist(code.findings),
    ...CHECKLIST.map((c) => {
      const m = model.checklist.find((x) => x.id === c.id);
      return { id: c.id, text: c.text, result: m ? m.result : "fail", note: m ? m.note : "Not reviewed." };
    }),
  ];
  const findings = [...code.findings.map((f) => ({ ...f, by: "code" })), ...model.findings.map((f) => ({ ...f, by: "model" }))];
  // A failed or missing model review fails the brief: it must never pass unread.
  const result = error || checklist.some((c) => c.result === "fail") || findings.some((f) => f.severity === "must fix") ? "fail" : "pass";
  return {
    result,
    markdown_hash: markdownHash(markdown),
    checklist,
    findings,
    summary: error ? `Review incomplete (${error}).` : model.summary,
    usage,
    model: REVIEW_MODEL,
    version: REVIEW_VERSION,
  };
}

function isEnabled(env = process.env) {
  return String(env.REVIEW || "").toLowerCase() === "on";
}

module.exports = { REVIEW_MODEL, REVIEW_VERSION, CHECKLIST, reviewBrief, isEnabled };
