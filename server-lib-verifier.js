/**
 * Verifier: checks an approved item against its source before the editor
 * writes anything. Design: docs/brief-pipeline-design.md, section 4.
 *
 * Code does what code can do reliably (does the page open, when did the
 * source publish it, which place names are ambiguous). Claude Opus 5.5 reads
 * the item against the source text for the rest (every claim and figure,
 * when the event itself happened, what a procedural story decides, the
 * technology involved). A second call with web search looks for another
 * source when only one outlet reports the claim.
 *
 * The verdict is computed in code from those answers, never taken from the
 * model's own summary, so the rules stay visible:
 *   unverified  the source does not open, or no claim could be checked
 *   fail        a claim or figure is not in the source, or the story is not
 *               new in the week
 *   pass        everything checks out; required_edits lists what the editor
 *               must still do (attribute an estimate, name a country fully,
 *               attribute a single-source claim plainly)
 *
 * Behind the VERIFY flag ("on"). Needs ANTHROPIC_API_KEY.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { fetchSource } = require("./server-lib-source-fetch");

const VERIFY_MODEL = process.env.VERIFY_MODEL || "claude-opus-5-5";
const VERIFY_VERSION = "verifier-1";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// ─── Week ──────────────────────────────────────────────────────────────────
// A brief's week runs Friday to Thursday; week_ending is the Thursday.
function weekBounds(weekEnding) {
  const end = new Date(`${String(weekEnding).slice(0, 10)}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive, label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}` };
}

// ─── Ambiguous place names (africanstn-editorial section 3) ───────────────
const AMBIGUOUS = [
  { name: "Congo", re: /(?<!Republic of (the )?|DR |Democratic Republic of (the )?)\bCongo\b(?![- ]?(Brazzaville|Kinshasa))/i,
    advice: "Say Republic of Congo (Congo-Brazzaville) or DR Congo." },
  { name: "Guinea", re: /(?<!Equatorial |Papua New )\bGuinea\b(?!-Bissau)/i,
    advice: "Check it is Guinea, not Guinea-Bissau or Equatorial Guinea, and say so if the source is unclear." },
  { name: "Sudan", re: /(?<!South )\bSudan\b/i, advice: "Check it is Sudan, not South Sudan." },
];
function ambiguousNames(text) {
  return AMBIGUOUS.filter((a) => a.re.test(text)).map(({ name, advice }) => ({ name, advice }));
}

// ─── Related items (the story cluster) ────────────────────────────────────
const STOP = new Set("about after again against their there these those which while would could should african africa sport sports football league first years million billion with from that this have will into over more than under".split(" "));
function tokens(s) {
  return new Set(String(s || "").toLowerCase().match(/[\p{L}\p{N}]{5,}/gu)?.filter((t) => !STOP.has(t)) || []);
}
/**
 * Items reporting the same story, for the "what is being decided" check:
 * the dedup cluster when there is one, else the closest headlines within 10
 * days. Capped so the prompt stays small.
 */
function findRelated(item, pool, { max = 12 } = {}) {
  const t0 = new Date(item.created_at).getTime();
  const mine = tokens(`${item.title} ${item.translated_text || ""}`);
  return pool
    .filter((p) => p.id !== item.id && Math.abs(new Date(p.created_at).getTime() - t0) <= 10 * 864e5)
    .map((p) => {
      const theirs = tokens(`${p.title} ${p.translated_text || ""}`);
      let overlap = 0;
      for (const t of theirs) if (mine.has(t)) overlap++;
      return { p, overlap };
    })
    .filter((x) => x.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, max)
    .map((x) => x.p);
}

// ─── Model reading ─────────────────────────────────────────────────────────
const VERIFY_SYSTEM_PROMPT = `You are the verifier for AfricanSTN, a specialist news outlet on the business and technology of sport in Africa. An editor has approved a news item for this week's brief. Before anyone writes about it, you check the item against the text of its source article.

You are given the item (headline and summary as our pipeline stored them), the source article's text as fetched, the date the source page gives for publication, the week the brief covers, and related items from other outlets that may report the same story.

Work only from the texts you are given. Do not use outside knowledge to confirm or deny a claim.

1. claims: list each factual claim the item makes (who did what, amounts, dates, places, counts). For each, say whether the source supports it ("yes"), supports part of it ("partly") or does not contain it ("no"), and quote the shortest source sentence that supports it, in the source's language. Mark is_estimate true when the figure is the outlet's own estimate, projection or calculation rather than a reported fact.

2. figures_not_in_source: every number in the item (money, percentages, counts, dates) that does not appear in the source text in any form. Treat "US$6m", "$6 million" and "6,000,000 dollars" as the same figure.

3. event_date: when the thing reported actually happened or was announced, according to the source (YYYY-MM-DD, or null if the source does not say). This can differ from the article's publication date: a feature published this week about a deal signed last month has the deal's date. new_this_week is true only if the event, or a new development in it, falls inside the week covered. new_development says what is new this week, or is null.

4. single_source: true when the central claim appears to rest on this outlet alone: the article calls it exclusive, cites no announcement, statement or document from the organisations involved, and no related item from another outlet reports it. central_claim states that claim in one sentence, in English.

5. decided: if the story is about a procedure (a vote, a meeting, a general assembly, a tender, a bid process), say in one sentence what the procedure decides, using the related items if the source does not say. Otherwise null. agenda_unknown is true when the story is about a procedure and neither the source nor the related items say what it will decide or vote on; otherwise false.

6. technology: the technology involved (a platform, system, product, procurement), in one line, or "none stated".

7. names_to_fix: people, organisations or places that the item names wrongly, incompletely or ambiguously compared with the source (for example "Congo" when the source makes clear it is the Republic of Congo). Give the item's wording and the correct form.

8. summary: one sentence in English on what checks out and what does not.`;

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          in_source: { type: "string", enum: ["yes", "partly", "no"] },
          source_quote: { type: "string" },
          is_estimate: { type: "boolean" },
        },
        required: ["claim", "in_source", "source_quote", "is_estimate"],
        additionalProperties: false,
      },
    },
    figures_not_in_source: { type: "array", items: { type: "string" } },
    event_date: { type: ["string", "null"] },
    new_this_week: { type: "boolean" },
    new_development: { type: ["string", "null"] },
    single_source: { type: "boolean" },
    central_claim: { type: "string" },
    decided: { type: ["string", "null"] },
    agenda_unknown: { type: "boolean" },
    technology: { type: "string" },
    names_to_fix: {
      type: "array",
      items: {
        type: "object",
        properties: { as_written: { type: "string" }, should_be: { type: "string" } },
        required: ["as_written", "should_be"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["claims", "figures_not_in_source", "event_date", "new_this_week", "new_development",
    "single_source", "central_claim", "decided", "agenda_unknown", "technology", "names_to_fix", "summary"],
  additionalProperties: false,
};

function itemBlock(item) {
  return [`Headline: ${item.title || ""}`, item.summary ? `Summary: ${item.summary}` : null,
    item.translated_text && item.translated_text !== item.summary ? `English translation: ${item.translated_text}` : null]
    .filter(Boolean).join("\n");
}

function userMessage(item, source, week, related) {
  const rel = related.length
    ? related.map((r, i) => `${i + 1}. [${r.source_name}, ${String(r.created_at).slice(0, 10)}] ${r.title}${r.translated_text ? ` (English: ${String(r.translated_text).slice(0, 300)})` : ""}`).join("\n")
    : "None found.";
  return `Week covered: ${week.label}

ITEM
Source outlet: ${item.source_name}
Link: ${item.url}
${itemBlock(item)}

SOURCE ARTICLE (fetched ${source.fetchedAt.slice(0, 10)}; page gives publication date ${source.published.date ? source.published.date.slice(0, 10) : "unknown"}${source.published.where ? `, from ${source.published.where}` : ""})
${source.text}

RELATED ITEMS FROM THE SAME PERIOD
${rel}`;
}

async function readAgainstSource(anthropic, item, source, week, related) {
  const msg = await anthropic.beta.messages.create({
    model: VERIFY_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: VERIFY_SCHEMA } },
    system: [{ type: "text", text: VERIFY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage(item, source, week, related) }],
  });
  if (msg.stop_reason === "refusal") return { reading: null, usage: msg.usage, error: "refusal" };
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return { reading: JSON.parse(text), usage: msg.usage };
  } catch {
    return { reading: null, usage: msg.usage, error: "unparseable" };
  }
}

// ─── Corroboration: second source and what a procedure decides ─────────────
// One web-search call that does up to two jobs:
//  - second source, when no other outlet in our feed reports the story (or
//    the reading says it rests on one outlet);
//  - agenda, when the story is a procedure (vote, meeting, assembly, tender)
//    and our own items do not say what it decides. The w/e 19 Nov Zamalek
//    item needed this: the 8 December vote's subject (a football company open
//    to investors) was in no item in the feed.
async function corroborate(anthropic, item, reading, { needSecond, needAgenda }) {
  const jobs = [];
  if (needSecond) {
    jobs.push(`SECOND SOURCE. Find a second source for this claim, reported by ${item.source_name} (${item.url}): "${reading.central_claim}". A second source is the announcement of an organisation involved (its website, press release or official social account) or an independent news report that does not simply repeat ${item.source_name}.`);
  }
  if (needAgenda) {
    jobs.push(`AGENDA. The story is about a procedure: "${reading.decided}". Find what that procedure will actually decide or vote on (the agenda, the motion, the subject of the vote), from the organisation or from news reports. If reports conflict, say so.`);
  }
  const request = () => anthropic.beta.messages.create({
    model: VERIFY_MODEL,
    max_tokens: 8000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low" },
    // Dynamic-filtering search runs its queries inside code execution; a
    // failed filtering script still spends searches, so allow headroom.
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: needSecond && needAgenda ? 8 : 6 }],
    messages: [{
      role: "user",
      content: `You check facts for a news outlet. Search the web for the following, and report only what you find in sources you open; never fill gaps from memory.

${jobs.join("\n\n")}

End your reply with one line of JSON and nothing after it:
{"found": true or false (second source), "url": "best second source or null", "kind": "announcement" or "independent report" or null, "note": "one sentence", "agenda": "what the procedure decides, one sentence, or null", "agenda_url": "source for the agenda or null"}`,
    }],
  });
  // A search error comes back as HTTP 200 with an error object in the result
  // block, not as an exception. If every search failed, wait and retry once;
  // if it fails again, report the search as failed rather than "not found".
  const searchFailed = (m) => {
    const results = m.content.filter((b) => b.type === "web_search_tool_result");
    return results.length > 0 && results.every((b) => !Array.isArray(b.content));
  };
  let msg = await request();
  if (searchFailed(msg)) {
    await new Promise((r) => setTimeout(r, 20000));
    msg = await request();
  }
  if (searchFailed(msg)) {
    const code = msg.content.find((b) => b.type === "web_search_tool_result")?.content?.error_code || "error";
    return {
      second: { found: null, url: null, kind: null, note: `Web search failed (${code}); corroboration not done.`, agenda: null, agenda_url: null, search_failed: true },
      usage: msg.usage,
    };
  }
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[^{}]*"found"[^{}]*\}\s*$/);
  const empty = { found: false, url: null, kind: null, note: "No answer", agenda: null, agenda_url: null };
  try {
    const parsed = m ? { ...empty, ...JSON.parse(m[0]) } : empty;
    if (!needSecond) Object.assign(parsed, { found: null, url: null, kind: null });
    return { second: parsed, usage: msg.usage };
  } catch {
    return { second: { ...empty, note: "Unreadable answer" }, usage: msg.usage };
  }
}

// ─── Verdict ───────────────────────────────────────────────────────────────
function decide({ source, week, reading, second, ambiguous, outlet = "the outlet" }) {
  const problems = [];
  const edits = [];

  if (!source.ok) {
    return { decision: "unverified", reason: `Source could not be read: ${source.reason}.`, problems: [source.reason], required_edits: [] };
  }
  if (!reading) {
    return { decision: "unverified", reason: "The source opened but the check could not be completed.", problems: ["model reading failed"], required_edits: [] };
  }

  const pub = source.published.date ? new Date(source.published.date) : null;
  const before = pub && pub < week.start;
  const after = pub && pub >= week.endExclusive;
  const eventBefore = reading.event_date && new Date(reading.event_date) < week.start;
  if ((before || eventBefore) && !reading.new_this_week) {
    const when = before ? `published ${source.published.date.slice(0, 10)}` : `event dated ${reading.event_date}`;
    problems.push(`Not new in the week (${week.label}): ${when}.`);
  } else if ((before || eventBefore) && reading.new_this_week) {
    edits.push(`Say what is new this week: ${reading.new_development || "state the new development"}.`);
  }
  if (after) problems.push(`Published after the week ended (${source.published.date.slice(0, 10)}).`);
  if (!pub) edits.push("The source gives no publication date; confirm it is from this week.");

  const missing = reading.claims.filter((c) => c.in_source === "no");
  for (const c of missing) problems.push(`Not in the source: ${c.claim}`);
  for (const f of reading.figures_not_in_source) problems.push(`Figure not in the source: ${f}`);
  for (const c of reading.claims.filter((c) => c.in_source === "partly")) edits.push(`Only partly supported, state what the source says: ${c.claim}`);
  for (const c of reading.claims.filter((c) => c.is_estimate && c.in_source !== "no")) {
    edits.push(`Label as ${outlet}'s estimate and attribute it: ${c.claim}`);
  }

  for (const n of reading.names_to_fix) edits.push(`Write "${n.should_be}", not "${n.as_written}".`);
  for (const a of ambiguous) {
    if (!reading.names_to_fix.some((n) => n.as_written.includes(a.name))) edits.push(`${a.name} is ambiguous. ${a.advice}`);
  }

  if (second && second.search_failed) {
    edits.push(`Corroboration not done: ${second.note} Check for a second source by hand or re-run the verifier.`);
  } else if (second && second.found === true) {
    edits.push(`Second source found: ${second.url} (${second.kind}).`);
  } else if (second && second.found === false) {
    edits.push(`Only ${outlet} reports it and no second source was found: attribute it plainly ("${outlet} reported"). ${second.note || ""}`.trim());
  }
  if (second && second.agenda) {
    edits.push(`Report what is being decided: ${second.agenda}${second.agenda_url ? ` (source: ${second.agenda_url})` : ""}`);
  } else if (reading.decided) {
    edits.push(`Report what is being decided: ${reading.decided}`);
  }
  if (reading.claims.length === 0) {
    return { decision: "unverified", reason: "No checkable claim found in the item.", problems: [], required_edits: edits };
  }

  return problems.length
    ? { decision: "fail", reason: problems[0], problems, required_edits: edits }
    : { decision: "pass", reason: edits.length ? `Checks out, with ${edits.length} required edit${edits.length > 1 ? "s" : ""}.` : "Checks out against the source.", problems, required_edits: edits };
}

/**
 * Verify one item. related: other items that may report the same story.
 * @returns record suitable for item_screen_decisions (step 'verify') plus the
 *          fetched source for item_sources.
 */
async function verifyItem(item, { weekEnding, related = [], anthropic = new Anthropic() } = {}) {
  const week = weekBounds(weekEnding);
  const source = await fetchSource(item.url);
  const ambiguous = ambiguousNames(`${item.title} ${item.summary || ""}`);
  let reading = null, second = null, error = null;
  const usage = [];
  if (source.ok) {
    try {
      const r = await readAgainstSource(anthropic, item, source, week, related);
      reading = r.reading; error = r.error || null; usage.push(r.usage);
      if (reading) {
        const otherOutlet = related.some((r) => r.source_name && r.source_name !== item.source_name);
        const needSecond = reading.single_source || !otherOutlet;
        const needAgenda = Boolean(reading.agenda_unknown);
        if (needSecond || needAgenda) {
          const s = await corroborate(anthropic, item, reading, { needSecond, needAgenda });
          second = s.second; usage.push(s.usage);
        }
      }
    } catch (e) {
      error = e.message;
    }
  }
  const verdict = decide({ source, week, reading, second, ambiguous, outlet: item.source_name || "the outlet" });
  return {
    item_id: item.id,
    ...verdict,
    detail: {
      week: week.label,
      source: { url: source.url, final_url: source.finalUrl, status: source.status, published: source.published, text_hash: source.textHash },
      reading, second_source: second, ambiguous, error,
    },
    source,
    usage,
    version: VERIFY_VERSION,
  };
}

function isEnabled(env = process.env) {
  return String(env.VERIFY || "").toLowerCase() === "on";
}

module.exports = {
  VERIFY_MODEL, VERIFY_VERSION, VERIFY_SYSTEM_PROMPT, VERIFY_SCHEMA,
  weekBounds, ambiguousNames, findRelated, decide, verifyItem, isEnabled,
};
