/**
 * Model-free checks on a brief's markdown, for the reviewer
 * (server-lib-brief-review.js) and the publish gates
 * (server-registry-routes.js). No dependencies, no network: safe to load in
 * the API server.
 *
 * Rules come from africanstn-editorial (sections 3, 4, 7), stza-house-style
 * (sections 1 and 4) and africanstn-brand (never "ASTN" externally).
 * Each finding: { location, rule, text, fix, severity } with severity
 * 'must fix', 'should fix' or 'note' (stza-house-style section 5).
 */

const crypto = require("crypto");

const markdownHash = (md) => crypto.createHash("md5").update(String(md || "")).digest("hex");

// Ambiguous place names (africanstn-editorial section 3). Shared with the verifier.
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

// stza-house-style section 4, pattern 11, plus editorial bans.
const AI_WORDS = ["additionally", "align with", "bolster", "crucial", "deep dive", "delve", "enduring", "enhance",
  "garner", "highlights", "highlighted", "highlighting", "interplay", "intricate", "landscape", "leverage", "meticulous",
  "pivotal", "quietly", "robust", "seamless", "showcase", "tapestry", "testament", "underscore", "underscores", "unlock",
  "valuable", "vibrant"];
const HYPE_WORDS = ["exciting", "game-changing", "game changer", "landmark", "groundbreaking", "revolutionary"];
const SAID_WORDS = ["stated", "noted", "revealed"];

const LINK_RE = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(?<![(\[])\bhttps?:\/\/[^\s)]+/g;
const words = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’.,%¢$-]*/gu) || []).length;
const stripQuotes = (s) => String(s).replace(/"[^"]*"|“[^”]*”/g, " ");

/**
 * Split a brief into sections (##) and items (###). Text under a ## with no
 * ### is the section's own body (an editor's note, a context list).
 */
function parseBrief(md) {
  const lines = String(md || "").split(/\r?\n/);
  const sections = [];
  let section = { heading: null, body: [], items: [] };
  let item = null;
  const closeItem = () => { if (item) { section.items.push({ ...item, body: item.body.join("\n").trim() }); item = null; } };
  const closeSection = () => { closeItem(); sections.push({ ...section, body: section.body.join("\n").trim() }); };
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    const h3 = line.match(/^###\s+(.*)$/);
    if (h2 && !h3) { closeSection(); section = { heading: h2[1].trim(), body: [], items: [] }; continue; }
    if (h3) { closeItem(); item = { heading: h3[1].trim(), body: [] }; continue; }
    (item ? item.body : section.body).push(line);
  }
  closeSection();
  const items = sections.flatMap((s) => s.items.map((it) => ({ ...it, section: s.heading })));
  for (const it of items) {
    it.links = [...it.body.matchAll(LINK_RE)].map((m) => m[1] || m[2] || m[3]);
    const news = it.body.split(/\n\s*\*?\*?Why it matters/i)[0];
    it.words = words(news);
    const firstPara = news.split(/\n\s*\n/).find((p) => p.trim()) || "";
    it.lede = (firstPara.match(/^[\s\S]*?[.!?](?=\s|$)/) || [firstPara])[0].trim();
  }
  return { sections, items };
}

const isEditorsNote = (h) => /from the editor|editor'?s note/i.test(h || "");
const isQuickHits = (h) => /quick hits/i.test(h || "");

/** All code checks. Returns findings and the parsed brief. */
function codeChecks(md) {
  const f = [];
  const add = (location, rule, text, fix, severity) => f.push({ location, rule, text: String(text).slice(0, 300), fix, severity });
  const brief = parseBrief(md);
  const { sections, items } = brief;

  if (items.length === 0) add("whole brief", "editorial 4: thin weeks", "No items.", "An empty brief is never published.", "must fix");
  else if (items.length < 3) add("whole brief", "editorial 4: thin weeks", `${items.length} item(s).`, "Combine with next week or publish as a deliberate short issue.", "should fix");

  for (const it of items) {
    const loc = `item "${it.heading.slice(0, 60)}"`;
    if (!it.links.length && !isQuickHits(it.section)) add(loc, "editorial 7: source link", it.body.slice(0, 120), "Name the source in the copy and link to the article.", "must fix");
    if (words(it.lede) > 35) add(loc, "editorial 3: lede of 35 words or fewer", it.lede, "Cut the lede to who, what, where and how much.", "should fix");
  }
  for (const s of sections) {
    if (s.heading && !s.items.length && !s.body) add(`section "${s.heading}"`, "editorial 4: no empty sections", "(empty)", "Remove the heading.", "must fix");
    if (s.heading && !isEditorsNote(s.heading) && !isQuickHits(s.heading) && s.items.length === 1 && sections.indexOf(s) > 1) {
      add(`section "${s.heading}"`, "editorial 4: sections are earned", s.heading, "Use a heading only when two or more items belong under it.", "should fix");
    }
  }

  const main = items.filter((it) => !isQuickHits(it.section));
  if (main.length) {
    const lead = main[0];
    if (lead.words < 100 || lead.words > 200) {
      add(`item "${lead.heading.slice(0, 60)}"`, "editorial 4: lead story of 100 to 200 words", `${lead.words} words.`, "Pick the week's most important story and write it as a short news piece.", "must fix");
    }
    const lens = main.slice(1).map((x) => x.words);
    if (lens.length >= 3) {
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      if (lens.every((n) => Math.abs(n - mean) <= mean * 0.25)) add("whole brief", "editorial 4: vary the length", lens.join(", ") + " words", "Lead longest, items one paragraph, quick hits one line.", "should fix");
    }
  }

  const note = sections.find((s) => isEditorsNote(s.heading));
  if (!note) add("whole brief", "editorial 4: signed editor's note", "No \"From the editor\" section.", "Add two to four sentences, first person, signed by Nik Mladenovic.", "must fix");
  else if (!/Nik Mladenovic/.test(note.body)) add("From the editor", "editorial 5: signed note", note.body.slice(0, 120), "Sign it: Nik Mladenovic, founder, AfricanSTN.", "must fix");

  const text = String(md || "");
  const prose = stripQuotes(text);
  if (/\bASTN\b/.test(prose)) add("whole brief", "brand: never ASTN externally", "ASTN", "Write AfricanSTN.", "must fix");
  for (const a of ambiguousNames(prose)) add("whole brief", "editorial 3: countries unambiguous", a.name, a.advice, "must fix");
  for (const w of AI_WORDS) if (new RegExp(`\\b${w}\\b`, "i").test(prose)) add("whole brief", "house style 4.11: AI vocabulary", w, "Use a plain word or cut it.", "should fix");
  for (const w of HYPE_WORDS) if (new RegExp(`\\b${w}\\b`, "i").test(prose)) add("whole brief", "editorial 3: neutral tone", w, "Let the numbers carry the weight.", "should fix");
  for (const w of SAID_WORDS) if (new RegExp(`\\b${w}\\b`, "i").test(prose)) add("whole brief", "editorial 3: use said", w, "Use \"said\".", "should fix");
  if (/—/.test(text)) add("whole brief", "house style 4.8: dashes as connectors", "—", "Use a full stop, comma or colon.", "should fix");

  return { findings: f, brief };
}

// The editor drafts the editor's note for Nik and marks it with this
// comment. Nik deletes it when he has rewritten or approved the note; the
// publish gate refuses a brief that still carries it.
const DRAFT_NOTE_MARKER = "<!-- draft: editor's note for Nik to rewrite or approve; delete this line when done -->";
const hasDraftNote = (md) => String(md || "").includes("<!-- draft: editor's note");

/** True when the item headings carry links: used by the publish gate. */
function itemsMissingLinks(md) {
  return parseBrief(md).items.filter((it) => !it.links.length && !isQuickHits(it.section)).map((it) => it.heading);
}

module.exports = { markdownHash, parseBrief, codeChecks, itemsMissingLinks, ambiguousNames, AMBIGUOUS, AI_WORDS, DRAFT_NOTE_MARKER, hasDraftNote };
