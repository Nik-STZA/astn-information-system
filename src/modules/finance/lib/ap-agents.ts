// Who has each bill: the AP Clerk, then FM2, then the FC if it is asked. Worked
// out from what is saved on the bill and which agents are running now. Runs
// belong to the client, not a bill, so this reads the stage the bill has reached;
// a bill waiting on an agent that is not running belongs with the CFO, so nothing
// is left unseen. Pure, so it is tested and safe on either side.

import type { ApItemRow } from "./ap-queue";

export type AgentStep = "ap" | "fm2" | "fc";
export type StepState = "done" | "now" | "todo";

const RUNNER: Record<AgentStep, string> = { ap: "ap-clerk", fm2: "fm2", fc: "fc" };
export const STEP_NAMES: Record<AgentStep, string> = { ap: "AP Clerk", fm2: "FM2", fc: "FC" };
export const STEP_LABELS: Record<AgentStep, string> = { ap: "AP", fm2: "FM2", fc: "FC" };

const OPEN = ["exception", "clean", "approved"];

export interface BillProgress {
  withAgents: boolean;
  current: AgentStep | null;
  steps: Array<{ key: AgentStep; state: StepState }>;
}

type Row = Pick<ApItemRow, "state" | "recommended" | "review_verdict" | "review_agents">;

export function billProgress(item: Row, activeAgents: string[]): BillProgress {
  const reviewers = item.review_agents ?? [];
  const running = (step: AgentStep) => activeAgents.includes(RUNNER[step]);
  // Any review that is not the FC's came from FM2, including one with no agent saved.
  const fm2Done = reviewers.some((r) => r !== "fc") || (reviewers.length === 0 && !!item.review_verdict);
  const fcDone = reviewers.includes("fc");

  let due: AgentStep | null = null;
  if (OPEN.includes(item.state)) {
    if (!item.recommended) due = "ap";
    else if (!fm2Done) due = "fm2";
    else if (!fcDone && running("fc")) due = "fc";
  }
  const current = due && running(due) ? due : null;

  const stateOf = (step: AgentStep, done: boolean): StepState => (step === current ? "now" : done ? "done" : "todo");
  const steps: BillProgress["steps"] = [
    { key: "ap", state: stateOf("ap", item.recommended) },
    { key: "fm2", state: stateOf("fm2", fm2Done) },
  ];
  // The FC sees a bill only by exception, so it shows only when it is involved.
  if (fcDone || current === "fc") steps.push({ key: "fc", state: stateOf("fc", fcDone) });
  return { withAgents: current !== null, current, steps };
}

// Agents with work queued or running, from the client's runs.
export function activeAgents(runs: Array<{ agent: string | null; status: string }>): string[] {
  return runs.filter((r) => r.agent && (r.status === "queued" || r.status === "running")).map((r) => r.agent as string);
}

export function isStep(value: string | undefined): value is AgentStep {
  return value === "ap" || value === "fm2" || value === "fc";
}
