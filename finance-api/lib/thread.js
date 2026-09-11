// Follow-ups on agent runs (migration 014).
//
// A follow-up arrives with the earlier turns of its conversation, oldest first.
// They are replayed to the model as plain question and answer. The tool results
// behind them are not stored, so if the agent needs that detail it asks again.
//
// A failed or empty turn still becomes an assistant message: the Messages API
// needs user and assistant turns to alternate, and an empty assistant turn is
// rejected outright.

function threadToMessages(thread = []) {
  const messages = [];
  for (const t of thread) {
    messages.push({ role: "user", content: t.instruction });
    const answer =
      t.output || (t.error ? `[This run failed: ${t.error}]` : "[No answer was recorded for this run.]");
    messages.push({ role: "assistant", content: answer });
  }
  return messages;
}

module.exports = { threadToMessages };
