// The free first pass of a registry re-verification (migration 046): does the
// record's website answer, where does it end up, and is the domain parked or
// for sale. No AI, no cost.
//
// This runs inside Google Cloud, so a registry website must never be able to
// point us at our own network or the metadata server (which hands out this
// service's credentials). Every address is checked at the moment of
// connecting, through the lookup the socket itself uses, so a name that
// resolves to a public address when first checked and a private one a moment
// later (DNS rebinding) is still refused. Redirects are followed by hand, at
// most four, and each one is checked the same way.

const dns = require("node:dns");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");

const TIMEOUT_MS = 10000;
const MAX_BYTES = 200 * 1024;
const MAX_REDIRECTS = 4;
const USER_AGENT = "Mozilla/5.0 (compatible; registry-website-check/1.0)";

const BLOCKED_NAMES = /^(localhost|metadata|metadata\.google\.internal)\.?$/i;

// Addresses we must never connect to: private, loopback, link-local (the
// metadata server is 169.254.169.254), carrier-grade NAT, multicast, reserved.
function isBlockedAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(address)) {
    const s = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedAddress(mapped[1]);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}

// The lookup handed to the socket: resolves, then refuses if any answer is blocked.
function guardedLookup(hostname, options, callback) {
  if (BLOCKED_NAMES.test(hostname)) return callback(Object.assign(new Error(`refused: ${hostname}`), { code: "EBLOCKED" }));
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family }];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad) return callback(Object.assign(new Error(`refused: ${hostname} resolves to a private address`), { code: "EBLOCKED" }));
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

// One request, no redirects followed. Resolves { status, location, body }.
function fetchOnce(url, { lookup = guardedLookup } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return reject(Object.assign(new Error("not a web address"), { code: "EPROTO" }));
    if (u.port && !["80", "443"].includes(u.port)) return reject(Object.assign(new Error("only ports 80 and 443"), { code: "EBLOCKED" }));
    if (net.isIP(u.hostname) && isBlockedAddress(u.hostname)) return reject(Object.assign(new Error("refused: private address"), { code: "EBLOCKED" }));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, {
      method: "GET",
      lookup,
      timeout: TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.5" },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size <= MAX_BYTES) chunks.push(c);
        else res.destroy();
      });
      const done = () => resolve({ status: res.statusCode, location: res.headers.location || null, body: Buffer.concat(chunks).toString("utf8") });
      res.on("end", done);
      res.on("close", done);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end();
  });
}

const PARKED = [
  /domain (name )?(is|may be) for sale/i, /buy this domain/i, /this domain is parked/i, /parked (free|domain)/i,
  /sedo(parking)?\.com/i, /\bdan\.com\b/i, /afternic/i, /hugedomains/i, /godaddy\.com\/domainsearch/i, /domain has expired/i,
];

function titleOf(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : null;
}

const bareHost = (u) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");

// What one check found, in the registry's website_status terms.
function classify({ url, finalUrl, status, body, error, name }) {
  const base = { url, final_url: finalUrl || null, http_status: status ?? null, checked_at: new Date().toISOString() };
  if (error) {
    const code = error.code || "";
    const outcome = code === "ENOTFOUND" || code === "EAI_AGAIN" ? "dns_error"
      : code === "ETIMEDOUT" ? "timeout"
      : code === "EBLOCKED" ? "refused"
      : "error";
    return { ...base, outcome, website_status: outcome === "refused" || outcome === "error" ? "unknown" : outcome, detail: String(error.message).slice(0, 200) };
  }
  const title = titleOf(body);
  const parked = PARKED.some((re) => re.test(title || "") || re.test((body || "").slice(0, 20000)));
  const moved = finalUrl && bareHost(finalUrl) !== bareHost(url);
  const words = String(name || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const text = `${title || ""} ${(body || "").slice(0, 50000)}`.toLowerCase();
  const mentions = words.length ? words.some((w) => text.includes(w)) : null;
  let outcome;
  if (parked) outcome = "domain_for_sale";
  else if (status >= 400) outcome = "http_error";
  else if (moved) outcome = "redirect";
  else outcome = "live";
  return {
    ...base, outcome, title, mentions_name: mentions,
    website_status: outcome === "http_error" ? "unknown" : outcome,
  };
}

// Checks one website. Never throws: every failure is a finding.
async function checkWebsite(url, { name, fetchImpl = fetchOnce } = {}) {
  if (!url) return { url: null, outcome: "no_website", website_status: "unknown", checked_at: new Date().toISOString() };
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const r = await fetchImpl(current);
      if (r.status >= 300 && r.status < 400 && r.location) {
        if (hop === MAX_REDIRECTS) return classify({ url, finalUrl: current, status: r.status, body: "", name });
        current = new URL(r.location, current).toString();
        continue;
      }
      return classify({ url, finalUrl: current, status: r.status, body: r.body, name });
    }
  } catch (error) {
    return classify({ url, finalUrl: current === url ? null : current, error, name });
  }
  return classify({ url, finalUrl: current, status: null, body: "", name });
}

module.exports = { checkWebsite, classify, isBlockedAddress, guardedLookup, fetchOnce, titleOf };
