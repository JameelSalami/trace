import { semanticDigest, type JsonValue } from "./canonical.js";
import { compileReplay } from "./replay.js";
import { TracePackValidationError, type TraceNode, type TraceEnvelope } from "./model.js";

export interface ReplayExerciseStep {
  readonly nodeId: string;
  readonly digest: string;
  readonly replay: "input" | "fixture" | "derived";
  readonly value: JsonValue;
  readonly matchesExpected: boolean | null;
}

export interface ReplayExerciseResult {
  readonly schema: "tracepack.replay-exercise/v1";
  readonly traceDigest: string;
  readonly authority: "none";
  readonly effectReplay: false;
  readonly steps: readonly ReplayExerciseStep[];
  readonly mismatches: readonly string[];
  readonly verification: "not-attested";
}

export interface ConsumerReplayRunner {
  /**
   * Consumer supplies historical inputs/fixtures and deterministic derivation
   * logic. It must independently sandbox this callback if untrusted; Trace
   * cannot prevent a JavaScript callback with ambient authority from causing
   * external side effects.
   */
  readonly evaluate: (node: TraceNode, parentValues: Readonly<Record<string, JsonValue>>) => JsonValue;
  readonly expectedDigests?: Readonly<Record<string, string>>;
}

/**
 * Actually invokes consumer-provided replay logic over the verified causal
 * graph. Excluded nodes and historical authority are never invoked. A digest
 * match is a *comparison*, not a claim about authenticated provenance.
 */
export const exerciseTraceReplay = (
  envelope: TraceEnvelope,
  runner: ConsumerReplayRunner
): ReplayExerciseResult => {
  const plan = compileReplay(envelope);
  if (typeof runner.evaluate !== "function") {
    throw new TracePackValidationError("Replay exercise requires a consumer-owned evaluator");
  }
  const byId = new Map(envelope.pack.nodes.map(node => [node.id, node]));
  const evaluated = new Map<string, JsonValue>();
  const steps: ReplayExerciseStep[] = [];
  const mismatches: string[] = [];
  const evaluate = (id: string): JsonValue => {
    if (evaluated.has(id)) return evaluated.get(id)!;
    const node = byId.get(id);
    if (!node || node.replay === "excluded") {
      throw new TracePackValidationError("Replay exercise cannot evaluate excluded/missing node: " + id);
    }
    const parents: Record<string, JsonValue> = Object.create(null);
    for (const parentId of node.causalParents) {
      parents[parentId] = structuredClone(evaluate(parentId));
    }
    const value = runner.evaluate(node, Object.freeze(parents));
    let digest: string;
    try {
      digest = semanticDigest(value);
    } catch {
      throw new TracePackValidationError("Replay exercise evaluator returned noncanonical JSON for: " + id);
    }
    const expected = runner.expectedDigests?.[id] ?? null;
    if (expected !== null && !/^sha256:[0-9a-f]{64}$/.test(expected)) {
      throw new TracePackValidationError("Replay expected digest is invalid: " + id);
    }
    const matchesExpected = expected === null ? null : expected === digest;
    if (matchesExpected === false) mismatches.push(id);
    evaluated.set(id, structuredClone(value));
    steps.push({ nodeId: id, digest, value: structuredClone(value), replay: node.replay, matchesExpected });
    return value;
  };
  for (const node of envelope.pack.nodes) {
    if (node.replay !== "excluded") evaluate(node.id);
  }
  for (const id of Object.keys(runner.expectedDigests ?? {})) {
    const node = byId.get(id);
    if (!node || node.replay === "excluded") {
      throw new TracePackValidationError("Replay expectation refers to missing/excluded node: " + id);
    }
  }
  return {
    schema: "tracepack.replay-exercise/v1",
    traceDigest: plan.traceDigest,
    authority: "none",
    effectReplay: false,
    steps,
    mismatches,
    verification: "not-attested"
  };
};
