#!/usr/bin/env node
// Trace release engineering preflight. Verifies root/core without State and the
// opt-in State adapter with a real, separately packaged State. No sibling checkout.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = "@durable-systems/trace";
const stateName = "@durable-systems/state";
const info = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (info.name !== name || info.private !== true || info.version !== "0.1.0") {
  throw Error("unexpected Trace source identity or safety flag");
}
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const bootstrap = "file:vendor/durable-systems-state-0.1.0.tgz";
const archive = join(root, "vendor", "durable-systems-state-0.1.0.tgz");
const integrity = "sha512-" + createHash("sha512").update(readFileSync(archive)).digest("base64");
if (info.devDependencies?.[stateName] !== "0.1.0" ||
    info.peerDependencies?.[stateName] !== "0.1.0" ||
    info.peerDependenciesMeta?.[stateName]?.optional !== true ||
    lock.packages?.[""]?.devDependencies?.[stateName] !== "0.1.0" ||
    lock.packages?.["node_modules/" + stateName]?.resolved !== bootstrap ||
    lock.packages?.["node_modules/" + stateName]?.integrity !== integrity) {
  throw Error("registry devDependency and offline release bootstrap lockfile are inconsistent");
}
const tmp = mkdtempSync(join(tmpdir(), "trace-independent-consumer-"));
let done = false;
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
function execute(bin, args, cwd, input) {
  const r = spawnSync(bin, args, {
    cwd, input, encoding: "utf8", timeout: 240000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
  });
  if (r.error || r.status !== 0) {
    throw Error([bin + " " + args.join(" "), "cwd=" + cwd,
      "exit=" + r.status, r.error?.message ?? "",
      (r.stdout ?? "").slice(-2200), (r.stderr ?? "").slice(-3000)].join("\n"));
  }
  return r.stdout.trim();
}
function assertArchive(tarball, label) {
  const entries = execute("tar", ["-tzf", tarball], tmp).split("\n").filter(Boolean);
  const allowed = ["package/package.json", "package/README.md", "package/LICENSE"];
  for (const entry of entries) {
    if (!(allowed.includes(entry) || entry.startsWith("package/dist/src/"))) {
      throw Error(label + " unexpected tar member " + entry);
    }
    if (entry.includes("..") || entry.includes(".env") || entry.includes(".git/") ||
        entry.includes("node_modules/") || entry.includes("vendor/")) throw Error("Unsafe entry " + entry);
  }
  for (const entry of [...allowed, "package/dist/src/index.js", "package/dist/src/index.d.ts"]) {
    if (!entries.includes(entry)) throw Error(label + " missing " + entry);
  }
  const pkg = JSON.parse(execute("tar", ["-xOzf", tarball, "package/package.json"], tmp));
  if (pkg.version !== "0.1.0") throw Error(label + " incorrect package version");
  return { entries, pkg };
}
function setupConsumer(label) {
  const dir = join(tmp, label);
  mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "unrelated-" + label, version: "1.0.0", private: true, type: "module",
  }) + "\n");
  return dir;
}
function checkInstalled(dir, pkg) {
  const path = join(dir, "node_modules", ...pkg.split("/"));
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) throw Error("missing real package " + pkg);
  const meta = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  if (meta.name !== pkg || meta.version !== "0.1.0") throw Error(pkg + " version mismatch");
}
function typecheck(dir) {
  execute(join(dir, "node_modules/.bin/tsc"),
    ["--noEmit", "--strict", "--target", "ES2023", "--module", "NodeNext",
      "--moduleResolution", "NodeNext", "--types", "node", "smoke.mts"], dir);
}
const coreJs = `
import { packTrace, compileReplay, semanticDigest, TRACEPACK_SCHEMA } from "@durable-systems/trace";
import { verifyTraceEnvelope } from "@durable-systems/trace/core";
const pack={ schema:"tracepack/v1",authority:"none",
  subject:{project:"consumer",kind:"source",id:"x"},
  compiler:{id:"smoke",version:"1"},sourceDigests:[semanticDigest({x:1})],
  nodes:[{id:"input",kind:"test",owner:"consumer",authority:"none",
    currentness:"historical",verification:"not-applicable",
    consequence:"not-established",replay:"input",causalParents:[]}],
  authorityEpochs:[],closure:{kind:"unresolved"},redactions:[] };
if(TRACEPACK_SCHEMA!=="tracepack/v1") throw Error("schema");
const envelope=packTrace(pack);
verifyTraceEnvelope(envelope);
const replay=compileReplay(envelope);
if(replay.effectReplay!==false || replay.inputNodes.length!==1) throw Error("replay");
`;
const coreTs = `
import { packTrace, compileReplay, type TracePack, type TraceEnvelope, type TraceReplayPlan } from "@durable-systems/trace";
import { verifyTraceEnvelope, semanticDigest } from "@durable-systems/trace/core";
const pack: TracePack = {
  schema:"tracepack/v1", authority:"none",
  subject:{project:"consumer",kind:"source",id:"x"},
  compiler:{id:"smoke",version:"1"},sourceDigests:[semanticDigest({x:1})],
  nodes:[{id:"input",kind:"test",owner:"consumer",authority:"none",
    currentness:"historical",verification:"not-applicable",
    consequence:"not-established",replay:"input",causalParents:[]}],
  authorityEpochs:[],closure:{kind:"unresolved"},redactions:[] };
const envelope:TraceEnvelope=packTrace(pack);
verifyTraceEnvelope(envelope);
const plan:TraceReplayPlan=compileReplay(envelope);
if(plan.effectReplay!==false)throw Error("plan");
`;
const adapterJs = `
import { Effect } from "effect";
import { makeMemoryStateStore, makeRecord, makeStateMap, recordDigest, semanticDigest } from "@durable-systems/state";
import { readStateRuntimeTraceSnapshot, TRACEPACK_STATE_RUNTIME_SNAPSHOT_SCHEMA } from "@durable-systems/trace/state";
import { packTrace } from "@durable-systems/trace";
const project="external-consumer";
const store=await Effect.runPromise(makeMemoryStateStore(project));
const record=makeRecord(project,"observation:1","external.observation/v1",{value:1});
const map=makeStateMap({project,generation:0,parent:null,compiler:"external",
  sourceDigest:semanticDigest({fixture:1}),
  entries:{"observation:1":{kind:record.kind,record:recordDigest(record)}}});
await Effect.runPromise(store.commit({expected:null,records:[record],map}));
const snapshot=await readStateRuntimeTraceSnapshot(store,["observation:1"]);
if(snapshot.schema!==TRACEPACK_STATE_RUNTIME_SNAPSHOT_SCHEMA ||
   snapshot.records.length!==1 || snapshot.records[0].value.value!==1 ||
   typeof packTrace!=="function") throw Error("adapter");
await Effect.runPromise(store.close);
`;
const adapterTs = `
import { type StateRuntimeStore, makeMemoryStateStore, semanticDigest } from "@durable-systems/state";
import { readStateRuntimeTraceSnapshot, type StateRuntimeTraceSnapshot, type StateRuntimeTraceFact } from "@durable-systems/trace/state";
import { type TraceEnvelope, packTrace } from "@durable-systems/trace";
import { Effect } from "effect";
const state:Effect.Effect<StateRuntimeStore, unknown> = makeMemoryStateStore("external");
const selected:Promise<StateRuntimeTraceSnapshot> =
  readStateRuntimeTraceSnapshot({} as StateRuntimeStore, ["example"]);
const typedFact:StateRuntimeTraceFact = {id:"x",kind:"test",
  recordDigest: semanticDigest({source:"consumer"}),value:{ok:true}};
const envelopeFn:typeof packTrace=packTrace;
if(!selected || !state || !typedFact || !envelopeFn)throw Error("types");
`;
try {
  const filename = execute("npm", ["pack", "--ignore-scripts=false", "--silent", "--pack-destination", tmp], root)
    .split("\n").at(-1);
  if (filename !== "durable-systems-trace-0.1.0.tgz") throw Error("incorrect Trace tarball");
  const tarball = join(tmp, filename);
  const packed = assertArchive(tarball, "Trace");
  for (const entry of ["package/dist/src/state.js", "package/dist/src/state.d.ts",
    "package/dist/src/core.js", "package/dist/src/core.d.ts"]) {
    if (!packed.entries.includes(entry)) throw Error("Trace missing subpath " + entry);
  }
  if (packed.pkg.name !== name || packed.pkg.peerDependencies?.effect !== "3.22.2" ||
      packed.pkg.peerDependencies?.[stateName] !== "0.1.0" ||
      packed.pkg.peerDependenciesMeta?.[stateName]?.optional !== true) {
    throw Error("invalid Trace packaged peer identities");
  }

  const core = setupConsumer("core-only");
  execute("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact",
    tarball, "effect@3.22.2", "typescript@5.9.3", "@types/node@22.20.4"], core);
  checkInstalled(core, name);
  if (existsSync(join(core, "node_modules", "@durable-systems", "state"))) {
    throw Error("optional State unexpectedly installed in Trace-only consumer");
  }
  writeFileSync(join(core, "smoke.mjs"), coreJs);
  writeFileSync(join(core, "smoke.mts"), coreTs);
  execute(process.execPath, ["smoke.mjs"], core);
  typecheck(core);
  console.log("PASS: Trace core-only ESM and .d.ts resolution without optional State");

  const stateTar = join(root, "vendor", "durable-systems-state-0.1.0.tgz");
  const statePackage = assertArchive(stateTar, "State development tarball");
  if (statePackage.pkg.name !== stateName) throw Error("invalid vendored State identity");
  const combined = setupConsumer("state-adapter");
  execute("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact",
    stateTar, tarball, "effect@3.22.2", "typescript@5.9.3", "@types/node@22.20.4"], combined);
  checkInstalled(combined, stateName);
  checkInstalled(combined, name);
  execute("npm", ["ls", "--all", "--depth=0"], combined);
  writeFileSync(join(combined, "smoke.mjs"), adapterJs);
  writeFileSync(join(combined, "smoke.mts"), adapterTs);
  execute(process.execPath, ["smoke.mjs"], combined);
  typecheck(combined);
  console.log("PACK " + name + " entries=" + packed.entries.length + " sha256=" + sha(tarball));
  console.log("MANIFEST " + JSON.stringify(packed.entries));
  console.log("PASS: Trace + State tarball peer, optional adapter, ESM subpaths and TypeScript declarations");
  done = true;
} finally {
  if (done && process.env.KEEP_RELEASE_CONSUMER !== "1") rmSync(tmp, { recursive: true, force: true });
  else console.error("Retained inspection artifacts:", tmp);
}
