/**
 * Source fetcher for the verifier (server-lib-verifier.js).
 *
 * Fetches an article, keeps its readable text and finds the date the source
 * itself gives for publication. No model, no dependencies. The text is stored
 * with a hash (item_sources, migration 072) so a check can be repeated
 * against exactly what was read.
 */

const crypto = require("crypto");

const USER_AGENT = "AfricanSTN-Bot/1.0 (+https://africanstn.com)";
const MAX_TEXT = 40000; // characters kept; enough for any news article

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&#x2019;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#822[01];|&[lr]dquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function toText(fragment) {
  const text = decodeEntities(
    fragment.replace(/<\/(p|div|h[1-6]|li|tr|br|section)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  );
  return text.replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/**
 * Readable text: the <article> or <main> if it holds a real amount of text
 * (judged on text, not markup: some themes wrap a near-empty <article>
 * around the headline only), else the whole <body>.
 */
function htmlToText(html) {
  const h = html.replace(/<(script|style|noscript|svg|iframe|form|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const grab = (tag) => {
    const m = h.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? toText(m[1]) : "";
  };
  for (const tag of ["article", "main"]) {
    const t = grab(tag);
    if (t.length >= 800) return t.slice(0, MAX_TEXT);
  }
  return (grab("body") || toText(h)).slice(0, MAX_TEXT);
}

function metaContent(html, attr, name) {
  const re1 = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${name}["']`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? m[1] : null;
}

/**
 * The publication date the page states, with where it was found. Order of
 * trust: article:published_time, JSON-LD datePublished, other meta tags,
 * the first <time datetime>, then a /YYYY/MM/DD/ path in the URL.
 */
function findPublishedDate(html, url) {
  const candidates = [
    ["meta article:published_time", metaContent(html, "property", "article:published_time")],
    ["json-ld datePublished", (html.match(/"datePublished"\s*:\s*"([^"]+)"/i) || [])[1]],
    ["meta datePublished", metaContent(html, "itemprop", "datePublished")],
    ["meta date", metaContent(html, "name", "date") || metaContent(html, "name", "pubdate") || metaContent(html, "name", "publish-date")],
    ["meta og:updated_time", null], // deliberately not used: an update is not publication
    ["time datetime", (html.match(/<time[^>]+datetime=["']([^"']+)["']/i) || [])[1]],
  ];
  for (const [where, v] of candidates) {
    if (!v) continue;
    const d = new Date(v);
    if (!isNaN(d)) return { date: d.toISOString(), where };
  }
  const m = String(url || "").match(/\/(20\d\d)\/(\d{1,2})\/(\d{1,2})\//);
  if (m) return { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString(), where: "url path" };
  const ym = String(url || "").match(/\/(20\d\d)\/(\d{1,2})\//);
  if (ym) return { date: new Date(Date.UTC(+ym[1], +ym[2] - 1, 1)).toISOString(), where: "url path (month only)", monthOnly: true };
  return { date: null, where: null };
}

/**
 * @returns {Promise<{url, finalUrl, status, ok, reason, title, text, textHash, published, fetchedAt}>}
 * ok is false when the page did not return an article: an HTTP error, a
 * timeout, or too little text (a paywall, a consent wall or a home page).
 */
async function fetchSource(url, { timeoutMs = 20000 } = {}) {
  const fetchedAt = new Date().toISOString();
  const base = { url, finalUrl: null, status: null, ok: false, reason: null, title: null, text: "", textHash: null, published: { date: null, where: null }, fetchedAt };
  if (!url) return { ...base, reason: "No source link" };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(t);
    const html = await r.text();
    const text = htmlToText(html);
    const title = decodeEntities(((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim());
    const out = {
      ...base,
      finalUrl: r.url,
      status: r.status,
      title,
      text,
      textHash: crypto.createHash("sha256").update(text).digest("hex"),
      published: findPublishedDate(html, r.url || url),
    };
    if (!r.ok) return { ...out, reason: `HTTP ${r.status}` };
    if (text.length < 400) return { ...out, reason: "Page has too little text to be the article (paywall, consent wall or home page)" };
    return { ...out, ok: true };
  } catch (e) {
    return { ...base, reason: e.name === "AbortError" ? "Timed out" : `Fetch failed: ${e.message}` };
  }
}

module.exports = { fetchSource, htmlToText, findPublishedDate, USER_AGENT };
