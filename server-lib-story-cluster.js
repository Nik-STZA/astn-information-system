/**
 * Story clustering: the third gate, after the scope check. Groups items that
 * report the same underlying story (eight Zamalek pieces on one football
 * company plan, the same appointment from two outlets) so Nik reviews each
 * story once.
 *
 * One synchronous Claude Haiku call per run over the in-scope items (20-40 a
 * week): word overlap cannot match an Arabic headline to an English one, a
 * model can. Items are numbered in the prompt and mapped back in code, and
 * the code repairs the answer (every item lands in exactly one story), so a
 * bad answer can only fail to merge, never lose an item.
 *
 * Each story gets a lead item; the others are marked as duplicates of it
 * (recorded in item_screen_decisions with step 'dedup', reversible).
 */

const Anthropic = require("@anthropic-ai/sdk");

const CLUSTER_MODEL = process.env.CLUSTER_MODEL || "claude-haiku-5-5";
const CLUSTER_VERSION = "story-cluster-1";

const CLUSTER_SYSTEM_PROMPT = `You group news items that report the same underlying story, for an editor who wants to review each story once.

Two items are the same story when they report the same event, decision, deal, appointment or dispute involving the same organisation, even if they are in different languages, quote different people or add different details. Follow-ups within the same week on the same decision (a proposal, then reactions to it, then the terms) are the same story.

Items are different stories when they involve different organisations, or different decisions by the same organisation (a club's football company plan and the same club's coach appointment are two stories; two different sponsorship deals are two stories even if they are both sponsorships).

Every item number must appear in exactly one story. A story may have one item. For each story write a short English label (at most 12 words) naming the organisation and what happened.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          items: { type: "array", items: { type: "integer" } },
        },
        required: ["label", "items"],
        additionalProperties: false,
      },
    },
  },
  required: ["stories"],
  additionalProperties: false,
};

function listItems(items) {
  return items
    .map((it, i) => {
      const text = [it.title, it.translated_text || it.summary].filter(Boolean).join(" | ").slice(0, 600);
      return `${i + 1}. [${it.source_name || "?"}] ${text}`;
    })
    .join("\n");
}

/**
 * Pick the lead of a story: an Africa sport-business source first, then an
 * English item (Nik reads the queue in English), then the longest text.
 */
function pickLead(group, { preferredSources = [] } = {}) {
  const pref = new Set(preferredSources.map((s) => s.toLowerCase()));
  const score = (it) =>
    (pref.has(String(it.source_name || "").toLowerCase()) ? 1e6 : 0) +
    (/[؀-ۿ]/.test(it.title || "") ? 0 : 1e5) +
    String(it.summary || it.translated_text || "").length;
  return [...group].sort((a, b) => score(b) - score(a))[0];
}

/** Turn the model's answer into complete, non-overlapping stories. */
function repair(items, answer) {
  const seen = new Set();
  const stories = [];
  for (const s of (answer && answer.stories) || []) {
    const idx = [...new Set(s.items)].filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length && !seen.has(n));
    idx.forEach((n) => seen.add(n));
    if (idx.length) stories.push({ label: String(s.label || "").slice(0, 120), members: idx.map((n) => items[n - 1]) });
  }
  items.forEach((it, i) => {
    if (!seen.has(i + 1)) stories.push({ label: it.title, members: [it] });
  });
  return stories;
}

/**
 * @param {Array<{id:string,title:string,summary?:string,translated_text?:string,source_name?:string}>} items
 * @returns {Promise<{stories: Array<{label:string, lead:object, duplicates:object[]}>, usage:object|null}>}
 */
async function clusterStories(items, { anthropic = new Anthropic(), preferredSources = [] } = {}) {
  if (items.length < 2) {
    return { stories: items.map((it) => ({ label: it.title, lead: it, duplicates: [] })), usage: null };
  }
  let answer = null;
  let usage = null;
  try {
    const msg = await anthropic.messages.create({
      model: CLUSTER_MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: CLUSTER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: listItems(items) }],
    });
    usage = msg.usage;
    if (msg.stop_reason !== "refusal") {
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      answer = JSON.parse(text);
    }
  } catch (e) {
    // Fall through: every item becomes its own story. Clustering failing must
    // never hide an item.
    console.error(`Story clustering failed, leaving items unmerged: ${e.message}`);
  }
  const stories = repair(items, answer).map((s) => {
    const lead = pickLead(s.members, { preferredSources });
    return { label: s.label, lead, duplicates: s.members.filter((m) => m !== lead) };
  });
  return { stories, usage };
}

module.exports = { CLUSTER_MODEL, CLUSTER_VERSION, CLUSTER_SYSTEM_PROMPT, clusterStories, repair, pickLead, listItems };
