// Pack commentary: each month's management pack commentary, held in
// os.stza.io (migration 063) instead of files on the drive and a Word round
// trip. Pure: lib/pack-commentary-routes.js reads and writes.
//
// A month has two parts, as the pack build reads them:
//   highlights  the words (commentary, notes, compliance details, variance
//               comments, actions, risks) and the figures they sit beside
//   dashboard   figures only
// Only the text fields are edited here. Figures are shown for reading: a wrong
// figure is raised, not typed over (CFO's Finance Director Commentary
// Standard, 18 Nov 2026, section 12).
//
// An agent (FP&A, FC) or a person drafts; only the CFO approves; the pack
// build takes only an approved month. Changing an approved month makes it a
// draft again, at the next version.

const KINDS = ["highlights", "dashboard"];
const MAX_TEXT = 20000;
const MAX_BYTES = 2_000_000;

// The month's commentary is one text: the pack writes it into one cell and one
// slide. A draft that gives it as sections ({ executive_overview: "...",
// operating_costs: "..." }, 20 Nov 2026: the page would not load) is turned
// into one text, each section under its heading, in the standard's order.
const ORDER = ["executive_overview", "revenue_and_trading", "ebitda_and_profitability", "operating_costs", "balance_sheet_and_investment", "cash_and_funding"];
const headingOf = (k) => { const t = String(k).replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
function commentaryText(v) {
  if (typeof v === "string" || v == null) return v;
  if (Array.isArray(v)) return v.map(commentaryText).filter((x) => String(x ?? "").trim()).join("\n\n");
  if (typeof v !== "object") return String(v);
  const keys = [...ORDER.filter((k) => k in v), ...Object.keys(v).filter((k) => !ORDER.includes(k))];
  return keys.map((k) => [headingOf(k), commentaryText(v[k])].filter((x) => String(x ?? "").trim()).join("\n")).filter(Boolean).join("\n\n");
}
// Text saved as UTF-8 read back as Latin-1 ("Â£64,208.48", 20 Nov 2026: every
// pound sign in two FP&A drafts). Put right only when that is what it is: the
// text is all single-byte characters and reads cleanly as UTF-8.
function unmangle(s) {
  if (typeof s !== "string" || !/[Â-ô][\u0080-¿]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("�") ? s : fixed;
}
const deep = (v, f) => (typeof v === "string" ? f(v) : Array.isArray(v) ? v.map((x) => deep(x, f))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, f)])) : v);

// The highlights file as the pack reads it (the board pack and the workbook):
// commentary one text; variance_comments { label: text }; actions [{ priority,
// owner, action }]; risks [{ title, description }]. A draft in another shape
// FP&A has used is put into this one, wording unchanged.
function normalise(h) {
  if (!h || typeof h !== "object" || Array.isArray(h)) return h;
  const x = deep(h, unmangle);
  if ("commentary" in x && x.commentary != null && typeof x.commentary !== "string") x.commentary = commentaryText(x.commentary);
  if (Array.isArray(x.variance_comments)) {
    const out = {};
    for (const [i, v] of x.variance_comments.entries()) {
      if (typeof v === "string") { out[`Comment ${i + 1}`] = v; continue; }
      const label = [v?.entity, v?.account].filter(Boolean).join(" ") || v?.label || `Comment ${i + 1}`;
      let key = label;
      for (let n = 2; key in out; n++) key = `${label} (${n})`;
      out[key] = String(v?.explanation ?? v?.comment ?? v?.text ?? "");
    }
    x.variance_comments = out;
  } else if (x.variance_comments && typeof x.variance_comments === "object") {
    x.variance_comments = Object.fromEntries(Object.entries(x.variance_comments).map(([k, v]) => [k, typeof v === "string" ? v : commentaryText(v?.explanation ?? v)]));
  }
  if (Array.isArray(x.actions)) {
    x.actions = x.actions.map((a) => (typeof a === "string" ? { priority: "", owner: "", action: a }
      : { ...a, action: a?.action ?? a?.title ?? a?.description ?? "" }));
  }
  // Compliance is a list of { item, status, detail }. A draft that gave one
  // object ({ status, details }) is one item.
  if (x.compliance && typeof x.compliance === "object" && !Array.isArray(x.compliance)) {
    const c = x.compliance;
    x.compliance = [{ item: c.item ?? c.title ?? "Compliance and open items", status: String(c.status ?? "AMBER").toUpperCase(),
      detail: String(c.detail ?? c.details ?? c.description ?? "") }];
  } else if (Array.isArray(x.compliance)) {
    x.compliance = x.compliance.map((c) => (typeof c === "string" ? { item: c, status: "AMBER", detail: "" }
      : { ...c, status: String(c?.status ?? "AMBER").toUpperCase(), detail: c?.detail ?? c?.details ?? "" }));
  }
  // KPI tiles are a list of { label, value, note }. Raw figures keyed by name
  // ({ net_loss_udl_sep: -46911.61 }) are the drafter's working, not tiles:
  // left out, so the pack keeps the month's own tiles.
  if (x.kpis !== undefined && !Array.isArray(x.kpis)) delete x.kpis;
  if (Array.isArray(x.risks)) {
    x.risks = x.risks.map((r) => (typeof r === "string" ? { title: r, description: "" }
      : { ...r, title: r?.title ?? r?.risk ?? "", description: r?.description ?? r?.impact ?? r?.detail ?? "" }));
  }
  return x;
}

// The text fields of a highlights file, by section, each with its path. The
// same fields the Word review offered (commentary_to_docx.py).
function sections(h) {
  const x = normalise(h && typeof h === "object" ? h : {});
  const list = (key, title, rows) => ({ key, title, fields: rows.filter(Boolean) });
  return [
    list("commentary", "Commentary", "commentary" in x ? [{ path: "commentary", heading: "The month", text: x.commentary ?? "" }] : []),
    list("kpis", "Key figures", (Array.isArray(x.kpis) ? x.kpis : []).map((k, i) => (k && "note" in k ? { path: `kpis.${i}.note`, heading: k.label ?? `KPI ${i + 1}`, text: k.note ?? "", figure: k.value ?? null } : null))),
    list("compliance", "Compliance and open items", (Array.isArray(x.compliance) ? x.compliance : []).map((c, i) => ({ path: `compliance.${i}.detail`, heading: c?.item ?? `Item ${i + 1}`, status: c?.status ?? null, text: c?.detail ?? "" }))),
    list("variance_comments", "Variance comments", Object.entries(x.variance_comments && typeof x.variance_comments === "object" ? x.variance_comments : {}).map(([k, v]) => ({ path: `variance_comments.${k}`, heading: k, text: v ?? "" }))),
    list("actions", "Actions", (Array.isArray(x.actions) ? x.actions : []).map((a, i) => ({ path: `actions.${i}.action`, heading: [a?.priority, a?.owner].filter(Boolean).join(" ") || `Action ${i + 1}`, text: a?.action ?? "" }))),
    list("risks", "Risks", (Array.isArray(x.risks) ? x.risks : []).map((r, i) => ({ path: `risks.${i}.description`, heading: r?.title ?? `Risk ${i + 1}`, text: r?.description ?? "" }))),
  ].filter((s) => s.fields.length);
}

const editablePaths = (h) => new Set(sections(h).flatMap((s) => s.fields.map((f) => f.path)));

function setPath(obj, path, value) {
  // A variance comment's key is a heading, which may itself hold a full stop.
  if (path.startsWith("variance_comments.")) { obj.variance_comments[path.slice("variance_comments.".length)] = value; return; }
  const parts = path.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[/^\d+$/.test(p) && Array.isArray(o) ? Number(p) : p];
  o[parts[parts.length - 1]] = value;
}

// Edits to the text fields only. Returns { content, changed, issues }.
//   edits  [{ path, text }]
function applyEdits(h, edits) {
  const issues = [];
  const allowed = editablePaths(h);
  const content = JSON.parse(JSON.stringify(normalise(h) ?? {}));
  const current = new Map(sections(h).flatMap((s) => s.fields.map((f) => [f.path, f.text])));
  const changed = [];
  if (!Array.isArray(edits) || !edits.length) return { content, changed, issues: ["nothing to save"] };
  for (const [i, e] of edits.entries()) {
    const path = String(e?.path ?? "");
    if (!allowed.has(path)) { issues.push(`edit ${i + 1}: ${path || "(no path)"} is not a text field of the commentary; figures are not edited here`); continue; }
    if (typeof e.text !== "string") { issues.push(`edit ${i + 1}: the text must be words`); continue; }
    if (e.text.length > MAX_TEXT) { issues.push(`edit ${i + 1}: keep it to ${MAX_TEXT.toLocaleString("en-GB")} characters`); continue; }
    if (e.text === current.get(path)) continue;
    setPath(content, path, e.text);
    changed.push(path);
  }
  return { content, changed, issues };
}

// What a file must be to be taken in.
function contentIssues(kind, content) {
  if (!KINDS.includes(kind)) return [`kind must be one of ${KINDS.join(", ")}`];
  if (!content || typeof content !== "object" || Array.isArray(content)) return ["the file must be a JSON object"];
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_BYTES) return ["the file is over 2 MB"];
  if (kind === "highlights" && !sections(content).length) return ["this has none of the commentary sections (commentary, kpis, compliance, variance_comments, actions, risks): is it the highlights file?"];
  return [];
}

// Words the CFO's standard asks writers to avoid, and placeholders that should
// not reach a pack. Advice for the writer, not a block.
const AVOID = [
  [/\bnotably\b/i, "notably"], [/\bfurthermore\b/i, "furthermore"], [/\btherefore\b/i, "therefore"],
  [/\bconsequently\b/i, "consequently"], [/\bin comparison\b/i, "in comparison"],
  [/\barea to monitor\b/i, "an area to monitor"], [/\bremains? an area of focus\b/i, "an area of focus"],
  [/\bGBP\s?[\d£]/, "GBP before a figure (write £)"], [/\bTBC\b/, "TBC"],
];
function styleNotes(h) {
  const out = [];
  for (const s of sections(h)) for (const f of s.fields) {
    const found = AVOID.filter(([re]) => re.test(f.text ?? "")).map(([, w]) => w);
    if (found.length) out.push({ path: f.path, heading: f.heading, words: found });
  }
  return out;
}

// Whether the pack can be built from the month: the highlights approved, and
// the dashboard approved if there is one.
function readyForPack(rows) {
  const h = rows.find((r) => r.kind === "highlights");
  const d = rows.find((r) => r.kind === "dashboard");
  if (!h) return { ready: false, why: "No commentary for the month yet." };
  if (h.status !== "approved") return { ready: false, why: "The commentary is a draft: the CFO approves it first." };
  if (d && d.status !== "approved") return { ready: false, why: "The dashboard figures are a draft: the CFO approves them with the commentary." };
  return { ready: true, why: null };
}

module.exports = { normalise, commentaryText, KINDS, MAX_TEXT, sections, editablePaths, applyEdits, contentIssues, styleNotes, readyForPack };
