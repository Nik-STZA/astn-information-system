// Approval routing: whether an item goes to the CFO individually or reaches
// the gate inside a batch.
//
// The classification is DERIVED here from the item's type and amount against
// the client's routing config. It is never read from wip.json, because
// wip.json is written by the drafting agent, and an agent that can mark its own
// work routine has a self-service bypass around the only approval gate in the
// system.
//
// Same principle as posting tools being physically absent from every agent
// below the CFO rather than merely forbidden by instruction: make it
// structurally impossible, do not rely on the instruction being followed.
//
// See skills/balance-sheet-matrix (the M/J column) and
// roundtable/2026-07-31-decision-sheet.md section C1.

export const ROUTING_CLASSES = ["mechanical", "judgement"] as const;
export type RoutingClass = (typeof ROUTING_CLASSES)[number];

export interface TypeRule {
  /** Default class for this work type before the amount is considered. */
  class: RoutingClass;
  /**
   * Amount at or above which a mechanical item becomes judgement, as a decimal
   * string. null means no amount gate: the type's class stands whatever the
   * value.
   */
  threshold?: string | null;
}

export interface RoutingConfig {
  version: number;
  currency: string;
  /** Fallback threshold where a type rule does not name its own. */
  clientThreshold: string;
  /** Reconciling differences below this are noted rather than investigated. */
  trivialDifference: string;
  typeRules: Record<string, TypeRule>;
}

export interface Classification {
  class: RoutingClass;
  /** Why, in words a reviewer can read in the queue. */
  reason: string;
}

export class RoutingConfigError extends Error {}

/**
 * Compares two decimal strings without going through a float.
 *
 * Amounts are carried as strings from the manifest all the way to the numeric
 * column precisely so that no float ever touches money. Parsing them here to
 * compare would reintroduce the imprecision the rest of the module avoids, and
 * a rounding error at the threshold decides whether a human reads the item.
 */
export function compareAmounts(a: string, b: string): number {
  const parse = (raw: string) => {
    const text = raw.trim();
    if (!/^-?\d*\.?\d+$/.test(text)) {
      throw new RoutingConfigError(`not a decimal amount: "${raw}"`);
    }
    const negative = text.startsWith("-");
    const [whole, fraction = ""] = text.replace("-", "").split(".");
    return { negative, whole, fraction };
  };

  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.fraction.length, y.fraction.length);
  const scaled = (v: ReturnType<typeof parse>) =>
    BigInt((v.negative ? "-" : "") + v.whole + v.fraction.padEnd(scale, "0"));

  const left = scaled(x);
  const right = scaled(y);
  return left === right ? 0 : left < right ? -1 : 1;
}

export function parseRoutingConfig(json: string): RoutingConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new RoutingConfigError(`routing config is not valid JSON: ${(e as Error).message}`);
  }

  const config = raw as Partial<RoutingConfig>;
  if (!config || typeof config !== "object") {
    throw new RoutingConfigError("routing config is not an object");
  }
  if (!config.clientThreshold) {
    throw new RoutingConfigError("routing config has no clientThreshold");
  }
  if (!config.typeRules || typeof config.typeRules !== "object") {
    throw new RoutingConfigError("routing config has no typeRules");
  }

  for (const [type, rule] of Object.entries(config.typeRules)) {
    if (!ROUTING_CLASSES.includes(rule?.class as RoutingClass)) {
      throw new RoutingConfigError(
        `routing rule for "${type}" has class "${rule?.class}", expected mechanical or judgement`
      );
    }
  }

  return {
    version: config.version ?? 1,
    currency: config.currency ?? "GBP",
    clientThreshold: config.clientThreshold,
    trivialDifference: config.trivialDifference ?? "0",
    typeRules: config.typeRules as Record<string, TypeRule>,
  };
}

/**
 * Every path that returns "mechanical" is a path where a human may approve the
 * item inside a batch without reading it individually, so each one is written
 * to be defensible on its own. Everything uncertain returns judgement.
 */
export function classify(
  item: { type: string; amountTotal: string | null },
  config: RoutingConfig
): Classification {
  const rule = config.typeRules[item.type];

  // An unrecognised type has never been assessed for whether it can be batched,
  // so it cannot be. Adding a work type should require a routing decision.
  if (!rule) {
    return {
      class: "judgement",
      reason: `no routing rule for work of type "${item.type}"`,
    };
  }

  if (rule.class === "judgement") {
    return {
      class: "judgement",
      reason: `${item.type} carries judgement by rule`,
    };
  }

  // A batch attestation states a population and a total. An item with no
  // amount cannot be sized, so it cannot honestly be inside one.
  if (item.amountTotal === null) {
    return {
      class: "judgement",
      reason: "amount not stated, so the item cannot be sized for batch approval",
    };
  }

  const threshold = rule.threshold === undefined ? config.clientThreshold : rule.threshold;
  if (threshold === null) {
    return { class: "mechanical", reason: `${item.type} is mechanical, no amount gate` };
  }

  if (compareAmounts(item.amountTotal, threshold) >= 0) {
    return {
      class: "judgement",
      reason: `${config.currency} ${item.amountTotal} is at or above the ${item.type} threshold of ${threshold}`,
    };
  }

  return {
    class: "mechanical",
    reason: `${config.currency} ${item.amountTotal} is below the ${item.type} threshold of ${threshold}`,
  };
}

/**
 * Used when a client has no routing config yet. Everything reaches the CFO
 * individually, which is the current behaviour, so an absent config degrades to
 * more human attention rather than less.
 */
export function classifyWithoutConfig(item: { type: string }): Classification {
  return {
    class: "judgement",
    reason: `no routing config for this client, so ${item.type} routes individually`,
  };
}
