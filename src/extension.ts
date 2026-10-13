import { packTrace, type TraceEnvelope, type TraceNode, TracePackValidationError } from "./model.js";
import { isSha256 } from "./canonical.js";

export interface ExtensionEvidenceReference {
  readonly kind: "qualification" | "authorization" | "outcome";
  readonly digest: string;
  readonly projectId: string;
  readonly proposalId: string;
  readonly manifestDigest: string;
  readonly transitionDigest: string;
}

export interface ExtensionTraceInput {
  readonly projectId: string;
  readonly proposalId: string;
  readonly manifestDigest: string;
  readonly transitionDigest: string;
  readonly qualificationEvidenceDigest: string;
  readonly authorizationEvidenceDigest: string;
  readonly requestedBy: {
    readonly kind: "human" | "agent";
    readonly id: string;
  };
  readonly observation?: {
    readonly disposition: "applied" | "refused";
    readonly receiptDigest: string;
  };
}

/**
 * Extension history is evidence, never an instruction to replay an action.
 * Observed closure requires externally validated evidence supplied by the
 * trusted host. Incomplete or untrusted observations remain unresolved.
 */
export function traceExtensionChange(
  input: ExtensionTraceInput,
  verifyEvidence: (reference: ExtensionEvidenceReference) => boolean,
): TraceEnvelope {
  if (!input || typeof input !== "object" ||
      !input.requestedBy || typeof input.requestedBy !== "object") {
    throw new TracePackValidationError("Invalid extension evidence reference");
  }
  const identifiers = [input.projectId, input.proposalId, input.requestedBy.id];
  if (identifiers.some((value) => typeof value !== "string" || !value.trim()) ||
      !["human", "agent"].includes(input.requestedBy?.kind) ||
      !isSha256(input.manifestDigest) ||
      !isSha256(input.transitionDigest) ||
      !isSha256(input.qualificationEvidenceDigest) ||
      !isSha256(input.authorizationEvidenceDigest) ||
      (input.observation !== undefined &&
        (!input.observation || typeof input.observation !== "object" ||
          !["applied", "refused"].includes(input.observation.disposition) ||
          !isSha256(input.observation.receiptDigest)))) {
    throw new TracePackValidationError("Invalid extension evidence reference");
  }
  const proofRefs: readonly ExtensionEvidenceReference[] = [
    { kind: "qualification" as const, digest: input.qualificationEvidenceDigest },
    { kind: "authorization" as const, digest: input.authorizationEvidenceDigest },
    ...(input.observation ? [{ kind: "outcome" as const, digest: input.observation.receiptDigest }] : []),
  ].map((ref) => ({
    ...ref,
    projectId: input.projectId,
    proposalId: input.proposalId,
    manifestDigest: input.manifestDigest,
    transitionDigest: input.transitionDigest,
  }));
  const refs = proofRefs.map((ref) => ref.digest);
  let trusted = false;
  try {
    trusted = typeof verifyEvidence === "function" &&
      proofRefs.every((reference) => verifyEvidence(reference) === true);
  } catch {
    trusted = false;
  }

  const nodes: TraceNode[] = [{
    id: "proposed",
    kind: "extension-transition-proposal",
    owner: input.projectId,
    authority: "none",
    currentness: "current-at-capture",
    verification: "not-applicable",
    consequence: "not-established",
    replay: "excluded",
    causalParents: [],
    payload: {
      schema: "trace.extension-change/v1",
      requestedBy: { kind: input.requestedBy.kind, id: input.requestedBy.id },
      transitionDigest: input.transitionDigest,
      manifestDigest: input.manifestDigest,
      qualificationEvidenceDigest: input.qualificationEvidenceDigest,
      authorizationEvidenceDigest: input.authorizationEvidenceDigest,
      authority: "none",
    }
  }];
  if (input.observation) {
    nodes.push({
      id: "outcome",
      kind: "extension-transition-" + input.observation.disposition,
      owner: input.projectId,
      authority: "none",
      currentness: "current-at-capture",
      verification: trusted ? "verified" : "unverified",
      consequence: trusted ? "established" : "unknown",
      replay: "excluded",
      causalParents: ["proposed"],
      payload: {
        disposition: input.observation.disposition,
        receiptDigest: input.observation.receiptDigest,
        authority: "none",
      }
    });
  }
  return packTrace({
    schema: "tracepack/v1",
    authority: "none",
    subject: {
      project: input.projectId, kind: "extension-transition", id: input.proposalId
    },
    compiler: { id: "trace.extension-change", version: "1" },
    sourceDigests: [...new Set([input.manifestDigest, input.transitionDigest, ...refs])].sort(),
    nodes,
    authorityEpochs: [],
    closure: input.observation && trusted
      ? { kind: "observed", evidenceNodeIds: ["outcome"] }
      : { kind: "unresolved" },
    redactions: [],
  });
}