import { expect, test } from "bun:test";
import { projectPublicCommunityActivity } from "../src/server/public-community-activity";
import type { DiscussionTopic } from "../src/server/repository-discussions";
import { RepositoryDiscussions } from "../src/server/repository-discussions";
import { Database } from "bun:sqlite";

const id = "p123456abcdef";
const row = { projectId: id, enabled: true, version: 1 };
const topic: DiscussionTopic = { id: `discussion_${crypto.randomUUID()}`, topicId: "unused", category: "general", title: "Build together", body: "An explicitly public conversation", author: "Contributor", version: 1, createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z", removed: false, locked: false, resolved: false, replyCount: 2 };
function repository() {
  return {
    directoryState: async () => ({ enabled: true, version: 1, delivery: "delivered" as const }),
    publicGrant: async () => ({ name: "Project", version: 1, acceptedCommit: "a".repeat(40), canonicalRepoName: "hidden namespace" }),
    publicDiscussionActivity: async () => [{ ...topic, authorId: "hidden subject", moderationReason: "hidden moderation field" }],
    async publicDiscussionActivitySnapshot() { return {directory:await this.directoryState(),grant:await this.publicGrant(),topics:await this.publicDiscussionActivity()}; },
  };
}
test("activity projects explicitly public discussions without internal attribution", async () => {
  const result = await projectPublicCommunityActivity({ rows: [row], query: "build", repository });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]!.discussion.replyCount).toBe(2);
  expect(result.incomplete).toBe(false);
  expect(JSON.stringify(result)).not.toContain("hidden");
  expect(JSON.stringify(result)).not.toContain("topicId");
});
test("scope withdrawal before the final combined snapshot omits previously observed topics",async()=>{
  const repo=repository();let scope=true;
  repo.publicDiscussionActivity=async()=>{scope=false;return [{...topic,authorId:"hidden subject",moderationReason:"hidden moderation field"}];};
  repo.publicDiscussionActivitySnapshot=async()=>({directory:{enabled:true,version:1,delivery:"delivered"},grant:{name:"Project",version:1,acceptedCommit:"a".repeat(40),canonicalRepoName:"hidden namespace"},topics:scope?[{...topic,authorId:"hidden subject",moderationReason:"hidden moderation field"}]:[]});
  const result=await projectPublicCommunityActivity({rows:[row],query:"",repository:()=>repo});
  expect(result.items).toEqual([]);expect(result.incomplete).toBe(true);
});
test("withdrawn grant, withdrawn listing, edited and removed topics fail closed", async () => {
  for (const change of ["grant", "listing", "edit", "remove"] as const) {
    const repo = repository(); let reads = 0;
    if (change === "grant") repo.publicGrant = async () => ({ name: "Project", version: ++reads, acceptedCommit: "a".repeat(40), canonicalRepoName: "hidden namespace" });
    if (change === "listing") repo.directoryState = async () => ({ enabled: ++reads === 1, version: 1, delivery: "delivered" });
    if (change === "edit" || change === "remove") repo.publicDiscussionActivity = async () => [{ ...topic, authorId: "hidden subject", moderationReason: "hidden moderation field", version: ++reads, removed: change === "remove" && reads > 1 }];
    const result = await projectPublicCommunityActivity({ rows: [row], query: "", repository: () => repo });
    expect(result.items).toEqual([]); expect(result.incomplete).toBe(true);
  }
});
test("bounded page performs no provider Git/model calls and preserves partial failure", async () => {
  let selected = 0;
  const result = await projectPublicCommunityActivity({ rows: Array.from({ length: 25 }, (_, index) => ({ ...row, projectId: `p${index.toString(16).padStart(12, "0")}` })), query: "", repository: () => { selected++; const repo = repository(); if (selected === 1) repo.publicGrant = async () => { throw new Error("Unavailable"); }; repo.publicDiscussionActivity = async () => Array.from({ length: 8 }, (_, index) => ({ ...topic, id: `discussion_${index}` , authorId: "hidden subject", moderationReason: "hidden moderation field" })); return repo; } });
  expect(result.checked).toBe(20); expect(result.items).toHaveLength(57); expect(result.incomplete).toBe(true);
  expect(selected).toBe(39);
});
test("SQLite activity RPC returns three excerpts and exact-ID reread excludes removal", () => {
  const db = new Database(":memory:");
  const storage = {sql:{exec(query:string,...bindings:Array<string|number|null>){if(query.startsWith("CREATE TABLE")){db.exec(query);return {toArray:()=>[]};} const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};
  const ledger = new RepositoryDiscussions(storage as unknown as DurableObjectStorage);
  const actor = {userId:"private-subject",accountKey:"private-account",displayName:"Ada"};
  for (let index=0;index<10;index++) ledger.create(actor,{category:"general",title:`Topic ${index}`,body:"x".repeat(7900)+" searchable",confirmed:true,idempotencyKey:`request-${index}`});
  const slice = ledger.activity("searchable");
  expect(slice).toHaveLength(3); expect(slice.every(value=>value.body.length===500)).toBe(true);
  expect(JSON.stringify(slice).length).toBeLessThan(4000);
  const selected = slice.map(value=>value.id);
  ledger.remove(actor,selected[0]!,{expectedVersion:1},false);
  expect(ledger.activity("",selected)).toHaveLength(2);
  expect(()=>ledger.activity("",Array(4).fill(selected[1]))).toThrow();
  db.close();
});
