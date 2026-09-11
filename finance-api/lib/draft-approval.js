// The approval for a draft journal, taken only from what a person actually saw.
//
// finance-api validates a journal against approval.presented_text: the entity,
// date, every account code and every amount must appear in it. That check is
// worthless if the caller writes presented_text itself, because the payload is
// then compared with a description of itself. So the runner never composes it.
//
// presented_text is the agent's previous answer, verbatim, as stored and shown
// in the portal. agreed_text is the person's follow-up, verbatim. approved_by
// and approved_at are who sent that follow-up and when. If the follow-up asks
// for a change instead of approving, there is no approval: the agent must
// propose again, and the person must approve what they then see.

// Short, plain approvals only. "approved", "yes, create the draft", "go ahead".
const APPROVES = /\b(approve|approved|yes|go ahead|confirm|confirmed|create (it|the draft|the journal)|do it|ok|okay)\b/i;
const CHANGES = /\b(change|instead|but|replace|amend|use|swap|different|not|no)\b/i;
const MAX_APPROVAL_LENGTH = 120;

function approvalFromThread({ current, parent }) {
  if (!current) return { error: "Could not find this run's own record, so there is no approval to rely on." };
  if (!parent) {
    return {
      error:
        "No approval yet. Propose the journal in your answer first; the user must approve it in a follow-up before a draft can be created.",
    };
  }
  if (!parent.output || !String(parent.output).trim()) {
    return { error: "The previous answer is empty, so there is no proposal the user could have approved." };
  }

  const said = String(current.instruction || "").trim();
  if (!APPROVES.test(said) || CHANGES.test(said) || said.length > MAX_APPROVAL_LENGTH) {
    return {
      error:
        `The user's reply ("${said.slice(0, 80)}") is not a plain approval of the proposal. ` +
        `If they asked for a change, make it, propose the journal again, and ask them to reply "approved".`,
    };
  }

  return {
    approval: {
      approved_by: current.requested_by_email,
      approved_at: current.queued_at,
      presented_text: parent.output,
      agreed_text: said,
    },
  };
}

module.exports = { approvalFromThread };
