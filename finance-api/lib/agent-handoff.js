// Agents handing work up the chain (how-work-moves): when a run finishes it can
// pass to the next tier, which runs as the next turn of the same conversation.
// Only up the chain, and only so far: an agent cannot start itself or loop.

const CHAIN = {
  "ap-clerk": ["fm2"],
  "ar-clerk": ["fm2"],
  fm1: ["fm2", "fc"],
  fm2: ["fc"],
};

// A clerk's batch reaching the reviewer, and the reviewer's exception reaching
// the FC. Beyond that it comes to the person who asked.
const MAX_HOPS = 2;

const TITLES = { "ap-clerk": "AP Clerk", "ar-clerk": "AR Clerk", fm1: "FM1", fm2: "FM2", fc: "FC" };
const PREFIX = "Hand-off from ";

const isHandoff = (instruction) => String(instruction || "").startsWith(PREFIX);

const REFUSED_LINE = "If a step is refused, say so plainly in your answer and do not report it as done.";

function handoffInstruction(from, note) {
  return `${PREFIX}${TITLES[from] ?? from}: ${String(note).trim().slice(0, 2000)}

${REFUSED_LINE}`;
}

// What stops a hand-off, or null. hops: hand-offs already in a row before this run.
function handoffRefusal(from, to, note, hops) {
  if (!CHAIN[from]) return `${from || "this agent"} does not hand work on: it comes to the CFO`;
  if (!CHAIN[from].includes(to)) return `${from} hands to ${CHAIN[from].join(" or ")}, not ${to}`;
  if (!String(note || "").trim()) return "say what the next agent should look at";
  if (hops >= MAX_HOPS) return "this work has been handed on as far as it goes: it comes to the CFO";
  return null;
}

// FM1 hands a reconciliation to the FC only once it is with the FC: submit_rec
// moves it there. A hand-off before that leaves the FC reviewing a rec the
// platform will not let it review. recStatus: the run's rec status, or null
// when the run is not on a rec.
function recHandoffRefusal(from, to, recStatus) {
  if (from !== "fm1" || to !== "fc" || !recStatus || recStatus === "with_fc") return null;
  return `The reconciliation is still ${String(recStatus).replace(/_/g, " ")}. Prepare it first (submit_rec), then hand off.`;
}

module.exports = { CHAIN, MAX_HOPS, REFUSED_LINE, isHandoff, handoffInstruction, handoffRefusal, recHandoffRefusal };
