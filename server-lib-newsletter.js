/**
 * Newsletter draft: the published brief made personal enough to open.
 * Design: docs/brief-pipeline-design.md, section 8. Template:
 * africanstn-editorial section 6.
 *
 *   Subject line   the lead story, specific, 50 characters or fewer
 *   Preview text   the second most interesting fact, 90 characters or fewer
 *   Editor's note  first; the brief's own approved note, verbatim
 *   The lead       headline + 60-100 word summary + link to the brief on africanstn.com
 *   Also this week 3-5 one-line items, each with a link
 *   From the registry  one figure from published_figures, with its as-at date
 *   One call to action
 *
 * Works only from a PUBLISHED brief (the research agent's Beehiiv path took
 * whatever row was newest, drafts included). Claude Opus 5.5 writes the
 * parts; code assembles them in template order, checks the limits, and
 * checks the registry figure against published_figures. A second Opus call
 * reviews it: every fact must be in the brief. Sending stays with Nik.
 *
 * Behind the NEWSLETTER flag ("on"). Needs ANTHROPIC_API_KEY.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { parseBrief, AI_WORDS, ambiguousNames, DRAFT_NOTE_MARKER, hasDraftNote } = require("./server-lib-brief-checks");

const NEWSLETTER_MODEL = process.env.NEWSLETTER_MODEL || "claude-opus-5-5";
const NEWSLETTER_VERSION = "newsletter-1";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SITE = "https://africanstn.com";

const CTAS = {
  brief: (url) => `[Read the full brief](${url})`,
  report: () => `[Download The State of African Sports Technology, Edition 2](${SITE}/assets/reports/The-State-of-African-Sports-Technology-Edition-2.pdf)`,
  interest: () => `[Tell us what you are building or investing in](${SITE}/contact/)`,
};

// Figures worth quoting in one line; zeros and confidence shares (which need
// their denominator explained) are left out.
const FIGURE_LINES = {
  total_organizations: "sports organisations tracked across Africa",
  total_countries_iso: "African countries covered",
  total_sports: "sports covered",
  total_startups: "sports tech start-ups identified",
  active_startups: "active sports tech start-ups",
  vertical_business: "organisations in the business of sport",
  vertical_performance: "organisations in performance and elite sport",
  vertical_grassroots: "organisations in grassroots and development",
};

function briefUrl(weekEnding) {
  return `${SITE}/insights/briefs/${String(weekEnding).slice(0, 10)}/`;
}
const fmtDate = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtNumber = (v) => (/^\d+$/.test(String(v)) ? Number(v).toLocaleString("en-GB") : String(v));
const words = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’.,%¢$-]*/gu) || []).length;

/** The brief's editor's note, if it is approved (no draft marker). */
function approvedNote(md) {
  const sec = parseBrief(md).sections.find((s) => /from the editor|editor'?s note/i.test(s.heading || ""));
  if (!sec || !sec.body || hasDraftNote(sec.body)) return null;
  return sec.body.trim();
}

const SYSTEM = `You write the weekly email newsletter for AfricanSTN, a neutral specialist news outlet on the business and technology of sport in Africa, in British English. The newsletter is the published Weekly Intelligence Brief made personal enough to open; it links to the full brief rather than repeating it.

Use only facts in the brief you are given. Never add a fact, figure, name or date. Keep each fact's attribution ("Business of Sports Africa reported").

Write:
- subject: the lead story, specific, 50 characters or fewer, sentence case, no full stop, no exclamation mark, no clickbait.
- preview: the second most interesting fact in the brief, 90 characters or fewer.
- lead_headline and lead_summary: the brief's lead story in 60 to 100 words: who did what, where and how much, and the technology involved if the brief names one.
- also: three to five one-line items (fewer only if the brief has fewer other stories), each one sentence of 30 words or fewer. Do not add links: each line links to the full brief, added by code.
- figure_name: one figure from the registry list given, chosen because it relates to this week's stories if any does; registry_line: one sentence using that exact value, ending without the date (code adds the as-at date).
- cta: "brief", "report" or "interest", the one call to action that fits the week best.
- editor_note: only if no approved editor's note is given: two to four sentences, first person, as Nik Mladenovic, founder of AfricanSTN, saying what he makes of the week, using only facts in the brief. Otherwise an empty string.

Plain words, no hype ("exciting", "game-changing", "landmark"), no "not X but Y" contrasts, no dramatic closers, no lists of three by habit, no dashes as connectors, none of these words: additionally, crucial, enhance, highlight, key, landscape, leverage, pivotal, robust, seamless, showcase, testament, underscore, unlock, vibrant.`;

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    preview: { type: "string" },
    lead_headline: { type: "string" },
    lead_summary: { type: "string" },
    also: { type: "array", items: { type: "string" } },
    figure_name: { type: "string" },
    registry_line: { type: "string" },
    cta: { type: "string", enum: Object.keys(CTAS) },
    editor_note: { type: "string" },
  },
  required: ["subject", "preview", "lead_headline", "lead_summary", "also", "figure_name", "registry_line", "cta", "editor_note"],
  additionalProperties: false,
};

async function stream(anthropic, params) {
  const msg = await anthropic.beta.messages.stream({
    model: NEWSLETTER_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    ...params,
  }).finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined the request.");
  return { text: msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""), usage: msg.usage };
}

/** Assemble the parts into the template, in order. */
function assemble(parts, { weekEnding, note, noteIsDraft, figure }) {
  const url = briefUrl(weekEnding);
  // Each line links to the full brief: the newsletter sends readers to
  // africanstn.com rather than repeating the brief (editorial section 6).
  const also = parts.also.map((a) => `- ${String(a).trim()} ([more](${url}))`).join("\n");
  const registry = figure ? `${parts.registry_line.trim().replace(/[.\s]+$/, "")}, as at ${fmtDate(figure.as_at_date)}.` : "";
  // The brief's note may already end with the signature; sign once.
  const noteBody = note.trim().replace(/\n*\s*Nik Mladenovic,\s*founder,\s*AfricanSTN\.?\s*$/i, "").trim();
  return [
    `Subject: ${parts.subject.trim()}`,
    `Preview: ${parts.preview.trim()}`,
    "",
    noteIsDraft ? DRAFT_NOTE_MARKER : null,
    noteBody,
    "",
    "Nik Mladenovic, founder, AfricanSTN",
    "",
    `**The lead: ${parts.lead_headline.trim()}**`,
    `${parts.lead_summary.trim()} [Read the full story](${url})`,
    "",
    "**Also this week**",
    also,
    "",
    `**From the registry:** ${registry}`,
    "",
    CTAS[parts.cta](url),
  ].filter((l) => l !== null).join("\n");
}

/** Code checks on the parts and the assembled text. */
function checkNewsletter(parts, markdown, { briefMarkdown, figures, otherStories }) {
  const f = [];
  const add = (location, rule, text, fix, severity) => f.push({ location, rule, text: String(text).slice(0, 200), fix, severity });
  if (parts.subject.length > 50) add("subject", "editorial 6: subject 50 characters or fewer", parts.subject, `Cut ${parts.subject.length - 50} characters.`, "must fix");
  if (parts.preview.length > 90) add("preview", "editorial 6: preview 90 characters or fewer", parts.preview, `Cut ${parts.preview.length - 90} characters.`, "must fix");
  const lw = words(parts.lead_summary);
  if (lw < 60 || lw > 100) add("the lead", "editorial 6: lead summary 60-100 words", `${lw} words`, "Rewrite to 60-100 words.", "should fix");
  const minAlso = Math.min(3, otherStories);
  if (parts.also.length < minAlso || parts.also.length > 5) add("also this week", "editorial 6: three to five items", `${parts.also.length} items`, "Three to five one-line items.", "must fix");
  for (const a of parts.also) {
    if (words(a) > 30) add("also this week", "editorial 6: one-line items", a, "Cut to one sentence of 30 words or fewer.", "should fix");
  }
  const fig = figures.find((x) => x.figure_name === parts.figure_name);
  if (!fig) add("from the registry", "editorial 6: figure from published_figures", parts.figure_name, "Choose a figure from the list.", "must fix");
  else if (!parts.registry_line.includes(String(fig.value)) && !parts.registry_line.includes(fmtNumber(fig.value))) {
    add("from the registry", "figure must match published_figures", parts.registry_line, `Use the stored value ${fig.value}.`, "must fix");
  }
  const prose = markdown.replace(/\([^)]*\)/g, " ").replace(/"[^"]*"|“[^”]*”/g, " ");
  for (const w of AI_WORDS) if (new RegExp(`\\b${w}\\b`, "i").test(prose)) add("text", "house style 4.11: AI vocabulary", w, "Use a plain word or cut it.", "should fix");
  for (const a of ambiguousNames(prose)) add("text", "editorial 3: countries unambiguous", a.name, a.advice, "must fix");
  if (/—/.test(markdown)) add("text", "house style 4.8: dashes as connectors", "—", "Use a full stop, comma or colon.", "should fix");
  if (/\bASTN\b/.test(prose)) add("text", "brand: never ASTN externally", "ASTN", "Write AfricanSTN.", "must fix");
  return f;
}

const REVIEW_SYSTEM = `You review AfricanSTN's weekly newsletter before Nik sends it. You did not write it and you do not rewrite it. Judge only from the published brief and the registry figure you are given.

Check:
1. Every fact in the newsletter (names, numbers, dates, places, who did what) appears in the brief or is the registry figure. Quote any that does not.
2. Attribution in the brief is kept: a claim the brief attributes to an outlet is attributed in the newsletter too.
3. The subject and preview are specific and not clickbait, and the preview is a fact from the brief.
4. stza-house-style section 4: no staging contrasts, dramatic closers, run-ups, reflexive lists of three, inflated significance, vague association, "-ing" tails, sales language.
Ignore an HTML comment marking the editor's note as a draft; the publish step handles it.

Severity: must fix for any unsupported fact, lost attribution or patterns 1-5 of section 4; should fix for other style points; note for preference.`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          location: { type: "string" }, rule: { type: "string" }, text: { type: "string" },
          fix: { type: "string" }, severity: { type: "string", enum: ["must fix", "should fix", "note"] },
        },
        required: ["location", "rule", "text", "fix", "severity"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["findings", "summary"],
  additionalProperties: false,
};

/**
 * Draft, check and review a newsletter for a published brief.
 * @param {object} brief   {id, status, week_ending, report_markdown}
 * @param {object[]} figures  published_figures rows (figure_name, value, as_at_date, report_edition)
 */
async function draftNewsletter(brief, figures, { anthropic = new Anthropic() } = {}) {
  if (brief.status && brief.status !== "published") throw new Error(`The brief is ${brief.status}; a newsletter is drafted only from a published brief.`);
  const usableFigures = figures.filter((x) => FIGURE_LINES[x.figure_name] && String(x.value) !== "0");
  const note = approvedNote(brief.report_markdown);
  const stories = parseBrief(brief.report_markdown).items.length;
  const usage = [];

  const figureList = usableFigures.map((x) => `- ${x.figure_name}: ${x.value} ${FIGURE_LINES[x.figure_name]} (${x.report_edition}, as at ${x.as_at_date})`).join("\n");
  const user = `Brief URL: ${briefUrl(brief.week_ending)}
Week ending: ${fmtDate(brief.week_ending)}
Approved editor's note: ${note ? `given below, use it verbatim (write editor_note as an empty string)\n${note}` : "none; write editor_note"}

REGISTRY FIGURES (choose one)
${figureList}

PUBLISHED BRIEF
${brief.report_markdown}`;

  const gen = await stream(anthropic, {
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  usage.push(gen.usage);
  const parts = JSON.parse(gen.text);
  const figure = usableFigures.find((x) => x.figure_name === parts.figure_name) || null;
  const markdown = assemble(parts, {
    weekEnding: brief.week_ending, note: note || parts.editor_note, noteIsDraft: !note, figure,
  });
  const codeFindings = checkNewsletter(parts, markdown, {
    briefMarkdown: brief.report_markdown, figures: usableFigures, otherStories: Math.max(0, stories - 1),
  });

  let review = { findings: [], summary: "Review not completed." };
  let reviewError = null;
  try {
    const rv = await stream(anthropic, {
      output_config: { effort: "high", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
      system: [{ type: "text", text: REVIEW_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `REGISTRY FIGURE\n${figure ? `${figure.figure_name}: ${figure.value} (as at ${figure.as_at_date})` : "none"}\n\nPUBLISHED BRIEF\n${brief.report_markdown}\n\nNEWSLETTER\n${markdown}` }],
    });
    usage.push(rv.usage);
    review = JSON.parse(rv.text);
  } catch (e) {
    reviewError = e.message;
  }

  const findings = [...codeFindings.map((x) => ({ ...x, by: "code" })), ...review.findings.map((x) => ({ ...x, by: "model" }))];
  const result = reviewError || findings.some((x) => x.severity === "must fix") ? "fail" : "pass";
  return {
    brief_id: brief.id, subject: parts.subject, preview: parts.preview, markdown, parts,
    note_is_draft: !note, figure, result, findings,
    summary: reviewError ? `Review incomplete (${reviewError}).` : review.summary,
    usage, model: NEWSLETTER_MODEL, version: NEWSLETTER_VERSION,
  };
}

function isEnabled(env = process.env) {
  return String(env.NEWSLETTER || "").toLowerCase() === "on";
}

module.exports = { NEWSLETTER_MODEL, NEWSLETTER_VERSION, CTAS, FIGURE_LINES, briefUrl, approvedNote, assemble, checkNewsletter, draftNewsletter, isEnabled };
