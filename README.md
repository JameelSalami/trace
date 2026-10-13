# Trace

> **Independent publication candidate, not yet published.** Planned npm identity:
> `@durable-systems/trace@0.1.0`; GitHub: `jameelsalami/trace`.
> Namespace authorization and upstream source-rights clearance remain pending.
> `private: true` deliberately prevents accidental publication.


Trace is a stateless, domain-neutral substrate for portable causal evidence.

It packages consumer-owned facts and evidence into deterministic, content-addressed traces suitable
for replay, debugging, migration, explanation, learning inputs, and research artifacts without
claiming authority over the source domain.

```text
consumer-owned facts and evidence
        ↓
consumer-owned trace compiler
        ↓
TracePack
        ↓
portable causal evidence
```

Trace is **state:none** and **authority:none**. It owns no database, scheduler, domain aggregate,
admission policy, external consequence authority, or learning policy.

## Foundation relationship

State, Trace, and Contract are sibling shared foundations: State owns durable state mechanics; Trace owns causal evidence/replay mechanics; Contract owns machine-readable declarations, receipts, conformance, and drift. None of the three acquires another project's domain nouns or execution authority.

## Contract

Trace preserves a small set of domain-independent laws:

- causal topology is an explicit DAG rather than timestamp ordering;
- node kinds and roles are owned by the consumer, not by TracePack;
- current, stale, historical, and unknown evidence remain distinct;
- verification and consequence establishment remain distinct;
- an established consequence must be backed by verified evidence;
- historical authority is evidence only and is never replayable authority;
- recovery and human intervention can remain explicit nodes instead of rewriting history;
- redaction is explicit and content-addressed;
- the entire trace and every node remain authority:none.

Trace does not define Intent, Allocation, Lease, Realization, Observation, Assessment, or any other
application ontology. Actance may map those concepts into Trace through an Actance-owned adapter,
while other consumers use their own domain vocabulary.

## Replay

Each node declares a replay disposition: input, fixture, derived, or excluded. `compileReplay`
produces an authority:none, effectReplay:false plan. Historical authority epochs remain non-replayable.

Replay is therefore evidence reconstruction, not permission to repeat an external effect. A live rerun
belongs to the consumer domain and must obtain whatever current authority that domain requires.

## State Runtime adapter

The optional State Runtime adapter reads an exact verified snapshot of caller-selected current facts.
It never owns storage, advances a pointer, or retains state. State Runtime is a source mechanism, not
Trace's semantic authority.
## Installation and standalone packaging

After authorized npm publication:

```sh
npm install @durable-systems/trace@0.1.0 effect@3.22.2
# Optional adapter for verified State Runtime snapshots:
npm install @durable-systems/state@0.1.0
```

The root `@durable-systems/trace` and `@durable-systems/trace/core`
entrypoints are stateless and do **not** import State. Import the optional
`@durable-systems/trace/state` adapter explicitly and install
`@durable-systems/state@0.1.0` alongside it when needed. State is an optional
peer; `effect@3.22.2` remains the required peer for the optional adapter.

For independent source verification without a sibling repository:

```sh
npm ci
npm run check
npm test
npm run build
npm run verify:install
```

Trace declares its development dependency as the **exact registry version
`@durable-systems/state@0.1.0`** in `package.json`, with an optional
`0.1.0` peer for the `/state` adapter.

**Prepublication lockfile bootstrap:** State is not yet available from npm.
To let all four GitHub repositories be pushed together and verified from
independent checkouts, `package-lock.json` temporarily resolves this version
to the integrity-pinned `vendor/durable-systems-state-0.1.0.tgz`. The archive
is source-only and excluded from Trace's distribution. `npm ci` therefore
succeeds without State's source checkout or registry publication; this is
**not** evidence of downloading State from the npm registry.

After State `0.1.0` is actually published, regenerate the lockfile against
the published registry version, remove the vendor archive and re-run all
independent builds, CI and consumer tests. GitHub repositories can be pushed
together; npm release order still matters. `npm run verify:install` exercises
core-only imports without State and the State adapter with State installed,
including ESM and TypeScript declarations.

The release archive ships compiled JS, public `.d.ts` declarations, README,
LICENSE and metadata only. No local vendor tarball, source tests, Git history
or private files are shipped. Both `private: true` and the release permission
gate remain in effect. Apache-2.0 terms are provisionally staged in
[LICENSE](LICENSE); confirm original copyright/provenance and inherited
NOTICE obligations before public distribution.

## JavaScript runtime portability

The root `trace` export and `trace/core` are JavaScript-runtime-neutral
and require neither Node crypto nor State. Only the opt-in `trace/state`
entrypoint depends on the State interface, not its SQLite realization.
Trace v1 canonical bytes and SHA-256 identities are unchanged.

## Extension change evidence

`traceExtensionChange(input, verifyEvidence)` packages user-owned extension
proposals and, where available, independently verified observations as
`tracepack/v1` envelopes. It records manifest, change, qualification and
authorization **reference digests**, never raw secrets or executable grants.

The host's `verifyEvidence` callback receives an evidence reference
including its role (qualification/authorization/outcome), project, proposal,
manifest and transition digests. It must validate the evidence in that exact
scope, using an authority path separate from the extension or untrusted
agent. Without independently verified evidence the trace closure remains
`unresolved`; the package never invents success or permission.

Every extension Trace node has `authority: "none"` and
`replay: "excluded"`; observed history cannot replay installation,
migration, or another consequential action. No external code is loaded by
this function.


## Minimal ESM usage

```js
import {
  packTrace, compileReplay, semanticDigest,
} from "@durable-systems/trace";

const source = semanticDigest({ revision: 1 });
const envelope = packTrace({
  schema: "tracepack/v1",
  authority: "none",
  subject: { project: "demo", kind: "example", id: "case-1" },
  compiler: { id: "demo-compiler", version: "1" },
  sourceDigests: [source],
  nodes: [{
    id: "input",
    kind: "example.input",
    owner: "demo",
    authority: "none",
    currentness: "current-at-capture",
    verification: "not-applicable",
    consequence: "not-established",
    replay: "input",
    causalParents: [],
  }],
  authorityEpochs: [],
  closure: { kind: "unresolved" },
  redactions: [],
});
const replay = compileReplay(envelope);
console.log(envelope.digest, replay);
```

Exports: root and `/core` expose canonical JSON, semantic identity, trace
packing/verification, and replay planning; the root additionally exports
`traceExtensionChange`. The opt-in `/state` export provides
`readStateRuntimeTraceSnapshot` and exact State snapshot type declarations.
No direct internal `dist/` or `src/` imports are supported. Trace does not
run effects, own state, or authorize replayed consequences. Its canonical
hashes are identities, never signatures or permissions.

## Related work, prior art and third-party attribution

These are **related standards and independent projects**, not a statement
of copied implementation, wire interoperability or endorsement:

- [W3C PROV Data Model](https://www.w3.org/TR/2013/REC-prov-dm-20130430/):
  model for provenance of entities, activities, agents and derivations.
  Trace represents its own `tracepack/v1` causal evidence and does not
  serialize W3C PROV.
- [OpenTelemetry tracing](https://opentelemetry.io/docs/specs/otel/trace/api/):
  operation spans with parents, links, timestamps and events. Trace records
  content-addressed causal *evidence* and replay dispositions; it is **not**
  an OpenTelemetry instrumentation or collector replacement.
- [OpenLineage](https://openlineage.io/docs/spec/): event- and
  dataset-oriented data lineage. Trace does not emit OpenLineage events.
- [in-toto attestations](https://in-toto.io/docs/specs/):
  authenticated claims over software artifacts. Trace's semantic digests
  and evidence references **are not signatures or attestations**, and past
  authority does not become a current execution grant.

Trace depends on separately installed `@noble/hashes@2.4.0` (MIT); it
declares `effect@3.22.2` (MIT) as a peer and
`@durable-systems/state@0.1.0` (Apache-2.0) as an **optional peer**.
The source-only State development bootstrap tarball is **excluded from
Trace's npm tarball**. Citations record intellectual context, not the
source's copyright ownership or satisfaction of any inherited notices.

## Scoped State verification and actual replay exercise

The original `readStateRuntimeTraceSnapshot(store, ids)` continues
to verify the complete StateMap history. To avoid repeating O(history)
verification during every hot-path snapshot, opt in to:

```ts
const hot = await readStateRuntimeTraceSnapshotScoped(store, ["receipt"], "current");
```

The result carries `schema: "tracepack.state-runtime-snapshot/v2"` and
`verificationScope: "current"`. This checks the captured current StateMap
and all its current records, **not any earlier history**. Schedule separate
full-history verification for archival assurance. The `"history"` mode still
checks all reachable maps. No unverifiable shortcut is silently enabled.

`compileReplay` remains a **classification plan**, without execution.
For actual opt-in re-evaluation, `exerciseTraceReplay(envelope, runner)`
walks the verified causal DAG and calls a consumer-owned evaluator on
inputs, fixtures, and derived nodes, comparing optional expected output
digests. It never evaluates `excluded` nodes or reuses historical
authority. The result is labeled `verification: "not-attested"`:
a digest match is not proof of independent evidence, and a JavaScript
callback can have ambient side effects unless the **host isolates it**.
Trace has no authority to execute external actions or deploy changes.

## Runtime JSON validation and content identity

Trace's canonical JSON writer now **rejects non-JSON runtime values**,
including `Date`, `Map`, `Set`, class instances, `undefined`,
`NaN`/`Infinity`, sparse arrays, cycles and non-data object properties.
It cannot turn a `Date` into `{}` and accidentally treat it as a matching
replay result. This is checked when generating trace digests and when
comparing replay outputs, including outputs supplied by JavaScript callers
that bypass TypeScript's `JsonValue` type.

Callers must explicitly convert semantic types into plain JSON before
hashing—for example, serialize a date as an ISO-8601 string or a typed
`{ type: "timestamp", iso: "..." }` record. Hashes of **valid plain JSON**
retain their v1 canonical encoding; only previously silently misencoded
non-JSON values are newly rejected. Invalid replay results fail closed
rather than counting as expected digest matches.
