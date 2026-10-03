import { DurableObject } from "cloudflare:workers";
import { RepositoryController } from "../../src/server/durable-object";
import worker from "../../src/server/worker";
import type { Env } from "../../src/server/env";
export class PublicProfileFixture extends DurableObject {
  override async fetch(request: Request) {
    const url=new URL(request.url);
    if(url.pathname==="/mode"){await this.ctx.storage.put("mode",url.searchParams.get("value"));return Response.json({ok:true});}
    const mode=await this.ctx.storage.get("mode")??"private";let reads=0;let contributionReads=0;
    const env={
      API_LIMITER:{limit:async()=>({success:true})},
      REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:(name:string)=>name==="global"?{accountForHandle:async()=>"account"}:name.startsWith("account:")?{
        publicProfileState:async()=>{reads++;return {profile:{handle:"contributor",displayName:"Contributor",bio:"Public bio",joinedAt:"2026-10-02"},visibility:mode==="private"||(mode==="revoke"&&reads>1)?"private":"public",version:1,ownerId:"private-user-id"};},
        listProjects:async()=>[{id:"abcdef123456"},{id:"abcdef123457"}],
      }:{publicGrant:async()=>name==="project:abcdef123456"?{name:"Public repo",version:1,acceptedCommit:"a".repeat(40)}:null,publicContributionsFor:async(userId:string)=>{contributionReads++;return !(mode==="membership-revoke"&&contributionReads>1)&&name==="project:abcdef123456"&&userId==="private-user-id"?{grant:{name:"Public repo",version:1,acceptedCommit:"a".repeat(40)},contributions:[{commit:"a".repeat(40),acceptedAt:"2026-10-02"}]}:null;}}},
    } as unknown as Env;
    return worker.fetch(request,env,this.ctx as unknown as ExecutionContext);
  }
}
export class ContributionFixture extends RepositoryController {
  async seedAttribution() {
    const userId = "current-123456789012";
    const formerId = "former-123456789012";
    const tasks = Object.fromEntries(["current", "former", "agent", "untracked"].map(id => [id, { id, goal: "PRIVATE GOAL", contributor: { id: "123456789012", type: id === "agent" ? "agent" : "human" } }]));
    const history = ["current", "former", "agent", "untracked"].map((id, i) => ({ commit: String(i + 1).repeat(40), acceptedAt: "2026-10-02", participatingTasks: [id] }));
    this.ctx.storage.sql.exec("INSERT INTO project (id,doc) VALUES (1,?)", JSON.stringify({ projectName: "Public repo", canonicalRepoName: "repo", tasks, acceptedState: { currentCommit: "1".repeat(40), history } }));
    this.ctx.storage.sql.exec("INSERT INTO members(user_id,role,added_at) VALUES (?,'member','now')", userId);
    this.ctx.storage.sql.exec("CREATE TABLE repository_visibility(id INTEGER PRIMARY KEY, visibility TEXT, version INTEGER, confirmed_by TEXT)");
    this.ctx.storage.sql.exec("INSERT INTO repository_visibility VALUES (1,'public',1,'owner')");
    this.ctx.storage.sql.exec("CREATE TABLE git_task_writers(task_id TEXT PRIMARY KEY,user_id TEXT NOT NULL)");
    for (const [taskId, actorId] of [["current", userId], ["former", formerId], ["agent", userId]]) this.ctx.storage.sql.exec("INSERT INTO git_task_writers VALUES (?,?)", taskId!, actorId!);
  }
  hide() { this.ctx.storage.sql.exec("UPDATE repository_visibility SET visibility='private'"); }
}
export default { async fetch(request: Request, env: { TEST: DurableObjectNamespace<PublicProfileFixture>; CONTRIBUTIONS: DurableObjectNamespace<ContributionFixture> }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/attribution")) {
    const stub = env.CONTRIBUTIONS.getByName("one");
    if (url.pathname === "/attribution/seed") { await stub.seedAttribution(); return Response.json({ ok: true }); }
    if (url.pathname === "/attribution/hide") { await stub.hide(); return Response.json({ ok: true }); }
    return Response.json(await stub.publicContributionsFor(url.searchParams.get("user") ?? "current-123456789012"));
  }
  return env.TEST.getByName("one").fetch(request);
} };
