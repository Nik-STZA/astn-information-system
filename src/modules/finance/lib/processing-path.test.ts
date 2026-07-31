import { describe, expect, it } from "vitest";
import {
  resolveProcessingPath,
  ProcessingPathError,
} from "@/modules/finance/lib/processing-path";

describe("resolveProcessingPath", () => {
  it("uses Vertex when it is fully configured", () => {
    const path = resolveProcessingPath({
      CLAUDE_CODE_USE_VERTEX: "1",
      ANTHROPIC_VERTEX_PROJECT_ID: "africanstn-research",
      CLOUD_ML_REGION: "europe-west1",
    } as NodeJS.ProcessEnv);

    expect(path.kind).toBe("vertex");
    expect(path.governed).toBe(true);
    expect(path.label).toContain("europe-west1");
    expect(path.env.ANTHROPIC_VERTEX_PROJECT_ID).toBe("africanstn-research");
  });

  // A half-configured commercial path is the dangerous case: it looks
  // deliberate and silently runs over the subscription. Refuse instead.
  it("refuses a half-configured Vertex path rather than falling back", () => {
    expect(() =>
      resolveProcessingPath({ CLAUDE_CODE_USE_VERTEX: "1" } as NodeJS.ProcessEnv)
    ).toThrow(ProcessingPathError);

    expect(() =>
      resolveProcessingPath({
        CLAUDE_CODE_USE_VERTEX: "1",
        ANTHROPIC_VERTEX_PROJECT_ID: "p",
      } as NodeJS.ProcessEnv)
    ).toThrow(/CLOUD_ML_REGION/);
  });

  it("does not default the region, because region is where the data is processed", () => {
    expect(() =>
      resolveProcessingPath({
        CLAUDE_CODE_USE_VERTEX: "1",
        ANTHROPIC_VERTEX_PROJECT_ID: "p",
      } as NodeJS.ProcessEnv)
    ).toThrow(/not defaulted/);
  });

  it("falls to the direct API when a key is present", () => {
    const path = resolveProcessingPath({ ANTHROPIC_API_KEY: "sk-test" } as NodeJS.ProcessEnv);
    expect(path.kind).toBe("anthropic-api");
    expect(path.governed).toBe(true);
  });

  it("prefers Vertex over a stray API key", () => {
    const path = resolveProcessingPath({
      CLAUDE_CODE_USE_VERTEX: "1",
      ANTHROPIC_VERTEX_PROJECT_ID: "p",
      CLOUD_ML_REGION: "europe-west1",
      ANTHROPIC_API_KEY: "sk-test",
    } as NodeJS.ProcessEnv);
    expect(path.kind).toBe("vertex");
  });

  it("refuses to run at all when nothing is configured", () => {
    expect(() => resolveProcessingPath({} as NodeJS.ProcessEnv)).toThrow(ProcessingPathError);
  });

  // The escape hatch exists so the runner can be exercised against synthetic
  // data before the commercial path is live. It is safe only because the run
  // record says what happened - an ungoverned run that recorded nothing would
  // be worse than a refused one.
  it("allows an ungoverned run only when explicitly asked, and marks it", () => {
    const path = resolveProcessingPath({
      STZA_ALLOW_UNGOVERNED_PATH: "1",
    } as NodeJS.ProcessEnv);
    expect(path.kind).toBe("ungoverned");
    expect(path.governed).toBe(false);
    expect(path.label).toContain("no commercial agreement");
  });
});
