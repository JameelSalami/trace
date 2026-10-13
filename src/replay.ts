import {
  verifyTraceEnvelope,
  type AuthorityEpoch,
  type TraceEnvelope,
  type TraceNode
} from "./model.js";

export interface TraceReplayPlan {
  readonly schema: "tracepack-replay/v1";
  readonly traceDigest: string;
  readonly authority: "none";
  readonly effectReplay: false;
  readonly inputNodes: readonly TraceNode[];
  readonly fixtureNodes: readonly TraceNode[];
  readonly derivedNodes: readonly TraceNode[];
  readonly excludedNodeIds: readonly string[];
  readonly historicalAuthorityEpochs: readonly AuthorityEpoch[];
}

export const compileReplay = (envelope: TraceEnvelope): TraceReplayPlan => {
  verifyTraceEnvelope(envelope);

  const inputNodes: TraceNode[] = [];
  const fixtureNodes: TraceNode[] = [];
  const derivedNodes: TraceNode[] = [];
  const excludedNodeIds: string[] = [];

  for (const node of envelope.pack.nodes) {
    switch (node.replay) {
      case "input":
        inputNodes.push(node);
        break;
      case "fixture":
        fixtureNodes.push(node);
        break;
      case "derived":
        derivedNodes.push(node);
        break;
      case "excluded":
        excludedNodeIds.push(node.id);
        break;
    }
  }

  return {
    schema: "tracepack-replay/v1",
    traceDigest: envelope.digest,
    authority: "none",
    effectReplay: false,
    inputNodes,
    fixtureNodes,
    derivedNodes,
    excludedNodeIds,
    historicalAuthorityEpochs: envelope.pack.authorityEpochs.map((epoch) => ({
      ...epoch,
      attemptIds: [...epoch.attemptIds],
      replayable: false
    }))
  };
};

