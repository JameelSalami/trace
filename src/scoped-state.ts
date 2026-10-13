import { Effect } from "effect";
import type { SemanticDigest, StateRuntimeStore } from "@durable-systems/state";
import { TracePackValidationError } from "./model.js";
import { readStateRuntimeTraceSnapshot } from "./state.js";
import type { StateRuntimeTraceSnapshot, StateRuntimeTraceFact } from "./state.js";

export interface ScopedStateRuntimeTraceSnapshot extends Omit<StateRuntimeTraceSnapshot, "schema"> {
  readonly schema: "tracepack.state-runtime-snapshot/v2";
  readonly verificationScope: "current" | "history";
}

/**
 * Explicitly scopes the proof: "current" verifies only the captured current
 * map and records; "history" verifies every reachable historical map.
 * This DOES NOT make the earlier history trustworthy in current mode.
 *
 * Legacy readStateRuntimeTraceSnapshot remains history-only and unchanged.
 */
export const readStateRuntimeTraceSnapshotScoped = async (
  store: StateRuntimeStore,
  recordIds: readonly string[],
  verificationScope: "current" | "history"
): Promise<ScopedStateRuntimeTraceSnapshot> => {
  if (verificationScope !== "current" && verificationScope !== "history") {
    throw new TracePackValidationError("Invalid State verification scope");
  }
  if (verificationScope === "history") {
    const previous = await readStateRuntimeTraceSnapshot(store, recordIds);
    return { ...previous, schema: "tracepack.state-runtime-snapshot/v2", verificationScope };
  }
  const ids = [...new Set(recordIds)];
  if (ids.length !== recordIds.length || ids.some(id =>
      typeof id !== "string" || id.trim() === "")) {
    throw new TracePackValidationError(
      "State Runtime trace selection requires unique non-empty record ids."
    );
  }
  const pointer = await Effect.runPromise(store.current);
  if (pointer === null) {
    throw new TracePackValidationError("State Runtime trace source has no current StateMap.");
  }
  const verification = await Effect.runPromise(store.verifyCurrent);
  if (verification.map !== pointer.map || verification.generation !== pointer.generation) {
    throw new TracePackValidationError("State Runtime current pointer changed during verification.");
  }
  const map = await Effect.runPromise(store.getMap(pointer.map));
  if (map.value.project !== store.projectId ||
      map.value.generation !== pointer.generation) {
    throw new TracePackValidationError("State Runtime captured current pointer does not bind its map.");
  }
  const records: StateRuntimeTraceFact[] = [];
  for (const id of ids.sort()) {
    const entry = map.value.entries[id];
    if (!entry) {
      throw new TracePackValidationError("State Runtime captured StateMap does not contain record: " + id);
    }
    const record = await Effect.runPromise(store.getRecord(entry.record));
    if (record.value.id !== id || record.value.kind !== entry.kind) {
      throw new TracePackValidationError("State Runtime selected record identity mismatch: " + id);
    }
    records.push({ id, kind: entry.kind, recordDigest: record.digest, value: record.value.value });
  }
  const sourceDigests: SemanticDigest[] = [
    pointer.map, ...records.map(record => record.recordDigest)
  ].sort();
  return {
    schema: "tracepack.state-runtime-snapshot/v2",
    authority: "none",
    verificationScope,
    project: store.projectId,
    pointer,
    records,
    sourceDigests
  };
};
