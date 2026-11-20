/**
 * Editor: writes the Weekly Intelligence Brief from verified items only.
 * Design: docs/brief-pipeline-design.md, section 5. Standard:
 * africanstn-editorial sections 3 to 5 and stza-house-style.
 *
 * Input: items with a verifier pass (or Nik's recorded override), each with
 * its verifier record (claims and the source sentences behind them, required
 * edits, technology, what a procedure decides) and the source text the
 * verifier read. The editor may use only those facts.
 *
 * Output: markdown in the format the OS brief editor and africanstn.com
 * already parse (## sections, ### items, a *Source: [Outlet](URL)* line per
 * item), plus which items it used or dropped and why. The editor's note is
 * a draft for Nik, marked with DRAFT_NOTE_MARKER; the publish gate refuses a
 * brief that still carries the marker.
 *
 * reviseBrief() takes the reviewer's findings and returns a corrected draft.
 * Behind the EDITOR flag ("on"). Needs ANTHROPIC_API_KEY.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { DRAFT_NOTE_MARKER } = require("./server-lib-brief-checks");

const EDITOR_MODEL = process.env.EDITOR_MODEL || "claude-opus-5-5";
const EDITOR_VERSION = "editor-1";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SOURCE_CHARS = 5000;

const EDITOR_SYSTEM_PROMPT = `You are the editor of AfricanSTN's Weekly Intelligence Brief. AfricanSTN is a neutral, specialist news outlet on the business and technology of sport in Africa. It writes like a good trade publication: informative, sourced, specific, readable in five minutes by a busy investor or an international company deciding whether to enter an African market. It does not write like a company newsletter or a press release.

Readers: investors and funds looking at African sport and sports tech; international sports tech companies weighing entry into African markets; African founders, federations and clubs who want to know what peers are doing. Each item answers what happened and why it matters to one of them.

FACTS
- Use only facts in the verifier's records and the source texts you are given. Never add a fact, figure, name, date or quote from anywhere else, and never infer one.
- Apply every "required edit" in an item's verifier record: attribute estimates to the outlet that made them, write names in the corrected form, attribute single-source claims plainly ("Business of Sports Africa reported"), report what a procedure decides.
- Every item names its source publication or organisation in the copy and ends with a source line in exactly this form: *Source: [Outlet name](URL)*
- If the source does not support an item well enough to write it, drop it and say why.

WRITING (British English)
- Lede: who did what, where and how much, in 35 words or fewer. Most important first.
- Attribute with "said", never "stated", "noted" or "revealed". Full name and lower-case job title on first mention, surname after. Organisations in full first, short form after. Countries unambiguous (Republic of Congo or DR Congo, never "Congo" alone).
- Numbers: one to nine in words, 10 and above in figures; always figures for money and percentages. Money: currency then figure, m and bn: US$6m, GH¢600m, KSh380m. Dates: 19 November 2026.
- Headlines: sentence case, present tense for past events, "to" for future ones, no full stop, no exclamation mark, no puns. Single quotation marks in headlines, double in copy.
- Neutral tone. No "exciting", "game-changing", "landmark" unless quoted. Let the numbers carry the weight.
- Find the technology angle: say what technology is involved (platform, system, procurement) and what it means for people who build, buy or invest in it. Where the verifier says none is stated, either say plainly that none was named, or leave it out if it adds nothing.
- Avoid these patterns: "not X but Y" contrasts; dramatic one-line closers; run-ups ("Here's the thing"); reflexive lists of three; several sentences starting the same way; dashes as connectors (use a full stop, comma or colon); words such as additionally, crucial, enhance, highlight, key, landscape, leverage, pivotal, robust, seamless, showcase, testament, underscore, unlock, vibrant; inflated significance ("marks a pivotal moment"); vague association ("amid growing interest"); "-ing" tails ("..., highlighting the region's potential"); writing about the document ("This brief explores").

SHAPE
- Pick the week's most important story for readers (money, technology, an organisation they track, consequences beyond one club) and write it as a news piece of 100 to 200 words.
- Other items are one paragraph each. Minor items go in Quick hits, one line each with the source linked inline. Vary length; never give every item the same shape.
- "Why it matters" is one or two sentences of analysis for the readers above, labelled, kept separate from the news, and only where it says something the facts do not. It may not state a fact the item does not contain.
- Section headings only when two or more items belong under them. No empty sections. Do not reuse generic headings such as "Key Developments" or "Funding & Deals" by habit.
- Editor's note: two to four sentences, first person, as Nik Mladenovic, founder of AfricanSTN, saying what he makes of the week (a pattern, a doubt, a question), referring only to facts in the items. It is a draft for Nik to rewrite or approve.
- Fewer than three items survive: write a short issue and say in "dropped" that it is short; never pad.

MARKDOWN FORMAT (exactly)
# <lead story headline>
**Week ending <d Month yyyy> (<d Month> to <d Month yyyy>)**

<standfirst: one sentence on the week, 25 words or fewer>

## The lead
### <lead headline>
<lead story, 100-200 words>

**Why it matters:** <1-2 sentences>

*Source: [Outlet](URL)*

## <section heading, only for 2+ items>
### <item headline>
<one paragraph>

**Why it matters:** <one sentence, only where it adds something>

*Source: [Outlet](URL)*

## Quick hits
- <one line> ([Outlet](URL))

## From the editor
${DRAFT_NOTE_MARKER}
<2-4 sentences>

Nik Mladenovic, founder, AfricanSTN

Omit "Quick hits" if there are none. Items that do not belong under a shared heading go under "## Also this week".`;

const SCHEMA = {
  type: "object",
  properties: {
    markdown: { type: "string" },
    lead_item: { type: "integer" },
    used: { type: "array", items: { type: "integer" } },
    dropped: {
      type: "array",
      items: {
        type: "object",
        properties: { item: { type: "integer" }, reason: { type: "string" } },
        required: ["item", "reason"],
        additionalProperties: false,
      },
    },
    notes_for_nik: { type: "string" },
  },
  required: ["markdown", "lead_item", "used", "dropped", "notes_for_nik"],
  additionalProperties: false,
};

function itemBlock(it, i) {
  const v = it.verify || {};
  const r = v.reading || {};
  const claims = (r.claims || []).filter((c) => c.in_source !== "no")
    .map((c) => `   - ${c.claim}${c.is_estimate ? " [estimate]" : ""}${c.in_source === "partly" ? " [partly supported]" : ""}\n     source: "${String(c.source_quote).slice(0, 300)}"`).join("\n");
  return `ITEM ${i + 1}
Outlet: ${it.source_name}
URL: ${it.url}
Headline as fetched: ${it.title}
Verifier: ${String(v.decision || "").toUpperCase()}${v.override ? " (Nik override)" : ""}. ${v.reason || ""}
Event date: ${r.event_date || "not stated"}
Technology: ${r.technology || "not stated"}
What is being decided: ${r.decided || "n/a"}
Required edits:
${(v.required_edits || []).map((e) => `   - ${e}`).join("\n") || "   none"}
Checked claims:
${claims || "   none"}
Related items reporting the same story: ${(it.related || []).map((r) => `${r.source_name}: ${r.title}`).join(" | ") || "none"}
Source text (as the verifier read it):
${String(it.source_text || "").slice(0, SOURCE_CHARS)}`;
}

function mapBack(out, items) {
  const pick = (n) => items[n - 1] && items[n - 1].id;
  return {
    markdown: out.markdown,
    lead_item_id: pick(out.lead_item) || null,
    used_ids: out.used.map(pick).filter(Boolean),
    dropped: out.dropped.map((d) => ({ id: pick(d.item) || null, reason: d.reason })),
    notes_for_nik: out.notes_for_nik,
  };
}

async function callEditor(anthropic, userContent) {
  const msg = await anthropic.beta.messages.stream({
    model: EDITOR_MODEL,
    max_tokens: 32000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: EDITOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  }).finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The editor declined the request.");
  return { out: JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join("")), usage: msg.usage };
}

/**
 * Draft a brief.
 * @param {object} p
 * @param {string} p.weekEnding  YYYY-MM-DD (the Thursday)
 * @param {string} p.weekLabel   e.g. "2026-11-13 to 2026-11-19"
 * @param {object[]} p.items     [{id, title, source_name, url, verify, source_text, related}]
 */
async function draftBrief({ weekEnding, weekLabel, items }, { anthropic = new Anthropic() } = {}) {
  const usable = items.filter((it) => it.verify && it.verify.decision === "pass");
  const refused = items.filter((it) => !usable.includes(it))
    .map((it) => ({ id: it.id, reason: `Not verified (${it.verify ? it.verify.decision : "no record"}): ${it.verify ? it.verify.reason : ""}` }));
  if (!usable.length) return { markdown: null, lead_item_id: null, used_ids: [], dropped: refused, notes_for_nik: "No verified items this week.", usage: null };

  const content = `Week ending ${weekEnding} (${weekLabel}). Write this week's brief from these ${usable.length} verified items.\n\n${usable.map(itemBlock).join("\n\n")}`;
  const { out, usage } = await callEditor(anthropic, content);
  const mapped = mapBack(out, usable);
  return { ...mapped, dropped: [...refused, ...mapped.dropped], usage, model: EDITOR_MODEL, version: EDITOR_VERSION };
}

/**
 * Revise a draft against the reviewer's findings. Same facts only.
 */
async function reviseBrief({ weekEnding, weekLabel, items, markdown, review }, { anthropic = new Anthropic() } = {}) {
  const usable = items.filter((it) => it.verify && it.verify.decision === "pass");
  const findings = review.findings.filter((f) => f.severity !== "note")
    .map((f) => `- [${f.severity}] ${f.location} | ${f.rule} | "${f.text}" | fix: ${f.fix}`).join("\n");
  const failed = review.checklist.filter((c) => c.result === "fail").map((c) => `- ${c.id}: ${c.note}`).join("\n");
  const content = `Week ending ${weekEnding} (${weekLabel}). The independent reviewer failed your draft. Revise it: fix every "must fix" finding and failed checklist line, and the "should fix" findings where you can. Use only the facts in the items below; do not add anything new to answer a finding. If a finding cannot be fixed with these facts, drop the passage and say so in notes_for_nik.

FAILED CHECKLIST LINES
${failed || "none"}

FINDINGS
${findings || "none"}

YOUR DRAFT
${markdown}

ITEMS
${usable.map(itemBlock).join("\n\n")}`;
  const { out, usage } = await callEditor(anthropic, content);
  return { ...mapBack(out, usable), usage, model: EDITOR_MODEL, version: EDITOR_VERSION };
}

function isEnabled(env = process.env) {
  return String(env.EDITOR || "").toLowerCase() === "on";
}

module.exports = { EDITOR_MODEL, EDITOR_VERSION, EDITOR_SYSTEM_PROMPT, draftBrief, reviseBrief, isEnabled };
