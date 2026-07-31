// Which commercial arrangement an agent run is processed under.
//
// Claude Code authenticates either against a consumer subscription or against a
// commercial endpoint. The distinction is not a preference: the consumer terms
// say the service is not for business or professional purposes, there is no
// confidentiality clause in them, and no data processing addendum applies
// because on that route the provider is a controller in its own right rather
// than a processor. A client ledger must not travel that way.
//
// So the runner establishes the path before it starts, refuses to guess, and
// records what it used. A run record that cannot say how the data was processed
// is not an audit trail.

export type PathKind = "vertex" | "bedrock" | "anthropic-api" | "ungoverned";

export interface ProcessingPath {
  kind: PathKind;
  /** True where a commercial agreement and a DPA govern the processing. */
  governed: boolean;
  /** Shown in the log and stored on the run. */
  label: string;
  /** Environment the child process needs to use this path. */
  env: Record<string, string>;
}

export class ProcessingPathError extends Error {}

const truthy = (v?: string) => v === "1" || v?.toLowerCase() === "true";

/**
 * Reads the path from the environment. Deliberately strict: a half-configured
 * commercial path is refused rather than quietly falling back to the
 * subscription, because the fallback is invisible and the whole point is that
 * it must not happen by accident.
 */
export function resolveProcessingPath(
  env: Record<string, string | undefined> = process.env
): ProcessingPath {
  if (truthy(env.CLAUDE_CODE_USE_VERTEX)) {
    const project = env.ANTHROPIC_VERTEX_PROJECT_ID;
    const region = env.CLOUD_ML_REGION;
    if (!project) {
      throw new ProcessingPathError(
        "CLAUDE_CODE_USE_VERTEX is set but ANTHROPIC_VERTEX_PROJECT_ID is not. " +
          "Refusing to run rather than falling back to the subscription."
      );
    }
    if (!region) {
      throw new ProcessingPathError(
        "CLAUDE_CODE_USE_VERTEX is set but CLOUD_ML_REGION is not. " +
          "Region decides where the data is processed, so it is not defaulted here."
      );
    }
    return {
      kind: "vertex",
      governed: true,
      label: `Vertex AI, ${project} in ${region}`,
      env: {
        CLAUDE_CODE_USE_VERTEX: "1",
        ANTHROPIC_VERTEX_PROJECT_ID: project,
        CLOUD_ML_REGION: region,
      },
    };
  }

  if (truthy(env.CLAUDE_CODE_USE_BEDROCK)) {
    const region = env.AWS_REGION;
    if (!region) {
      throw new ProcessingPathError(
        "CLAUDE_CODE_USE_BEDROCK is set but AWS_REGION is not."
      );
    }
    return {
      kind: "bedrock",
      governed: true,
      label: `Bedrock, ${region}`,
      env: { CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: region },
    };
  }

  if (env.ANTHROPIC_API_KEY) {
    return {
      kind: "anthropic-api",
      governed: true,
      label: "Anthropic API, commercial terms",
      env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY },
    };
  }

  // No commercial path configured. The run would go over whatever the local
  // Claude Code install is signed in to, which for a subscription is the
  // consumer route.
  if (truthy(env.STZA_ALLOW_UNGOVERNED_PATH)) {
    return {
      kind: "ungoverned",
      governed: false,
      label: "local sign-in, no commercial agreement established",
      env: {},
    };
  }

  throw new ProcessingPathError(
    "No governed processing path is configured, so this run would go over the " +
      "local sign-in. Set CLAUDE_CODE_USE_VERTEX with ANTHROPIC_VERTEX_PROJECT_ID " +
      "and CLOUD_ML_REGION, or ANTHROPIC_API_KEY. To run anyway against synthetic " +
      "data only, set STZA_ALLOW_UNGOVERNED_PATH=1 - the run record will say so."
  );
}
