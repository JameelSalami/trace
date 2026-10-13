import { isSha256, semanticDigest, type JsonValue } from "./canonical.js";

export const TRACEPACK_SCHEMA = "tracepack/v1" as const;
export const TRACEPACK_ENVELOPE_SCHEMA = "tracepack-envelope/v1" as const;

export type TraceCurrentness =
  | "current-at-capture"
  | "stale-at-capture"
  | "historical"
  | "unknown";

export type TraceVerification = "verified" | "unverified" | "not-applicable";
export type TraceConsequence = "established" | "not-established" | "unknown";
export type TraceReplayDisposition = "input" | "fixture" | "derived" | "excluded";

export interface TraceSourceRef {
  readonly project: string;
  readonly kind: string;
  readonly id: string;
  readonly digest?: string;
}

export type HistoricalAuthorityToken = string | number;

export interface HistoricalAuthorityRef {
  readonly kind: "historical-authority";
  readonly authorityRef: string;
  readonly token?: HistoricalAuthorityToken;
  readonly replayable: false;
}

export interface TraceNode {
  readonly id: string;
  readonly kind: string;
  readonly role?: string;
  readonly owner: string;
  readonly authority: "none";
  readonly currentness: TraceCurrentness;
  readonly verification: TraceVerification;
  readonly consequence: TraceConsequence;
  readonly replay: TraceReplayDisposition;
  readonly causalParents: readonly string[];
  readonly source?: TraceSourceRef;
  readonly historicalAuthority?: HistoricalAuthorityRef;
  readonly payload?: JsonValue;
}

export interface AuthorityEpoch {
  readonly id: string;
  readonly invocationId: string;
  readonly authorityRef: string;
  readonly token?: HistoricalAuthorityToken;
  readonly currentness: Exclude<TraceCurrentness, "unknown">;
  readonly attemptIds: readonly string[];
  readonly replayable: false;
}

export interface RedactedRef {
  readonly id: string;
  readonly originalDigest: string;
  readonly classification: string;
  readonly reason: string;
  readonly semanticRole: string;
}

export type TraceClosure =
  | {
      readonly kind: "observed";
      readonly evidenceNodeIds: readonly string[];
    }
  | {
      readonly kind: "failed" | "cancelled" | "unresolved";
    }
  | {
      readonly kind: "partial";
      readonly continuationRef: string;
    };

export interface TracePack {
  readonly schema: typeof TRACEPACK_SCHEMA;
  readonly authority: "none";
  readonly subject: {
    readonly project: string;
    readonly kind: string;
    readonly id: string;
  };
  readonly compiler: {
    readonly id: string;
    readonly version: string;
  };
  readonly sourceDigests: readonly string[];
  readonly nodes: readonly TraceNode[];
  readonly authorityEpochs: readonly AuthorityEpoch[];
  readonly closure: TraceClosure;
  readonly redactions: readonly RedactedRef[];
}

export interface TraceEnvelope {
  readonly schema: typeof TRACEPACK_ENVELOPE_SCHEMA;
  readonly digest: string;
  readonly pack: TracePack;
}

export class TracePackValidationError extends Error {
  readonly code = "INVALID_TRACEPACK";
  constructor(message: string) {
    super(message);
    this.name = "TracePackValidationError";
  }
}

const nonEmpty = (value: string, label: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TracePackValidationError(label + " must be non-empty.");
  }
};

const validToken = (value: HistoricalAuthorityToken | undefined, label: string): void => {
  if (value === undefined) return;
  if (typeof value === "string") {
    nonEmpty(value, label);
    return;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TracePackValidationError(label + " must be a non-negative safe integer or non-empty string.");
  }
};

const validCurrentness = new Set<TraceCurrentness>([
  "current-at-capture",
  "stale-at-capture",
  "historical",
  "unknown"
]);

const validVerification = new Set<TraceVerification>([
  "verified",
  "unverified",
  "not-applicable"
]);

const validConsequence = new Set<TraceConsequence>([
  "established",
  "not-established",
  "unknown"
]);

const validReplay = new Set<TraceReplayDisposition>([
  "input",
  "fixture",
  "derived",
  "excluded"
]);

const validateDag = (nodes: readonly TraceNode[]): void => {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const permanent = new Set<string>();
  const temporary = new Set<string>();

  const visit = (id: string): void => {
    if (permanent.has(id)) return;
    if (temporary.has(id)) {
      throw new TracePackValidationError("Trace causal graph must be acyclic.");
    }
    temporary.add(id);
    const node = byId.get(id);
    if (node === undefined) {
      throw new TracePackValidationError("Trace node disappeared during validation.");
    }
    for (const parent of node.causalParents) {
      if (!byId.has(parent)) {
        throw new TracePackValidationError(
          'Trace node "' + id + '" references missing causal parent "' + parent + '".'
        );
      }
      visit(parent);
    }
    temporary.delete(id);
    permanent.add(id);
  };

  for (const node of nodes) visit(node.id);
};

export const validateTracePack = (pack: TracePack): void => {
  if (pack.schema !== TRACEPACK_SCHEMA) {
    throw new TracePackValidationError("Unsupported TracePack schema.");
  }
  if (pack.authority !== "none") {
    throw new TracePackValidationError("TracePack can never grant authority.");
  }

  nonEmpty(pack.subject.project, "Trace subject project");
  nonEmpty(pack.subject.kind, "Trace subject kind");
  nonEmpty(pack.subject.id, "Trace subject id");
  nonEmpty(pack.compiler.id, "Trace compiler id");
  nonEmpty(pack.compiler.version, "Trace compiler version");

  for (const digest of pack.sourceDigests) {
    if (!isSha256(digest)) {
      throw new TracePackValidationError("Source digests must be sha256.");
    }
  }

  const nodeIds = new Set<string>();
  for (const node of pack.nodes) {
    nonEmpty(node.id, "Trace node id");
    nonEmpty(node.kind, "Trace node kind");
    nonEmpty(node.owner, "Trace node owner");
    if (node.role !== undefined) nonEmpty(node.role, "Trace node role");

    if (nodeIds.has(node.id)) {
      throw new TracePackValidationError("Trace node ids must be unique.");
    }
    nodeIds.add(node.id);

    if (node.authority !== "none") {
      throw new TracePackValidationError("Trace nodes are evidence and cannot grant authority.");
    }
    if (!validCurrentness.has(node.currentness)) {
      throw new TracePackValidationError('Trace node "' + node.id + '" has invalid currentness.');
    }
    if (!validVerification.has(node.verification)) {
      throw new TracePackValidationError('Trace node "' + node.id + '" has invalid verification.');
    }
    if (!validConsequence.has(node.consequence)) {
      throw new TracePackValidationError('Trace node "' + node.id + '" has invalid consequence.');
    }
    if (!validReplay.has(node.replay)) {
      throw new TracePackValidationError('Trace node "' + node.id + '" has invalid replay disposition.');
    }

    if (node.consequence === "established" && node.verification !== "verified") {
      throw new TracePackValidationError(
        "Established consequence requires verified evidence."
      );
    }

    if (node.historicalAuthority !== undefined) {
      if (
        node.historicalAuthority.kind !== "historical-authority" ||
        node.historicalAuthority.replayable !== false
      ) {
        throw new TracePackValidationError("Historical authority is never replayable.");
      }
      nonEmpty(node.historicalAuthority.authorityRef, "Historical authority reference");
      validToken(node.historicalAuthority.token, "Historical authority token");
    }

    if (node.source !== undefined) {
      nonEmpty(node.source.project, "Trace source project");
      nonEmpty(node.source.kind, "Trace source kind");
      nonEmpty(node.source.id, "Trace source id");
      if (node.source.digest !== undefined && !isSha256(node.source.digest)) {
        throw new TracePackValidationError("Trace source digest must be sha256.");
      }
    }
  }

  validateDag(pack.nodes);

  const epochIds = new Set<string>();
  for (const epoch of pack.authorityEpochs) {
    nonEmpty(epoch.id, "Authority epoch id");
    nonEmpty(epoch.invocationId, "Authority epoch invocation id");
    nonEmpty(epoch.authorityRef, "Authority epoch reference");

    if (epochIds.has(epoch.id)) {
      throw new TracePackValidationError("Authority epoch ids must be unique.");
    }
    epochIds.add(epoch.id);

    if (epoch.replayable !== false) {
      throw new TracePackValidationError(
        "Authority epochs are historical evidence and never replayable."
      );
    }
    if (
      epoch.currentness !== "current-at-capture" &&
      epoch.currentness !== "stale-at-capture" &&
      epoch.currentness !== "historical"
    ) {
      throw new TracePackValidationError("Authority epoch currentness is invalid.");
    }
    validToken(epoch.token, "Authority epoch token");
    for (const attemptId of epoch.attemptIds) {
      nonEmpty(attemptId, "Authority epoch attempt id");
    }
  }

  if (pack.closure.kind === "observed") {
    if (pack.closure.evidenceNodeIds.length === 0) {
      throw new TracePackValidationError(
        "Observed closure requires verified consequence-establishing evidence."
      );
    }
    for (const id of pack.closure.evidenceNodeIds) {
      const node = pack.nodes.find((candidate) => candidate.id === id);
      if (
        node === undefined ||
        node.verification !== "verified" ||
        node.consequence !== "established"
      ) {
        throw new TracePackValidationError(
          "Observed closure may reference only verified consequence-establishing nodes."
        );
      }
    }
  }

  if (pack.closure.kind === "partial") {
    nonEmpty(pack.closure.continuationRef, "Trace continuation reference");
  }

  const redactionIds = new Set<string>();
  for (const redaction of pack.redactions) {
    nonEmpty(redaction.id, "Redaction id");
    if (redactionIds.has(redaction.id)) {
      throw new TracePackValidationError("Redaction ids must be unique.");
    }
    redactionIds.add(redaction.id);

    if (!isSha256(redaction.originalDigest)) {
      throw new TracePackValidationError("Redaction originalDigest must be sha256.");
    }
    nonEmpty(redaction.classification, "Redaction classification");
    nonEmpty(redaction.reason, "Redaction reason");
    nonEmpty(redaction.semanticRole, "Redaction semantic role");
  }
};

const asJson = (pack: TracePack): JsonValue => pack as unknown as JsonValue;

export const packTrace = (pack: TracePack): TraceEnvelope => {
  validateTracePack(pack);
  return {
    schema: TRACEPACK_ENVELOPE_SCHEMA,
    digest: semanticDigest(asJson(pack)),
    pack
  };
};

export const verifyTraceEnvelope = (envelope: TraceEnvelope): void => {
  if (envelope.schema !== TRACEPACK_ENVELOPE_SCHEMA) {
    throw new TracePackValidationError("Unsupported TracePack envelope schema.");
  }
  validateTracePack(envelope.pack);
  const actual = semanticDigest(asJson(envelope.pack));
  if (actual !== envelope.digest) {
    throw new TracePackValidationError("TracePack content digest mismatch.");
  }
};
