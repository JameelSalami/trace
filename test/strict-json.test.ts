import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson, semanticDigest, type JsonValue
} from "../src/canonical.js";
import {
  packTrace, TracePackValidationError, type TracePack
} from "../src/model.js";
import { exerciseTraceReplay } from "../src/evaluate.js";

const base = (): TracePack => ({
  schema: "tracepack/v1",
  authority: "none",
  subject: { project: "example", kind: "replay", id: "date-rejection" },
  compiler: { id: "replay-example", version: "1" },
  sourceDigests: [semanticDigest({ source: "test" })],
  nodes: [{
    id: "input",
    kind: "test.input",
    owner: "host",
    authority: "none",
    currentness: "historical",
    verification: "not-applicable",
    consequence: "not-established",
    replay: "input",
    causalParents: []
  }],
  authorityEpochs: [],
  closure: { kind: "unresolved" },
  redactions: []
});

test("Date and all other non-JSON object types cannot collide with an empty object digest", () => {
  const date = new Date("2020-01-02T03:04:05.000Z");
  const emptyDigest = semanticDigest({});
  assert.match(emptyDigest, /^sha256:[0-9a-f]{64}$/);
  for (const [label, value] of [
    ["Date", date],
    ["Map", new Map([["a", 1]])],
    ["Set", new Set([1])],
    ["RegExp", /x/],
    ["boxed number", new Number(3)],
    ["typed array", new Uint8Array([1, 2])],
    ["class instance", new (class Example { readonly value = 1; })()],
    ["Promise", Promise.resolve(1)]
  ] as const) {
    assert.throws(
      () => semanticDigest(value as never),
      /plain objects or arrays/,
      label
    );
  }
  assert.equal(semanticDigest(date.toISOString()), semanticDigest("2020-01-02T03:04:05.000Z"));
  assert.notEqual(semanticDigest(date.toISOString()), emptyDigest);
});

test("non-JSON primitives and nested invalid values are refused instead of dropped", () => {
  const invalid: readonly unknown[] = [
    undefined, 8n, Symbol("symbol"), () => 1,
    Number.NaN, Infinity, -Infinity,
    { nested: [undefined] },
    { nested: { value: new Date("2020-01-02T03:04:05Z") } },
    { nested: { value: NaN } },
    { a: 1, ignored: undefined },
    [1, , 3],
    Object.assign([1, 2], { extra: "hidden from JSON" })
  ];
  for (const value of invalid) {
    assert.throws(() => canonicalJson(value as JsonValue), TypeError);
  }
});

test("canonical JSON refuses cyclic, accessor, symbol-keyed and hidden properties", () => {
  const cycle: Record<string, unknown> = { ok: true };
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle as JsonValue), /cyclic JSON/);

  let calls = 0;
  const getter = Object.defineProperty({}, "value", {
    enumerable: true,
    get() { calls++; return 1; }
  });
  assert.throws(() => semanticDigest(getter as never), /data properties/);
  assert.equal(calls, 0, "do not invoke getters while computing identities");

  const array = Object.defineProperty([1], "0", {
    enumerable: true,
    get() { calls++; return 1; }
  });
  assert.throws(() => semanticDigest(array as never), /own data elements/);
  assert.equal(calls, 0);

  const symbol = { id: 1, [Symbol("secret")]: 3 };
  assert.throws(() => semanticDigest(symbol as never), /symbol keys/);

  const hidden = Object.defineProperty({ id: 1 }, "hidden", {
    enumerable: false, value: 2
  });
  assert.throws(() => semanticDigest(hidden as never), /enumerable data/);
});

test("plain, null-prototype and shared-reference JSON preserve v1 canonical bytes", () => {
  const shared = { value: 1 };
  const reused = { a: shared, b: shared };
  assert.equal(
    canonicalJson(reused),
    '{"a":{"value":1},"b":{"value":1}}'
  );
  assert.equal(semanticDigest(reused), semanticDigest({
    b: { value: 1 }, a: { value: 1 }
  }));
  const nullPrototype = Object.create(null) as Record<string, unknown>;
  nullPrototype.b = 2;
  nullPrototype.a = 1;
  assert.equal(canonicalJson(nullPrototype as JsonValue), '{"a":1,"b":2}');
  const numericKeys = JSON.parse('{"10":"ten","2":"two","01":"leading","__proto__":"data"}');
  assert.equal(canonicalJson(numericKeys), '{"01":"leading","10":"ten","2":"two","__proto__":"data"}');
});

test("replay cannot claim a match when evaluator supplies Date instead of expected {}", () => {
  const envelope = packTrace(base());
  const expected = semanticDigest({});
  assert.throws(
    () => exerciseTraceReplay(envelope, {
      expectedDigests: { input: expected },
      evaluate: () => new Date("2020-01-02T03:04:05.000Z") as never
    }),
    (error: unknown) => error instanceof TracePackValidationError &&
      /noncanonical JSON/.test(error.message)
  );
  const accepted = exerciseTraceReplay(envelope, {
    expectedDigests: { input: expected },
    evaluate: () => ({})
  });
  assert.equal(accepted.steps[0]?.matchesExpected, true);
});

test("a TracePack payload cannot smuggle Date objects into content-addressed evidence", () => {
  const pack = base();
  assert.throws(
    () => packTrace({
      ...pack,
      nodes: pack.nodes.map(node => ({
        ...node,
        payload: { selectedAt: new Date("2020-01-02T03:04:05.000Z") } as never
      }))
    }),
    /plain objects or arrays/
  );
});
