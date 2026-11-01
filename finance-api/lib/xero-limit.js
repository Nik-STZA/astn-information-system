// Keeping Xero reads inside its rate limits. Xero allows 5 calls at once and 60 a
// minute per organisation, and answers 429 beyond that. Every 429 in the week to
// 1 Nov 2026 came in a burst, as agents read several things about a bill at once,
// and each one failed the read outright because only writes retried.
//
// So reads queue for a slot, one fewer than Xero's limit because one instance
// cannot see another's calls, and a 429 waits as Xero says and tries again. A
// long wait means the daily or app limit, which no retry here will clear: that
// fails at once rather than holding a request open.
const MAX_AT_ONCE = 4;
const MAX_TRIES = 3;
const LONGEST_WAIT_SECONDS = 30;

// Seconds to wait before another try, or null to give up.
function retryWait(response, attempt) {
  if (response.status !== 429 || attempt >= MAX_TRIES) return null;
  const asked = Number(response.headers?.get?.("retry-after"));
  const wait = Number.isFinite(asked) && asked > 0 ? asked : attempt * 2;
  return wait > LONGEST_WAIT_SECONDS ? null : wait;
}

function xeroLimiter({ sleep = (s) => new Promise((done) => setTimeout(done, s * 1000)), maxAtOnce = MAX_AT_ONCE } = {}) {
  const orgs = new Map();
  const org = (tenantId) => {
    if (!orgs.has(tenantId)) orgs.set(tenantId, { running: 0, waiting: [] });
    return orgs.get(tenantId);
  };
  const take = (o) => new Promise((go) => {
    if (o.running < maxAtOnce) { o.running += 1; go(); } else o.waiting.push(go);
  });
  const give = (o) => {
    const next = o.waiting.shift();
    if (next) next(); else o.running -= 1;
  };
  // send() makes the request and returns the Response.
  return async function limited(tenantId, send) {
    const o = org(tenantId);
    for (let attempt = 1; ; attempt += 1) {
      await take(o);
      let r;
      try { r = await send(); } finally { give(o); }
      const wait = retryWait(r, attempt);
      if (wait === null) return r;
      await sleep(wait);
    }
  };
}

module.exports = { xeroLimiter, retryWait, MAX_AT_ONCE, MAX_TRIES };
