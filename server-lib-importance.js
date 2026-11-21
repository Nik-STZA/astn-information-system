/**
 * Registry matcher and importance score (step 5).
 * Design: docs/brief-pipeline-design.md, section 3.
 *
 * The matcher finds every registry organisation an item names, in several
 * forms (full name, name without a bracketed acronym, the acronym itself,
 * name without FC/SC/Club), and flags a form as ambiguous when two
 * organisations share it rather than guessing.
 *
 * The importance score (0-100) is a visible sum, not a model guess, so Nik
 * can see why an item ranks where it does. Default ('editorial') weights:
 *   technology named           30
 *   money stated               up to 15 (by size, in US$ at indicative rates)
 *   specialist source          15 (content_sources.lens = 'africa-sport-business')
 *   registry organisation      10, plus 5 for a startup, investor or accelerator
 *   story size                 up to 10 (by other outlets in the story cluster)
 *   country not in recent briefs 5
 * The design note's starting weights are kept as set 'design'; see WEIGHTS.
 * Pure module: no database, no network, no model.
 */

const { isSafeOrgName } = require("./server-lib-rule-screen");

const IMPORTANCE_VERSION = "importance-1";

// ─── Matching helpers ──────────────────────────────────────────────────────
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const B_START = "(?<![\\p{L}\\p{N}])";
const B_END = "(?![\\p{L}\\p{N}])";
const norm = (s) => String(s || "").replace(/[‘’ʼ]/g, "'").trim();

// Single words that are some registry row's whole name but mean nothing on
// their own in a news item ("Olympic", "Nations").
const GENERIC = new Set(("olympic olympics paralympic nations national international continental premier super cup " +
  "league federation association union council committee academy sports sport club stadium arena games").split(" "));
const usable = (form) => isSafeOrgName(form) && !(form.split(/\s+/).length === 1 && GENERIC.has(form.toLowerCase()));

function variantsOf(name) {
  const n = norm(name);
  const out = [];
  if (usable(n)) out.push({ form: n, kind: "name", caseSensitive: true });
  const paren = n.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    const base = paren[1].trim();
    const inner = paren[2].trim();
    if (usable(base)) out.push({ form: base, kind: "name", caseSensitive: true });
    if (/^[A-Z][A-Za-z0-9&-]{2,9}$/.test(inner) && /[A-Z].*[A-Z]/.test(inner)) out.push({ form: inner, kind: "acronym", caseSensitive: true });
  }
  const noSuffix = (paren ? paren[1] : n).replace(/\s+(F\.?C\.?|S\.?C\.?|Club|Football Club)$/i, "").trim();
  if (noSuffix !== (paren ? paren[1] : n) && noSuffix.length >= 6 && usable(noSuffix)) {
    out.push({ form: noSuffix, kind: "short name", caseSensitive: true });
  }
  return out;
}

// Country name or its common adjective, for settling shared names.
const ADJ = { "South Africa": "South African", "Nigeria": "Nigerian", "Kenya": "Kenyan", "Ghana": "Ghanaian", "Egypt": "Egyptian",
  "Morocco": "Moroccan", "Namibia": "Namibian", "Zimbabwe": "Zimbabwean", "Zambia": "Zambian", "Tanzania": "Tanzanian",
  "Uganda": "Ugandan", "Rwanda": "Rwandan", "Senegal": "Senegalese", "Cameroon": "Cameroonian", "Tunisia": "Tunisian",
  "Algeria": "Algerian", "Ethiopia": "Ethiopian", "Botswana": "Motswana", "Malawi": "Malawian", "Mozambique": "Mozambican",
  "Angola": "Angolan", "Ivory Coast": "Ivorian", "Mali": "Malian", "Sudan": "Sudanese", "Libya": "Libyan" };
function countryMentioned(text, country) {
  const names = [country, ADJ[country]].filter(Boolean);
  return names.some((n) => new RegExp(`${B_START}${escapeRe(n)}${B_END}`, "iu").test(text));
}

/**
 * @param {Array<{astn_id, organization_name, level?, organization_type?, country?}>} orgs
 */
function buildMatcher(orgs) {
  const byForm = new Map(); // form -> Map(astn_id -> {org, kind})
  for (const o of orgs) {
    for (const v of variantsOf(o.organization_name)) {
      if (!byForm.has(v.form)) byForm.set(v.form, new Map());
      byForm.get(v.form).set(o.astn_id, { org: o, kind: v.kind });
    }
  }
  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length);
  const regexes = [];
  for (let i = 0; i < forms.length; i += 800) {
    regexes.push(new RegExp(`${B_START}(${forms.slice(i, i + 800).map(escapeRe).join("|")})${B_END}`, "gu"));
  }

  /** All registry organisations named in text. */
  function match(text) {
    const t = norm(text);
    const seen = new Map();
    for (const re of regexes) {
      for (const m of t.matchAll(re)) {
        const form = m[1];
        if (seen.has(form)) continue;
        let cands = [...byForm.get(form).values()];
        // Settle a shared name by the country the text names, where only
        // some candidates are in that country (Orlando Pirates: Namibia or
        // South Africa). No model; if the text does not settle it, it stays
        // ambiguous and scores nothing.
        if (cands.length > 1) {
          const inText = cands.filter(({ org }) => org.country && countryMentioned(t, org.country));
          if (inText.length && inText.length < cands.length) cands = inText;
        }
        seen.set(form, {
          matched_as: form,
          kind: cands[0].kind,
          ambiguous: cands.length > 1,
          orgs: cands.slice(0, 5).map(({ org }) => ({
            astn_id: org.astn_id, name: org.organization_name, level: org.level || null,
            organization_type: org.organization_type || null, country: org.country || null,
          })),
        });
      }
    }
    // Drop a shorter form contained in a longer matched form ("CAF" inside
    // "CAF Champions League" is fine, but "Nkana" inside "Nkana FC" is the same hit).
    const hits = [...seen.values()];
    return hits.filter((h) => !hits.some((o) => o !== h && o.matched_as.includes(h.matched_as) &&
      o.orgs.some((x) => h.orgs.some((y) => y.astn_id === x.astn_id))));
  }
  return { match, stats: { orgs: orgs.length, forms: forms.length, ambiguousForms: [...byForm.values()].filter((m) => m.size > 1).length } };
}

// ─── Money ─────────────────────────────────────────────────────────────────
// Indicative rates to US$ (November 2026, rounded), only to size an amount
// for ranking. Never published.
const TO_USD = {
  "US$": 1, "$": 1, "USD": 1, "€": 1.08, "EUR": 1.08, "£": 1.27, "GBP": 1.27,
  "R": 0.055, "ZAR": 0.055, "KSh": 0.0077, "Ksh": 0.0077, "Sh": 0.0077, "KES": 0.0077,
  "₦": 0.00065, "N": 0.00065, "NGN": 0.00065, "GH¢": 0.065, "GHS": 0.065, "GHC": 0.065,
  "EGP": 0.021, "E£": 0.021, "MAD": 0.1, "Dh": 0.1, "K": 0.000037, "ZMW": 0.037, "E": 0.055, "SZL": 0.055,
  "FCFA": 0.0016, "CFA": 0.0016, "XOF": 0.0016, "RWF": 0.00071, "UGX": 0.00027, "TZS": 0.00037,
};
const MULT = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
const CUR = Object.keys(TO_USD).sort((a, b) => b.length - a.length).map(escapeRe).join("|");
const MONEY_RE = new RegExp(`(?<![\\p{L}])(${CUR})\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s?(bn|billion|mn|million|m|k|thousand)?(?![\\p{L}])`, "giu");
// Bare one-letter currencies (R, N, K, E) only count with a size word, to
// avoid "K2" or "N1 road".
const ONE_LETTER = new Set(["R", "N", "K", "E", "$"]);

function largestAmountUsd(text) {
  let best = 0, label = null;
  for (const m of String(text || "").matchAll(MONEY_RE)) {
    const cur = Object.keys(TO_USD).find((c) => c.toLowerCase() === m[1].toLowerCase()) || m[1];
    const unit = (m[3] || "").toLowerCase();
    const value = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(value)) continue;
    if (ONE_LETTER.has(cur) && cur !== "$" && !unit && value < 1000) continue;
    const usd = value * (MULT[unit] || 1) * TO_USD[cur];
    if (usd > best) { best = usd; label = m[0].trim(); }
  }
  return { usd: best, label };
}
// Fraction of the money weight earned, by size.
function moneyShare(usd) {
  if (usd >= 100e6) return 1;
  if (usd >= 10e6) return 0.85;
  if (usd >= 1e6) return 0.65;
  if (usd >= 100e3) return 0.4;
  if (usd > 0) return 0.2;
  return 0;
}

// Weights. Set 'design' is the starting point in the design note; set
// 'editorial' (the default) weights the technology angle most, because the
// editorial standard makes it the core of every item and, on Nik's reviewed
// items to 20 Nov 2026, items naming technology were approved 79% of the
// time against 49% without, while money and registry matches made little
// difference. Re-check after four weeks of live decisions.
const WEIGHTS = {
  design: { money: 30, technology: 20, registry: 15, registryBonus: 10, source: 10, story: 10, newCountry: 5 },
  editorial: { money: 15, technology: 30, registry: 10, registryBonus: 5, source: 15, story: 10, newCountry: 5 },
};

// ─── Technology ────────────────────────────────────────────────────────────
const TECH_TERMS = [
  "technology", "tech", "platform", "app", "software", "saas", "data", "analytics", "artificial intelligence", "ai",
  "streaming", "ott", "digital", "e-commerce", "ecommerce", "online", "ticketing", "cashless", "biometric", "wearable",
  "gps", "tracking", "var", "video assistant referee", "goal-line", "electronic voting", "e-voting", "blockchain", "nft",
  "app store", "esports", "broadcast technology", "fintech", "payments", "startup", "start-up",
  // French and Portuguese
  "technologie", "plateforme", "numérique", "billetterie", "application", "diffusion en ligne",
  "tecnologia", "plataforma", "digital", "aplicação", "bilheteira",
];
const TECH_RE = new RegExp(`${B_START}(${TECH_TERMS.sort((a, b) => b.length - a.length).map(escapeRe).join("|")})${B_END}`, "iu");
// Arabic: technology, platform, electronic, application, digital
const TECH_AR = /تكنولوجيا|تقنية|منصة|إلكتروني|الكتروني|تطبيق|رقمي/;

// ─── Score ─────────────────────────────────────────────────────────────────
const BONUS_LEVEL = /startup|start-up|investor|accelerator|incubator|venture/i;

/**
 * @param {object} item {title, summary, translated_text, source_name}
 * @param {object} ctx  {matcher, africaSportSources: string[], clusterOutlets: number,
 *                       countries: string[] (names to look for), recentBriefText: string}
 * @returns {{score:number, parts:object, matches:object[], money:object}}
 */
function scoreItem(item, ctx) {
  const w = WEIGHTS[ctx.weights || "editorial"];
  const text = [item.title, item.summary, item.translated_text].filter(Boolean).join("\n");
  const parts = {};

  const money = largestAmountUsd(text);
  parts.money = Math.round(w.money * moneyShare(money.usd));

  parts.technology = TECH_RE.test(text) || TECH_AR.test(text) ? w.technology : 0;

  // The outlet naming itself is not a story about it (Zamalek News is in the
  // registry, so each of its articles would otherwise match it).
  const outlet = String(item.source_name || "").toLowerCase();
  const matches = (ctx.matcher ? ctx.matcher.match(text) : [])
    .filter((m) => !m.orgs.every((o) => o.name.toLowerCase() === outlet || m.matched_as.toLowerCase() === outlet));
  const firm = matches.filter((m) => !m.ambiguous);
  parts.registry = firm.length ? w.registry : 0;
  if (firm.some((m) => m.orgs.some((o) => BONUS_LEVEL.test(`${o.level || ""} ${o.organization_type || ""}`)))) parts.registry += w.registryBonus;

  const specialist = (ctx.africaSportSources || []).map((s) => s.toLowerCase());
  parts.source = specialist.includes(String(item.source_name || "").toLowerCase()) ? w.source : 0;

  parts.story = Math.min(w.story, Math.round((w.story / 3) * (ctx.clusterOutlets || 0)));

  parts.new_country = 0;
  if (ctx.countries && ctx.recentBriefText !== undefined) {
    const named = ctx.countries.filter((c) => new RegExp(`${B_START}${escapeRe(c)}${B_END}`, "iu").test(text));
    const recent = String(ctx.recentBriefText || "");
    if (named.some((c) => !new RegExp(`${B_START}${escapeRe(c)}${B_END}`, "iu").test(recent))) parts.new_country = w.newCountry;
  }

  const score = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0));
  return { score, parts, matches, money };
}

module.exports = { IMPORTANCE_VERSION, WEIGHTS, buildMatcher, variantsOf, largestAmountUsd, scoreItem, TECH_TERMS };
