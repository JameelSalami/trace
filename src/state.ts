import { Effect } from "effect";
import type {
  JsonValue,
  SemanticDigest,
  StateMapPointer,
  StateRuntimeStore
} from "@durable-systems/state";

import { TracePackValidationError } from "./model.js";

export const TRACEPACK_STATE_RUNTIME_SNAPSHOT_SCHEMA =
  "tracepack.state-runtime-snapshot/v1" as const;

export interface StateRuntimeTraceFact {
  readonly id: string;
  readonly kind: string;
  readonly recordDigest: SemanticDigest;
  readonly value: JsonValue;
}

export interface StateRuntimeTraceSnapshot {
  readonly schema: typeof TRACEPACK_STATE_RUNTIME_SNAPSHOT_SCHEMA;
  readonly authority: "none";
  readonly project: string;
  readonly pointer: StateMapPointer;
  readonly records: readonly StateRuntimeTraceFact[];
  readonly sourceDigests: readonly SemanticDigest[];
}

export const readStateRuntimeTraceSnapshot = async (
  store: StateRuntimeStore,
  recordIds: readonly string[]
): Promise<StateRuntimeTraceSnapshot> => {
  const ids = [...new Set(recordIds)];
  if (ids.length !== recordIds.length || ids.some((id) => id.trim() === "")) {
    throw new TracePackValidationError(
      "State Runtime trace selection requires unique non-empty record ids."
    );
  }

  const pointer = await Effect.runPromise(store.current);
  if (pointer === null) {
    throw new TracePackValidationError(
      "State Runtime trace source has no current StateMap."
    );
  }
  await Effect.runPromise(store.verifyHistory);

  const map = await Effect.runPromise(store.getMap(pointer.map));
  if (
    map.value.project !== store.projectId ||
    map.value.generation !== pointer.generation
  ) {
    throw new TracePackValidationError(
      "State Runtime captured pointer does not bind its immutable StateMap."
    );
  }

  const records: StateRuntimeTraceFact[] = [];
  for (const id of ids.sort()) {
    const entry = map.value.entries[id];
    if (entry === undefined) {
      throw new TracePackValidationError(
        `State Runtime captured StateMap does not contain requested record "${id}".`
      );
    }
    const record = await Effect.runPromise(store.getRecord(entry.record));
    if (
      record.value.id !== id ||
      record.value.kind !== entry.kind
    ) {
      throw new TracePackValidationError(
        `State Runtime captured StateMap record "${id}" has an identity mismatch.`
      );
    }
    records.push({
      id,
      kind: entry.kind,
      recordDigest: record.digest,
      value: record.value.value
    });
  }

  const sourceDigests = [
    pointer.map,
    ...records.map((record) => record.recordDigest)
  ].sort();

  return {
    schema: TRACEPACK_STATE_RUNTIME_SNAPSHOT_SCHEMA,
    authority: "none",
    project: store.projectId,
    pointer,
    records,
    sourceDigests
  };
};

export { readStateRuntimeTraceSnapshotScoped } from "./scoped-state.js";
export type { ScopedStateRuntimeTraceSnapshot } from "./scoped-state.js";
