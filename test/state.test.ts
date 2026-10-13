import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
  makeMemoryStateStore,
  makeRecord,
  makeStateMap,
  recordDigest,
  semanticDigest
} from "@durable-systems/state";

import { readStateRuntimeTraceSnapshot } from "../src/state.js";

test("TracePack reads verified current facts from a caller-owned State Runtime without owning state", async () => {
  const store = await Effect.runPromise(makeMemoryStateStore("trace-source"));
  const record = makeRecord(
    "trace-source",
    "observation:1",
    "consumer.observation/v1",
    { status: "verified", authority: "none" }
  );
  const digest = recordDigest(record);
  const map = makeStateMap({
    project: "trace-source",
    generation: 0,
    parent: null,
    compiler: "trace-source/v1",
    sourceDigest: semanticDigest({ source: "fixture" }),
    entries: {
      [record.id]: {
        kind: record.kind,
        record: digest
      }
    }
  });
  const pointer = await Effect.runPromise(
    store.commit({ expected: null, records: [record], map })
  );

  const snapshot = await readStateRuntimeTraceSnapshot(store, [record.id]);
  assert.equal(snapshot.authority, "none");
  assert.equal(snapshot.project, "trace-source");
  assert.equal(snapshot.pointer.map, pointer.map);
  assert.deepEqual(snapshot.records, [{
    id: record.id,
    kind: record.kind,
    recordDigest: digest,
    value: record.value
  }]);
  assert.deepEqual(snapshot.sourceDigests, [digest, pointer.map].sort());
});

test("TracePack State Runtime adapter fails closed on absent requested current facts", async () => {
  const store = await Effect.runPromise(makeMemoryStateStore("trace-source"));
  await assert.rejects(
    () => readStateRuntimeTraceSnapshot(store, ["missing"]),
    /no current StateMap/
  );
});

test("TracePack binds selected facts to one captured immutable StateMap under concurrent advancement", async () => {
  const store = await Effect.runPromise(makeMemoryStateStore("trace-source"));
  const record0 = makeRecord(
    "trace-source",
    "observation:1",
    "consumer.observation/v1",
    { generation: 0 }
  );
  const map0 = makeStateMap({
    project: "trace-source",
    generation: 0,
    parent: null,
    compiler: "trace-source/v1",
    sourceDigest: semanticDigest({ generation: 0 }),
    entries: {
      [record0.id]: {
        kind: record0.kind,
        record: recordDigest(record0)
      }
    }
  });
  const pointer0 = await Effect.runPromise(
    store.commit({ expected: null, records: [record0], map: map0 })
  );

  const record1 = makeRecord(
    "trace-source",
    "observation:1",
    "consumer.observation/v1",
    { generation: 1 }
  );
  const map1 = makeStateMap({
    project: "trace-source",
    generation: 1,
    parent: pointer0.map,
    compiler: "trace-source/v1",
    sourceDigest: semanticDigest({ generation: 1 }),
    entries: {
      [record1.id]: {
        kind: record1.kind,
        record: recordDigest(record1)
      }
    }
  });

  let advanced = false;
  const racing = {
    ...store,
    verifyHistory: Effect.gen(function*() {
      if (!advanced) {
        advanced = true;
        yield* store.commit({
          expected: pointer0,
          records: [record1],
          map: map1
        }).pipe(Effect.orDie);
      }
      return yield* store.verifyHistory;
    })
  };

  const snapshot = await readStateRuntimeTraceSnapshot(
    racing,
    [record0.id]
  );
  assert.equal(snapshot.pointer.generation, 0);
  assert.deepEqual(snapshot.records[0]?.value, { generation: 0 });
  assert.equal(
    (await Effect.runPromise(store.current))?.generation,
    1
  );
});


test("TracePack State Runtime adapter rejects duplicate or empty selection before opening state", async () => {
  const store = await Effect.runPromise(makeMemoryStateStore("trace-source"));
  await assert.rejects(
    () => readStateRuntimeTraceSnapshot(store, ["missing", "missing"]),
    /unique non-empty record ids/
  );
  await assert.rejects(
    () => readStateRuntimeTraceSnapshot(store, [""]),
    /unique non-empty record ids/
  );
  await Effect.runPromise(store.close);
});
