import worker from "../../src/server/worker";
import { RepositoryController } from "../../src/server/durable-object";
import { PrivateRecoveryOperations } from "../../src/server/private-recovery";
import { PublicationModeration } from "../../src/server/publication-moderation";
import { accountKeyFor } from "../../src/server/projects";
import type { Env } from "../../src/server/env";
export class SharingHttpFixture extends RepositoryController {
 async seed() {
  const commit="a".repeat(40),tree="b".repeat(40),projectId="p123456789abc";
  this.ctx.storage.sql.exec("INSERT INTO project VALUES(1,?)",JSON.stringify({projectId,projectName:"Synthetic sharing fixture",canonicalRepoName:"synthetic",acceptedBaseline:{commit,tree,acceptedAt:"2026-10-03"},acceptedState:{currentCommit:commit,history:[]},journal:[],tasks:{},verificationPolicy:{}}));
  await this.addMember("owner","owner"); await this.addMember("member","member");
  this.ctx.storage.sql.exec("CREATE TABLE repository_visibility(id INTEGER PRIMARY KEY,visibility TEXT,version INTEGER,confirmed_by TEXT)");
  this.ctx.storage.sql.exec("INSERT INTO repository_visibility VALUES(1,'public',1,'owner')");
  const ops=new PrivateRecoveryOperations(this.ctx.storage),id=crypto.randomUUID(),incarnation=ops.incarnation();
  ops.create({id,projectId,incarnation,commit,tree,journalId:"baseline",ownerId:"owner",accountKey:await accountKeyFor("owner"),canonicalRepoName:"synthetic",status:"pending",uploadState:"not-started",createdAt:"2026-10-03"});
  ops.beginUpload(id);ops.saveUpload(id,"synthetic-upload");ops.closeUpload(id,"synthetic-upload");ops.complete(id,{projectId,incarnation,commit,tree,journalId:"baseline",size:3,sha256:"c".repeat(64),objectCount:3,objectScope:"exact-accepted-reachable-closure",createdAt:"2026-10-03"});
 }
 mutate(mode:string){
  if(mode==="demote")this.ctx.storage.sql.exec("UPDATE members SET role='member' WHERE user_id='owner'");
  if(mode==="version")this.ctx.storage.sql.exec("UPDATE repository_visibility SET version=version+1");
  if(mode==="head"){const row=this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM project WHERE id=1").one();const state=JSON.parse(row.doc);state.acceptedState.currentCommit="d".repeat(40);this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));}
  if(mode==="suppress")new PublicationModeration(this.ctx.storage).moderate("repository","p123456789abc",{action:"suppress",confirmed:true,reason:"Synthetic fixture",reportId:"fixture",expectedVersion:0,idempotencyKey:crypto.randomUUID()},"operator",()=>{});
 }
}
interface FixtureEnv{TEST:DurableObjectNamespace<SharingHttpFixture>;FIXTURE_ISSUER:string}
export default {async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){
 const url=new URL(request.url),repo=env.TEST.getByName("project:p123456789abc");
 if(url.pathname==="/fixture/bootstrap"){await repo.seed();const key=await accountKeyFor("owner"),token=`fgt_${key}_${"x".repeat(32)}`;await env.TEST.getByName(`account:${key}`).createApiToken("owner","Synthetic fixture",token,{scope:"full"});return Response.json({token});}
 if(url.pathname==="/fixture/mutate"){await repo.mutate(url.searchParams.get("mode")!);return new Response("ok");}
 const deny=()=>{throw new Error("Synthetic decision fixture must not execute provider writes");};
 return worker.fetch(request,{REPOSITORY_CONTROLLER:env.TEST,API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example",INTEGRATOR:{getByName:deny},ARTIFACTS:{get:deny},EVIDENCE_BUCKET:{put:deny,createMultipartUpload:deny}} as unknown as Env,ctx);
}};
