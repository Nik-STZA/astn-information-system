// What an agent run costs, and the prompt caching that keeps it down.
//
// An agent run is a loop of up to MAX_TURNS calls. Every call resends the
// tool list, the system prompt and the whole conversation so far, so most of
// each call's input is a repeat of the last one. Prompt caching bills that
// repeated prefix at a tenth of the input price (and the first write of it at
// 1.25x), which is most of an agent run's input cost.
//
// Prices are USD per million tokens, from Anthropic's published list prices
// (checked 28 Oct 2026). A model not listed here gets no cost rather than a
// guessed one: an empty cost is visibly missing, a wrong one is not.

const PRICES = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

const CACHE_READ = 0.1; // of the input price
const CACHE_WRITE = 1.25; // of the input price, five-minute cache

// Adds up the usage blocks of every call in a run.
function addUsage(total, usage) {
  const u = usage || {};
  return {
    input: total.input + (u.input_tokens || 0),
    output: total.output + (u.output_tokens || 0),
    cacheRead: total.cacheRead + (u.cache_read_input_tokens || 0),
    cacheWrite: total.cacheWrite + (u.cache_creation_input_tokens || 0),
  };
}

const NO_USAGE = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

// The run's cost in USD, or null for a model with no price here. input_tokens
// excludes the cached tokens, which the API reports separately.
function runCost(model, total) {
  const p = PRICES[model];
  if (!p) return null;
  const usd =
    (total.input * p.input +
      total.cacheWrite * p.input * CACHE_WRITE +
      total.cacheRead * p.input * CACHE_READ +
      total.output * p.output) /
    1_000_000;
  return Number(usd.toFixed(6));
}

// The messages to send this turn, with one cache marker on the newest block.
// The conversation only ever grows, so the marker moves forward each turn and
// everything before it is read from the cache. It is added to a copy: the API
// allows four markers per request, and a 25-turn run must not accumulate them.
function withCacheMarker(messages) {
  if (!messages.length) return messages;
  const out = messages.slice(0, -1);
  const last = messages[messages.length - 1];
  const blocks =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content.map((b) => ({ ...b }));
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
  out.push({ ...last, content: blocks });
  return out;
}

// The system prompt as a cached block. Tools render before the system prompt,
// so this one marker caches the tool list too.
function cachedSystem(text) {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

module.exports = { PRICES, NO_USAGE, addUsage, runCost, withCacheMarker, cachedSystem };
