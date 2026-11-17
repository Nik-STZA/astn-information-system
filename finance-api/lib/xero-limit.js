// Keeping Xero reads inside its rate limits. Xero allows 5 calls at once and 60 a
// minute per organisation, and answers 429 beyond that. Every 429 in the week to
// 1 Nov 2026 came in a burst, as agents read several things about a bill at once,
// and each one failed the read outright because only writes retried.
//
// So reads queue for a slot, one fewer than Xero's limit because one instance
// cannot see another's calls, and a 429 waits as Xero says and tries again. A
// long wait means the daily or app limit, which no retry here will clear: that
// fails at once rather than holding a request open.
//
// 18 Nov 2026: a slot limit is not a minute limit. FM1 working September's
// reconciliations sent 84 calls at UDL in three minutes, each check fanning out
// into several reads; Xero asked for a longer wait than we would hold, and a
// CFO sign-off failed in the middle of it. Calls now also keep within a minute
// budget per organisation (below Xero's 60, as other instances call too), and a
// 429 that Xero says is the minute limit waits up to a minute.
const MAX_AT_ONCE = 4;
const MAX_TRIES = 3;
const LONGEST_WAIT_SECONDS = 30;
const LONGEST_MINUTE_WAIT_SECONDS = 61;
const PER_MINUTE = 50;

// Seconds to wait before another try, or null to give up. Xero names the limit
// it applied in X-Rate-Limit-Problem: "minute" clears within a minute; "day"
// and "appminute" (all organisations) are not ours to wait out.
function retryWait(response, attempt) {
  if (response.status !== 429 || attempt >= MAX_TRIES) return null;
  const asked = Number(response.headers?.get?.("retry-after"));
  const problem = String(response.headers?.get?.("x-rate-limit-problem") ?? "").toLowerCase();
  const wait = Number.isFinite(asked) && asked > 0 ? asked : attempt * 2;
  const longest = problem === "minute" ? LONGEST_MINUTE_WAIT_SECONDS : LONGEST_WAIT_SECONDS;
  return wait > longest ? null : wait;
}

function xeroLimiter({
  sleep = (s) => new Promise((done) => setTimeout(done, s * 1000)),
  maxAtOnce = MAX_AT_ONCE, perMinute = PER_MINUTE, now = () => Date.now(),
} = {}) {
  const orgs = new Map();
  const org = (tenantId) => {
    if (!orgs.has(tenantId)) orgs.set(tenantId, { running: 0, waiting: [], sent: [] });
    return orgs.get(tenantId);
  };
  const take = (o) => new Promise((go) => {
    if (o.running < maxAtOnce) { o.running += 1; go(); } else o.waiting.push(go);
  });
  const give = (o) => {
    const next = o.waiting.shift();
    if (next) next(); else o.running -= 1;
  };
  // Holding a slot, wait until the last minute has room for one more call.
  const budget = async (o) => {
    for (;;) {
      const t = now();
      while (o.sent.length && t - o.sent[0] >= 60000) o.sent.shift();
      if (o.sent.length < perMinute) { o.sent.push(t); return; }
      await sleep((60000 - (t - o.sent[0])) / 1000 + 0.05);
    }
  };
  // send() makes the request and returns the Response.
  return async function limited(tenantId, send) {
    const o = org(tenantId);
    for (let attempt = 1; ; attempt += 1) {
      await take(o);
      let r;
      try { await budget(o); r = await send(); } finally { give(o); }
      const wait = retryWait(r, attempt);
      if (wait === null) return r;
      await sleep(wait);
    }
  };
}

// Which limit a 429 hit, in words, for the error a person reads.
function limitProblem(response) {
  const p = String(response?.headers?.get?.("x-rate-limit-problem") ?? "").toLowerCase();
  if (p === "minute") return "Xero's limit of 60 calls a minute for this company";
  if (p === "day") return "Xero's daily limit of 5,000 calls for this company, which resets at midnight UTC";
  if (p === "appminute") return "Xero's per-minute limit across all our companies";
  return "Xero's rate limit";
}

module.exports = { xeroLimiter, retryWait, limitProblem, MAX_AT_ONCE, MAX_TRIES, PER_MINUTE };
