// Registry candidates: the decisions, kept free of the database so they can be
// tested (migration 044, lib/registry-candidates-routes.js applies them).
//
// Nik submits an organisation; the registry reviewer agent proposes a registry
// row; a person approves it. This file answers:
//   - is a submission well formed, and what does it look like cleaned up
//   - how alike are two organisations (the duplicate check)
//   - is the agent's proposal a row public.organizations will accept, and
//     does it follow the registry's conventions
//   - what the next ASTN ID is

const MAX_BATCH = 25;

// The verticals in use in the registry today (checked against the live table,
// 15 Nov 2026). The categorise skill's three-vertical proposal is not adopted.
const VERTICALS = [
  "Performance & Elite Sport",
  "Mass Participation & Active Living",
  "Business of Sport",
  "Grassroots & Development",
];

const OPERATIONAL_STATUSES = ["active", "dormant", "ceased", "pre_launch", "unclear", "transformed", "unknown"];
const CONFIDENCE_BANDS = ["High", "Medium-High", "Medium", "Medium-Low", "Low"];
const VERDICTS = ["add", "duplicate", "reject"];

// Words that say what kind of company it is rather than which one.
const NAME_NOISE = new Set([
  "the", "ltd", "limited", "pty", "proprietary", "inc", "incorporated", "plc", "llc", "llp",
  "co", "company", "corp", "corporation", "sa", "sarl", "sas", "gmbh", "bv", "nv", "group", "holdings",
]);

function clean(value, max = 500) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

// https://, lower-case host, no trailing slash. Null when it is not a web address.
function normaliseWebsite(value) {
  const raw = clean(value, 300);
  if (!raw) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `https://${url.hostname.toLowerCase()}${path}${url.search}`;
}

// The site's own name: no scheme, no www, no path.
function domainOf(value) {
  const site = normaliseWebsite(value);
  if (!site) return null;
  return new URL(site).hostname.replace(/^www\./, "");
}

function nameTokens(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !NAME_NOISE.has(t));
}

function normaliseName(name) {
  return nameTokens(name).join(" ");
}

// One submission, cleaned. Only the name is required.
function parseSubmission(input) {
  const name = clean(input?.name, 200);
  if (!name) return { error: "a name is required" };
  const websiteRaw = clean(input?.website, 300);
  const website = normaliseWebsite(websiteRaw);
  if (websiteRaw && !website) return { error: `${name}: "${websiteRaw}" is not a web address` };
  return {
    value: {
      name,
      website,
      country: clean(input?.country, 80),
      sport: clean(input?.sport, 80),
      note: clean(input?.note, 2000),
    },
  };
}

function parseBatch(list) {
  if (!Array.isArray(list) || !list.length) return { error: "nothing was submitted" };
  if (list.length > MAX_BATCH) return { error: `at most ${MAX_BATCH} at a time` };
  const values = [];
  for (const item of list) {
    const r = parseSubmission(item);
    if (r.error) return { error: r.error };
    values.push(r.value);
  }
  return { values };
}

// How alike a registry row is to what we are looking for, 0 to 1, and why.
// Same website is decisive; the same name after dropping Ltd, Pty and the like
// is nearly so; otherwise the share of name words in common.
function similarity(target, row) {
  const reasons = [];
  let score = 0;
  const td = domainOf(target.website);
  const rd = domainOf(row.organization_website);
  if (td && rd && td === rd) {
    score = 1;
    reasons.push(`same website (${td})`);
  }
  const tn = normaliseName(target.name);
  const rn = normaliseName(row.organization_name);
  if (tn && rn) {
    if (tn === rn) {
      score = Math.max(score, 0.95);
      reasons.push("same name");
    } else {
      const a = new Set(tn.split(" "));
      const b = new Set(rn.split(" "));
      const shared = [...a].filter((t) => b.has(t)).length;
      const jaccard = shared / new Set([...a, ...b]).size;
      if (jaccard >= 0.5) reasons.push(`similar name (${Math.round(jaccard * 100)}% of words shared)`);
      score = Math.max(score, jaccard * 0.9);
    }
  }
  return { score: Math.round(score * 100) / 100, reasons };
}

// The rows worth showing as possible duplicates, best first.
function rankMatches(target, rows, { min = 0.5, limit = 10 } = {}) {
  return rows
    .map((row) => ({ row, ...similarity(target, row) }))
    .filter((m) => m.score >= min)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(({ row, score, reasons }) => ({
      organization_id: row.id,
      astn_id: row.astn_id,
      organization_name: row.organization_name,
      country: row.country,
      sport: row.sport,
      organization_website: row.organization_website || null,
      score,
      why: reasons.join("; "),
    }));
}

// Words long enough to search the registry on.
function searchTerms(name) {
  return [...new Set(nameTokens(name).filter((t) => t.length >= 4))].slice(0, 5);
}

function nextAstnId(countryIso, sportCode, maxSeq) {
  const n = (Number.isInteger(maxSeq) && maxSeq > 0 ? maxSeq : 0) + 1;
  return `${countryIso}-${sportCode}-${String(n).padStart(4, "0")}`;
}

function bandOf(confidence) {
  const s = String(confidence || "");
  // Longest first: Medium-High and Medium-Low before Medium.
  return [...CONFIDENCE_BANDS].sort((a, b) => b.length - a.length).find((b) => s.toLowerCase().startsWith(b.toLowerCase())) || null;
}

// The proposed row, checked and cleaned. refs holds the lookup tables:
// { countries: Map(iso -> name), sports: Map(code -> name) }. Returns
// { value } or { errors: [...] }; every problem is listed, so the agent can
// fix them in one go.
function validateProposal(p, refs, today = new Date()) {
  const errors = [];
  const v = {};
  const need = (field, max = 300) => {
    const s = clean(p?.[field], max);
    if (!s) errors.push(`${field} is required`);
    return s;
  };

  v.organization_name = need("organization_name", 200);

  const iso = clean(p?.country_iso, 3)?.toUpperCase() ?? null;
  if (!iso) errors.push("country_iso is required");
  else if (!refs.countries.has(iso)) errors.push(`country_iso ${iso} is not in lookup_countries`);
  else { v.country_iso = iso; v.country = refs.countries.get(iso); }

  const code = clean(p?.sport_code, 5)?.toUpperCase() ?? null;
  if (!code) errors.push("sport_code is required");
  else if (!refs.sports.has(code)) errors.push(`sport_code ${code} is not in lookup_sports`);
  else { v.sport_code = code; v.sport = clean(p?.sport, 80) || refs.sports.get(code); }

  v.level = need("level", 80);
  v.organization_type = need("organization_type", 80);

  const vertical = clean(p?.astn_vertical, 80);
  if (!vertical) errors.push("astn_vertical is required");
  else if (!VERTICALS.includes(vertical)) errors.push(`astn_vertical must be one of: ${VERTICALS.join(", ")}`);
  else v.astn_vertical = vertical;
  v.astn_sub_vertical = clean(p?.astn_sub_vertical, 80);

  const siteRaw = clean(p?.organization_website, 300);
  v.organization_website = normaliseWebsite(siteRaw);
  if (siteRaw && !v.organization_website) errors.push(`organization_website "${siteRaw}" is not a web address`);

  if (p?.founded_year !== undefined && p?.founded_year !== null && p?.founded_year !== "") {
    const y = Number(p.founded_year);
    if (!Number.isInteger(y) || y < 1850 || y > today.getUTCFullYear()) errors.push("founded_year must be a four-digit year, not in the future");
    else v.founded_year = y;
  }

  const op = clean(p?.operational_status, 20)?.toLowerCase() ?? "unknown";
  if (!OPERATIONAL_STATUSES.includes(op)) errors.push(`operational_status must be one of: ${OPERATIONAL_STATUSES.join(", ")}`);
  else v.operational_status = op;

  const conf = clean(p?.source_confidence, 300);
  if (!conf) errors.push("source_confidence is required");
  else if (!bandOf(conf)) errors.push(`source_confidence must start with a band: ${CONFIDENCE_BANDS.join(", ")}`);
  else v.source_confidence = conf;

  v.verification_source = need("verification_source", 300);
  v.region_province = clean(p?.region_province, 120);
  v.business_model = clean(p?.business_model, 40);
  v.tags = clean(Array.isArray(p?.tags) ? p.tags.join(", ") : p?.tags, 500);
  v.notes = need("notes", 4000);

  return errors.length ? { errors } : { value: v };
}

function validateVerdict(verdict, reason) {
  if (!VERDICTS.includes(verdict)) return `verdict must be one of: ${VERDICTS.join(", ")}`;
  if (!clean(reason)) return "say why, in verdict_reason";
  return null;
}

// Evidence the agent relied on: web addresses only, each with what it showed.
function cleanEvidence(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((e) => ({ url: normaliseWebsite(e?.url) ? clean(e.url, 500) : null, finding: clean(e?.finding, 500) }))
    .filter((e) => e.url && e.finding)
    .slice(0, 20);
}

// The note written to a new row: dated, and saying where it came from. Who
// approved it stays on the candidate, not in notes, which travel in exports.
function approvalNote(notes, { candidateId, date }) {
  const day = date.toISOString().slice(0, 10);
  const body = String(notes || "").trim();
  const prefixed = /^\[\d{4}-\d{2}-\d{2}\]/.test(body) ? body : `[${day}] ${body}`;
  return `${prefixed}\n[${day}] Added from registry candidate ${candidateId}, reviewed by agent and approved in os.stza.io.`;
}

module.exports = {
  MAX_BATCH, VERTICALS, OPERATIONAL_STATUSES, CONFIDENCE_BANDS, VERDICTS,
  normaliseWebsite, domainOf, normaliseName, parseSubmission, parseBatch,
  similarity, rankMatches, searchTerms, nextAstnId, bandOf,
  validateProposal, validateVerdict, cleanEvidence, approvalNote,
};
