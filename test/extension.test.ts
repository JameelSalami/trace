import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticDigest, traceExtensionChange, verifyTraceEnvelope,
  type ExtensionTraceInput,
} from "../src/index.js";

const digest = (word: string) => semanticDigest(word);
const proposed: ExtensionTraceInput = {
  projectId: "example",
  proposalId: "proposal-1",
  manifestDigest: digest("manifest"),
  transitionDigest: digest("transition"),
  qualificationEvidenceDigest: digest("qualification"),
  authorizationEvidenceDigest: digest("authorization-reference"),
  requestedBy: { kind: "agent", id: "user-agent-1" },
};

test("an extension proposal remains non-executable and unresolved even with evidence references", () => {
  const envelope = traceExtensionChange(proposed, () => true);
  verifyTraceEnvelope(envelope);
  assert.equal(envelope.pack.authority, "none");
  assert.equal(envelope.pack.nodes[0]?.authority, "none");
  assert.equal(envelope.pack.nodes[0]?.replay, "excluded");
  assert.deepEqual(envelope.pack.closure, { kind: "unresolved" });
  assert.deepEqual(envelope.pack.authorityEpochs, []);
  const repeat = traceExtensionChange(proposed, () => true);
  assert.equal(envelope.digest, repeat.digest);
});

test("observed extension effects require trusted external qualification, authorization and effect evidence", () => {
  const event: ExtensionTraceInput = {
    ...proposed,
    observation: { disposition: "applied", receiptDigest: digest("effect receipt") }
  };
  const verification = traceExtensionChange(event, () => true);
  verifyTraceEnvelope(verification);
  assert.equal(verification.pack.closure.kind, "observed");
  assert.equal(verification.pack.nodes[1]?.verification, "verified");
  assert.equal(verification.pack.nodes[1]?.consequence, "established");
  assert.equal(verification.pack.nodes[1]?.replay, "excluded");
  const wrongScope = traceExtensionChange(event, (ref) =>
    ref.kind !== "authorization" || ref.transitionDigest === digest("other transition"));
  assert.equal(wrongScope.pack.closure.kind, "unresolved");
  const untrusted = traceExtensionChange(event, (ref) =>
    ref.digest !== event.authorizationEvidenceDigest);
  assert.equal(untrusted.pack.closure.kind, "unresolved");
  assert.equal(untrusted.pack.nodes[1]?.verification, "unverified");
  assert.equal(untrusted.pack.nodes[1]?.consequence, "unknown");
  assert.equal(traceExtensionChange(event, () => { throw Error("verifier unavailable"); }).pack.closure.kind,
    "unresolved");
});

test("refusal is an observed consequence, never permission or an executable replay", () => {
  const refused = traceExtensionChange({
    ...proposed,
    observation: { disposition: "refused", receiptDigest: digest("refusal proof") }
  }, () => true);
  assert.equal(refused.pack.closure.kind, "observed");
  assert.equal(refused.pack.nodes[1]?.kind, "extension-transition-refused");
  assert.ok(refused.pack.nodes.every((node) => node.replay === "excluded"));
});

test("invalid hashes and unverifiable actor identity cannot enter TracePack", () => {
  assert.throws(() => traceExtensionChange({
    ...proposed, transitionDigest: "bad"
  }, () => true), /Invalid extension evidence reference/);
  assert.throws(() => traceExtensionChange({
    ...proposed, requestedBy: { kind: "agent", id: "" }
  }, () => true), /Invalid extension evidence reference/);
  assert.throws(() => traceExtensionChange({
    ...proposed, observation: { disposition: "applied", receiptDigest: "forged" }
  }, () => true), /Invalid extension evidence reference/);
});