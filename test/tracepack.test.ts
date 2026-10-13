import assert from "node:assert/strict";
import test from "node:test";

import {
  compileReplay,
  packTrace,
  semanticDigest,
  verifyTraceEnvelope,
  type TracePack
} from "../src/index.js";

const digest = (label: string): string => semanticDigest(label as unknown as never);

const base = (): TracePack => ({
  schema: "tracepack/v1",
  authority: "none",
  subject: { project: "example", kind: "delivery", id: "delivery-1" },
  compiler: { id: "example-trace/v1", version: "1" },
  sourceDigests: [digest("source")],
  nodes: [
    {
      id: "request",
      kind: "request",
      role: "domain-input",
      owner: "example",
      authority: "none",
      currentness: "historical",
      verification: "not-applicable",
      consequence: "not-established",
      replay: "input",
      causalParents: []
    },
    {
      id: "grant",
      kind: "command-grant",
      role: "authority-evidence",
      owner: "example-admission",
      authority: "none",
      currentness: "historical",
      verification: "verified",
      consequence: "not-established",
      replay: "fixture",
      causalParents: ["request"],
      historicalAuthority: {
        kind: "historical-authority",
        authorityRef: "grant-1",
        token: 3,
        replayable: false
      }
    },
    {
      id: "attempt",
      kind: "delivery-attempt",
      owner: "example-runtime",
      authority: "none",
      currentness: "historical",
      verification: "verified",
      consequence: "not-established",
      replay: "fixture",
      causalParents: ["grant"]
    },
    {
      id: "receipt",
      kind: "delivery-receipt",
      owner: "example-runtime",
      authority: "none",
      currentness: "historical",
      verification: "verified",
      consequence: "established",
      replay: "fixture",
      causalParents: ["attempt"]
    },
    {
      id: "summary",
      kind: "human-summary",
      owner: "example-projection",
      authority: "none",
      currentness: "current-at-capture",
      verification: "not-applicable",
      consequence: "not-established",
      replay: "derived",
      causalParents: ["receipt"]
    }
  ],
  authorityEpochs: [{
    id: "epoch-1",
    invocationId: "inv-1",
    authorityRef: "grant-1",
    token: 3,
    currentness: "historical",
    attemptIds: ["attempt"],
    replayable: false
  }],
  closure: { kind: "observed", evidenceNodeIds: ["receipt"] },
  redactions: []
});

test("TracePack digest is deterministic over canonical JSON object ordering", () => {
  const one = packTrace({
    ...base(),
    nodes: [{
      ...base().nodes[0]!,
      payload: { b: 2, a: 1 }
    }, ...base().nodes.slice(1)]
  });
  const two = packTrace({
    ...base(),
    nodes: [{
      ...base().nodes[0]!,
      payload: { a: 1, b: 2 }
    }, ...base().nodes.slice(1)]
  });
  assert.equal(one.digest, two.digest);
});

test("consumer-owned kinds are not constrained by an Actance ontology", () => {
  const envelope = packTrace({
    ...base(),
    nodes: base().nodes.map((node) =>
      node.id === "request" ? { ...node, kind: "civilian-warning-input" } : node
    )
  });
  assert.equal(envelope.pack.nodes[0]?.kind, "civilian-warning-input");
});

test("established consequence requires verified evidence", () => {
  const value = base();
  const nodes = value.nodes.map((node) =>
    node.id === "receipt" ? { ...node, verification: "unverified" as const } : node
  );
  assert.throws(
    () => packTrace({ ...value, nodes }),
    /Established consequence requires verified evidence/
  );
});

test("observed closure requires verified consequence-establishing evidence", () => {
  const value = base();
  assert.throws(
    () => packTrace({
      ...value,
      closure: { kind: "observed", evidenceNodeIds: ["attempt"] }
    }),
    /verified consequence-establishing/
  );
});

test("unresolved closure preserves unknown without inventing failure or success", () => {
  const value = base();
  const nodes = value.nodes
    .filter((node) => node.id !== "receipt" && node.id !== "summary")
    .map((node) =>
      node.id === "attempt" ? { ...node, consequence: "unknown" as const } : node
    );
  const envelope = packTrace({ ...value, nodes, closure: { kind: "unresolved" } });
  assert.equal(envelope.pack.closure.kind, "unresolved");
  assert.equal(envelope.pack.nodes.find((node) => node.id === "attempt")?.consequence, "unknown");
});

test("causal graph rejects missing parents and cycles", () => {
  const value = base();
  assert.throws(
    () => packTrace({
      ...value,
      nodes: value.nodes.map((node) =>
        node.id === "request" ? { ...node, causalParents: ["missing"] } : node
      )
    }),
    /missing causal parent/
  );
  assert.throws(
    () => packTrace({
      ...value,
      nodes: value.nodes.map((node) =>
        node.id === "request" ? { ...node, causalParents: ["receipt"] } : node
      )
    }),
    /acyclic/
  );
});

test("replay classification is consumer-declared and cannot reuse authority or effects", () => {
  const envelope = packTrace(base());
  const replay = compileReplay(envelope);
  assert.equal(replay.authority, "none");
  assert.equal(replay.effectReplay, false);
  assert.equal(replay.historicalAuthorityEpochs[0]?.replayable, false);
  assert.equal(replay.inputNodes.some((node) => node.id === "request"), true);
  assert.equal(replay.fixtureNodes.some((node) => node.id === "receipt"), true);
  assert.equal(replay.derivedNodes.some((node) => node.id === "summary"), true);
});

test("explicit redaction is content-addressed and authority:none", () => {
  const value = base();
  const envelope = packTrace({
    ...value,
    redactions: [{
      id: "customer-body",
      originalDigest: digest("private-body"),
      classification: "private",
      reason: "portable-export",
      semanticRole: "source-document"
    }]
  });
  assert.equal(envelope.pack.authority, "none");
  assert.equal(envelope.pack.redactions[0]?.semanticRole, "source-document");
});

test("tampered envelope fails content verification", () => {
  const envelope = packTrace(base());
  const tampered = {
    ...envelope,
    pack: {
      ...envelope.pack,
      subject: { ...envelope.pack.subject, id: "different-work" }
    }
  };
  assert.throws(() => verifyTraceEnvelope(tampered), /content digest mismatch/);
});
