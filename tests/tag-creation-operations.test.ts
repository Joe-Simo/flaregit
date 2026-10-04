import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TagCreationOperations } from "../src/server/tag-creation-operations";
import type { TagCreationIdentity } from "../src/server/tag-git";
function storage(db: Database): DurableObjectStorage {
  return { sql: { exec(query: string, ...bindings: Array<string | number | null>) {
    if (query.includes("CREATE TABLE")) { db.exec(query); return { toArray: () => [] }; }
    const rows = db.query(query).all(...bindings); return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error("One row required"); return rows[0]; } };
  } }, transactionSync<T>(fn: () => T): T { return db.transaction(fn)(); } } as unknown as DurableObjectStorage;
}
const identity = (): TagCreationIdentity => ({ operationId: crypto.randomUUID(), projectId: "p123456789abc", incarnation: "11111111-1111-4111-8111-111111111111", canonicalRepoName: "owned-canonical", actorId: "owner-subject", accountKey: "private-account", tag: "v1.0.0", sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40), acceptedCommit: "a".repeat(40) });
const ownership={attemptId:crypto.randomUUID(),nativeId:crypto.randomUUID()};
const dispatch=(ledger:TagCreationOperations,value:TagCreationIdentity,validate:()=>void=()=>{})=>{ledger.claimNative(value,ownership,validate);return ledger.markDispatch(value,ownership,validate);};
const exact = (value: TagCreationIdentity) => ({ object: value.sourceCommit, commit: value.sourceCommit, tree: value.sourceTree, type: "commit" as const });

test("real SQLite reopen retains uncertain dispatch and exact replay confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flaregit-tag-ledger-")), path = join(directory, "state.sqlite");
  let db = new Database(path), ledger = new TagCreationOperations(storage(db));
  const value = identity();
  try {
    const prepared = ledger.prepare(value, () => {}, 1000);
    expect(ledger.prepare(value, () => {}, 2000)).toEqual(prepared);
    dispatch(ledger,value);
    db.close(); db = new Database(path); ledger = new TagCreationOperations(storage(db));
    expect(ledger.observe(value, null, () => {}).phase).toBe("unknown");
    expect(ledger.observe(value, exact(value), () => {}).phase).toBe("confirmed");
    expect(ledger.observe(value, exact(value), () => {}).phase).toBe("confirmed");
    expect(() => ledger.markDispatch(value,ownership,()=>{})).toThrow("terminal");
    const view = ledger.view(ledger.get(value.operationId)!);
    expect(view.cleanup).toBe("not_reported"); expect(JSON.stringify(view)).not.toContain(value.actorId); expect(JSON.stringify(view)).not.toContain(value.accountKey); expect(JSON.stringify(view)).not.toContain(value.incarnation); expect(JSON.stringify(view)).not.toContain(value.canonicalRepoName);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test("unique scoped names and stable operation IDs cannot be reassigned", () => {
  const db = new Database(":memory:"), ledger = new TagCreationOperations(storage(db)), value = identity();
  try {
    ledger.prepare(value, () => {});
    expect(() => ledger.prepare({ ...value, actorId: "another-owner" }, () => {})).toThrow("identity changed");
    expect(() => ledger.prepare({ ...value, operationId: crypto.randomUUID() }, () => {})).toThrow("Tag name already belongs");
    expect(ledger.prepare({ ...value, operationId: crypto.randomUUID(), incarnation: crypto.randomUUID() }, () => {}).phase).toBe("prepared");
    expect(ledger.prepare({ ...value, operationId: crypto.randomUUID(), projectId: "p987654321abc", canonicalRepoName: "other-canonical" }, () => {}).phase).toBe("prepared");
  } finally { db.close(); }
});

test("existing or annotated tag observations refuse even a matching peeled commit", () => {
  const db = new Database(":memory:"), ledger = new TagCreationOperations(storage(db));
  try {
    const existing = identity(); ledger.prepare(existing, () => {});
    expect(ledger.observe(existing, exact(existing), () => {})).toMatchObject({ phase: "refused", reason: "existing_ref" });
    const annotated = { ...identity(), tag: "v2.0.0" }; ledger.prepare(annotated, () => {}); dispatch(ledger,annotated);
    const observation = { ...exact(annotated), object: "c".repeat(40), type: "tag" as const };
    expect(ledger.observe(annotated, observation, () => {})).toMatchObject({ phase: "refused", reason: "different_ref" });
    expect(() => ledger.observe(annotated, exact(annotated), () => {})).toThrow("Terminal tag observation changed");
  } finally { db.close(); }
});

test("authority fences roll back intents and observations; unknown operations cannot be abandoned", () => {
  const db = new Database(":memory:"), ledger = new TagCreationOperations(storage(db)), value = identity();
  try {
    expect(() => ledger.prepare(value, () => { throw new Error("Owner revoked"); })).toThrow("Owner revoked"); expect(ledger.get(value.operationId)).toBeNull();
    ledger.prepare(value, () => {});
    expect(() => dispatch(ledger,value, () => { throw new Error("Incarnation changed"); })).toThrow("Incarnation changed"); expect(ledger.get(value.operationId)?.phase).toBe("prepared");
    dispatch(ledger,value);
    expect(() => ledger.observe(value, exact(value), () => { throw new Error("Accepted root changed"); })).toThrow("Accepted root changed"); expect(ledger.get(value.operationId)?.phase).toBe("unknown");
    expect(() => ledger.abandon(value, () => {})).toThrow("undispatched");
    const abandon = { ...identity(), tag: "v3.0.0" }; ledger.prepare(abandon, () => {});
    expect(ledger.abandon(abandon, () => {})).toMatchObject({ phase: "refused", reason: "owner_abandoned_prepared" }); expect(ledger.abandon(abandon, () => {}).phase).toBe("refused");
  } finally { db.close(); }
});

test('native ownership grants only one dispatch and exact late positive closure cannot affect another intent',()=>{const db=new Database(':memory:'),ledger=new TagCreationOperations(storage(db)),value=identity(),owner={attemptId:crypto.randomUUID(),nativeId:crypto.randomUUID()};try{ledger.prepare(value,()=>{});expect(ledger.claimNative(value,owner,()=>{})).toBe(true);expect(ledger.claimNative(value,owner,()=>{})).toBe(false);expect(()=>ledger.markDispatch(value,{...owner,nativeId:crypto.randomUUID()},()=>{})).toThrow('ownership');expect(ledger.markDispatch(value,owner,()=>{})).toBe(true);expect(ledger.markDispatch(value,owner,()=>{})).toBe(false);expect(()=>ledger.confirmNativeStopped({...value,incarnation:crypto.randomUUID()},owner,{name:`tag-${owner.nativeId}`,sealed:true,stopped:true})).toThrow('identity');ledger.confirmNativeStopped(value,owner,{name:`tag-${owner.nativeId}`,sealed:true,stopped:true});expect(ledger.get(value.operationId)?.native?.stopped).toBe(true);expect(ledger.markDispatch(value,owner,()=>{})).toBe(false);}finally{db.close();}});
