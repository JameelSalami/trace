import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { makeMemoryStateStore, makeRecord, makeStateMap, recordDigest, semanticDigest } from "@durable-systems/state";
import { readStateRuntimeTraceSnapshotScoped } from "../src/state.js";
import { exerciseTraceReplay } from "../src/evaluate.js";
import { packTrace, type TracePack } from "../src/model.js";

test("scoped current verification does not call expensive full-history scan", async () => {
  const store = await Effect.runPromise(makeMemoryStateStore("demo"));
  const record = makeRecord("demo", "current", "observation", { result: 1 });
  const map = makeStateMap({
    project:"demo",generation:0,parent:null,compiler:"test",
    sourceDigest:semanticDigest({}), entries:{current:{kind:record.kind,record:recordDigest(record)}}
  });
  await Effect.runPromise(store.commit({expected:null,records:[record],map}));
  let histories = 0;
  let currents = 0;
  const observed = {
    ...store,
    verifyHistory: Effect.sync(() => { histories++; throw Error("unexpected full scan"); }),
    verifyCurrent: store.verifyCurrent.pipe(Effect.tap(() => Effect.sync(() => { currents++; })))
  };
  const hot = await readStateRuntimeTraceSnapshotScoped(observed,["current"],"current");
  assert.equal(hot.verificationScope,"current");
  assert.equal(hot.schema,"tracepack.state-runtime-snapshot/v2");
  assert.equal(histories,0);
  assert.equal(currents,1);
  assert.deepEqual(hot.records.map(x=>x.id),["current"]);
  await assert.rejects(
    () => readStateRuntimeTraceSnapshotScoped(observed,["current"],"history"),
    /unexpected full scan/
  );
  await Effect.runPromise(store.close);
});

const base = (): TracePack => ({
  schema:"tracepack/v1",authority:"none",
  subject:{project:"demo",kind:"pricing",id:"quote"},
  compiler:{id:"pricing",version:"1"},
  sourceDigests:[semanticDigest({source:1})],
  nodes:[
    {id:"input",kind:"order",owner:"demo",authority:"none",
     currentness:"historical",verification:"not-applicable",
     consequence:"not-established",replay:"input",causalParents:[]},
    {id:"calc",kind:"total",owner:"demo",authority:"none",
     currentness:"historical",verification:"verified",
     consequence:"not-established",replay:"derived",causalParents:["input"]},
    {id:"private",kind:"effect",owner:"demo",authority:"none",
     currentness:"historical",verification:"not-applicable",
     consequence:"not-established",replay:"excluded",causalParents:[]},
  ],
  authorityEpochs:[],closure:{kind:"unresolved"},redactions:[]
});
test("host-owned replay actually reevaluates causal inputs, checks digest and never invokes excluded nodes", () => {
  const seen:string[]=[];
  const envelope=packTrace(base());
  const result=exerciseTraceReplay(envelope,{
    expectedDigests:{ calc:semanticDigest({total:125}) },
    evaluate:(node,parents)=>{
      seen.push(node.id);
      return node.id==="input"?{cents:100}:
        {total:(parents.input as {cents:number}).cents+25};
    }
  });
  assert.deepEqual(seen,["input","calc"]);
  assert.deepEqual(result.mismatches,[]);
  assert.equal(result.steps[1]?.matchesExpected,true);
  assert.equal(result.effectReplay,false);
  assert.equal(result.authority,"none");
  assert.equal(result.verification,"not-attested");
  const mismatch=exerciseTraceReplay(envelope,{
    expectedDigests:{ calc:semanticDigest({total:999}) },
    evaluate:(node,parents)=>node.id==="input"?{cents:100}:
      {total:(parents.input as {cents:number}).cents+25}
  });
  assert.deepEqual(mismatch.mismatches,["calc"]);
});
