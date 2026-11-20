/**
 * Scope check: the second gate in the brief pipeline, run only on items the
 * rule screen kept (server-lib-rule-screen.js).
 *
 * One Claude Haiku call per item, sent through the Message Batches API (half
 * price) with the instructions cached. The model answers three separate
 * yes/no questions, so the two failure types ("not Africa", "not sport") stay
 * distinguishable, plus a third for the editorial angle:
 *   africa   - involves African sport, African sports organisations or African markets
 *   sport    - is about sport (including esports and the sports industry)
 *   business - has a business, technology, investment, rights or
 *              infrastructure angle; not a result, transfer, injury or ban
 * All three yes = in scope. The one-line reason is stored with the decision.
 *
 * Behind the SCOPE_CHECK flag ("on" to enable); see isEnabled().
 * Needs ANTHROPIC_API_KEY (from Secret Manager, secret "anthropic-api-key").
 */

const Anthropic = require("@anthropic-ai/sdk");

const SCOPE_MODEL = process.env.SCOPE_MODEL || "claude-haiku-5-5";
const SCOPE_VERSION = "scope-check-1";

// Frozen: any change here invalidates the prompt cache and the evaluation.
// Bump SCOPE_VERSION whenever it changes.
const SCOPE_SYSTEM_PROMPT = `You screen news items for AfricanSTN, a specialist publication on the business and technology of sport in Africa. Its readers are investors and funds looking at African sport and sports tech, international sports tech companies weighing entry into African markets, and African founders, federations and clubs who want to know what peers are doing.

For each item, answer three separate yes/no questions, then give a one-line reason. Judge only from the title and text you are given. Items may be in English, French, Portuguese or Arabic.

1. africa: Does the story involve African sport, an African sports organisation, an African athlete in a commercial role, or an African market? Yes when the deal, venue, organisation, audience or market is in Africa, or an African organisation is a party. No when Africa is absent, or only a passing mention in a story about somewhere else. A global body's decision counts only if the item says what it means for Africa.

2. sport: Is the story about sport? Sport includes professional and grassroots sport, esports, sports media and broadcasting, sports venues, sports betting as an industry, fitness and the sports technology industry. No for general technology, fintech, telecoms, payments, AI, start-up funding or creative industries with no sport in them, and for video games that are not esports.

3. business: Is it about a deal, funding round, investment, broadcast or media rights, sponsorship, partnership, product or platform launch, regulation or policy, government budget, infrastructure (stadiums, venues, facilities), technology adoption, a hosting bid, governance or a leadership change at an organisation, or market data? No for match results, previews, predictions, line-ups, player transfers and transfer rumours, contracts of individual players, injuries, disciplinary cases and bans, coaching appointments of teams, fixtures and kick-off times, betting tips and promotions, opinion about on-field performance, and personal stories of athletes. A result, transfer or ban is a yes only if the item states a commercial or technology consequence (for example, a ban that voids a sponsorship, or a transfer fee that funds a stadium).

in_scope is true only when all three answers are yes.

The reason is one sentence of at most 25 words. Name what decided it: the missing element when out of scope, or the business or technology angle when in scope. Write in English.

Examples (illustrative, not from the items you will see):
- "Rwanda signs three-year deal for national league streaming on a new OTT platform" -> africa yes, sport yes, business yes. Reason: Broadcast rights and streaming platform deal for Rwanda's national league.
- "Enyimba beat Rangers 2-0 to go top of the NPFL" -> africa yes, sport yes, business no. Reason: Match result with no commercial or technology consequence.
- "Lagos fintech raises $8m Series A to expand card payments" -> africa yes, sport no, business yes. Reason: African fintech funding with no sport involved.
- "Premier League agrees new US broadcast deal" -> africa no, sport yes, business yes. Reason: Global sport rights deal with no African link.
- "Moroccan federation adopts video assistant referee system for top league" -> africa yes, sport yes, business yes. Reason: Technology adoption (VAR) by Morocco's federation.
- "Striker joins Saudi club on two-year contract" -> africa no or yes depending on the player, sport yes, business no. Reason: Player transfer, out of scope.
- "Kenya allocates KSh2bn to upgrade three stadiums ahead of AFCON 2027" -> africa yes, sport yes, business yes. Reason: Government infrastructure spending on stadiums for AFCON 2027.
- "Club board approves electronic voting and a plan to create a football company open to investors" -> africa yes (if the club is African), sport yes, business yes. Reason: Governance and investment structure change, with e-voting technology.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    africa: { type: "boolean" },
    sport: { type: "boolean" },
    business: { type: "boolean" },
    in_scope: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["africa", "sport", "business", "in_scope", "reason"],
  additionalProperties: false,
};

function itemText(item) {
  const parts = [`Title: ${item.title || ""}`];
  if (item.source_name) parts.push(`Source: ${item.source_name}`);
  if (item.summary) parts.push(`Text: ${item.summary}`);
  if (item.translated_text && item.translated_text !== item.summary) {
    parts.push(`English translation: ${item.translated_text}`);
  }
  return parts.join("\n");
}

/** Messages API params for one item. Identical system block on every call, so it caches. */
function buildParams(item) {
  return {
    model: SCOPE_MODEL,
    max_tokens: 1024, // room for brief thinking plus the JSON answer
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: [{ type: "text", text: SCOPE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: itemText(item) }],
  };
}

/**
 * Turn a Message into a decision record. Never throws: a malformed or refused
 * answer becomes decision "keep" with an error reason, so nothing is archived
 * on a model failure and Nik still sees the item.
 */
function parseMessage(message) {
  if (!message || message.stop_reason === "refusal") {
    return { decision: "keep", error: "refusal", reason: "Scope check declined; left for review.", answers: null };
  }
  const text = (message.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    const a = JSON.parse(text);
    const inScope = Boolean(a.africa && a.sport && a.business);
    return {
      decision: inScope ? "keep" : "archive",
      reason: String(a.reason || "").slice(0, 300),
      answers: { africa: !!a.africa, sport: !!a.sport, business: !!a.business },
      model_in_scope: !!a.in_scope,
    };
  } catch {
    return { decision: "keep", error: "unparseable", reason: "Scope check answer unreadable; left for review.", answers: null };
  }
}

function client() {
  return new Anthropic(); // reads ANTHROPIC_API_KEY
}

/** Submit one batch. items need a stable string id. Returns the batch id. */
async function submitBatch(items, anthropic = client()) {
  const batch = await anthropic.messages.batches.create({
    requests: items.map((it) => ({ custom_id: String(it.id), params: buildParams(it) })),
  });
  return batch.id;
}

/** Poll until the batch ends. */
async function waitForBatch(batchId, anthropic = client(), { intervalMs = 30_000, onPoll } = {}) {
  for (;;) {
    const b = await anthropic.messages.batches.retrieve(batchId);
    if (onPoll) onPoll(b);
    if (b.processing_status === "ended") return b;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Collect results keyed by custom_id, with usage for costing. */
async function collectResults(batchId, anthropic = client()) {
  const out = new Map();
  for await (const r of await anthropic.messages.batches.results(batchId)) {
    if (r.result.type === "succeeded") {
      out.set(r.custom_id, { ...parseMessage(r.result.message), usage: r.result.message.usage });
    } else {
      out.set(r.custom_id, { decision: "keep", error: r.result.type, reason: `Scope check ${r.result.type}; left for review.`, answers: null });
    }
  }
  return out;
}

function isEnabled(env = process.env) {
  return String(env.SCOPE_CHECK || "").toLowerCase() === "on";
}

module.exports = {
  SCOPE_MODEL, SCOPE_VERSION, SCOPE_SYSTEM_PROMPT, OUTPUT_SCHEMA,
  buildParams, parseMessage, itemText, submitBatch, waitForBatch, collectResults, isEnabled,
};
