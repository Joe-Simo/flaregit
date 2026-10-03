import worker from "../../src/server/worker";
import {RepositoryController} from "../../src/server/durable-object";
import {PrivateRecoveryOperations} from "../../src/server/private-recovery";
import {PreviewStorageWriters} from "../../src/server/preview-storage-writers";
import {accountKeyFor} from "../../src/server/projects";
import type {Env} from "../../src/server/env";
const projectId="p123456789abc";
const providerWrites:string[]=[];
export class ReconciliationFixture extends RepositoryController {
 async seed(){
  await this.initialize({projectId,projectName:"Reconciliation fixture",canonicalRepoName:"synthetic",head:"a".repeat(40),tree:"b".repeat(40),verificationPolicy:{},ownerId:"owner"});
  await this.addMember("member","member");
  const incarnation=new PrivateRecoveryOperations(this.ctx.storage).incarnation(),key=`builds/${projectId}/${"a".repeat(40)}`;
  return {incarnation,key:`${key}/index.html`};
 }
 async seedGlobal(incarnation:string){
  const key=`builds/${projectId}/${"a".repeat(40)}`;
  new PreviewStorageWriters(this.ctx.storage);
  this.ctx.storage.sql.exec("INSERT INTO preview_copy_plans VALUES(?,?,?,?)",key,projectId,incarnation,JSON.stringify({physicalKey:key,identity:{projectId,incarnation,commit:"a".repeat(40),accountKey:await accountKeyFor("owner")},keys:[`${key}/index.html`,...Array.from({length:39},(_,index)=>`${key}/${index}.html`)],bytes:12,kind:"preview"}));
  this.ctx.storage.sql.exec("INSERT INTO preview_copy_writers VALUES(?,?,0,?)",key,crypto.randomUUID(),JSON.stringify([`${key}/index.html`]));
  for(let index=1;index<=8;index++){const extra=`builds/${projectId}/${index.toString(16).padStart(40,"0")}`;this.ctx.storage.sql.exec("INSERT INTO preview_copy_plans VALUES(?,?,?,?)",extra,projectId,incarnation,JSON.stringify({physicalKey:extra,identity:{projectId,incarnation,commit:index.toString(16).padStart(40,"0"),accountKey:await accountKeyFor("owner")},keys:[`${extra}/index.html`],bytes:0,kind:"preview"}));}
  return {incarnation,key:`${key}/index.html`};
 }
 snapshot(){const result:Record<string,unknown>={};for(const row of this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").toArray())result[row.name]=this.ctx.storage.sql.exec(`SELECT * FROM "${row.name.replaceAll('"','""')}" ORDER BY rowid`).toArray();return result;}
 mutate(mode:string){if(mode==="demote")this.ctx.storage.sql.exec("UPDATE members SET role='member' WHERE user_id='owner'");if(mode==="restore")this.ctx.storage.sql.exec("UPDATE members SET role='owner' WHERE user_id='owner'");if(mode==="legacy")this.ctx.storage.sql.exec("DELETE FROM private_recovery_incarnation");}
}
interface FixtureEnv{TEST:DurableObjectNamespace<ReconciliationFixture>;BUCKET:R2Bucket;FIXTURE_ISSUER:string}
export default {async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){
 const url=new URL(request.url),repo=env.TEST.getByName(`project:${projectId}`),control=env.TEST.getByName("fixture-control");
 if(url.pathname==="/fixture/provider-writes")return Response.json(providerWrites);
 if(url.pathname==="/fixture/bootstrap"){const seeded=await repo.seed();await env.TEST.getByName("global").seedGlobal(seeded.incarnation);await env.BUCKET.put(seeded.key,"private-body",{customMetadata:{actor:"secret-metadata"}});const key=await accountKeyFor("owner"),token=`fgt_${key}_${"x".repeat(32)}`;await env.TEST.getByName(`account:${key}`).createApiToken("owner","fixture",token,{scope:"full"});return Response.json({...seeded,token,keyAccount:key});}
 if(url.pathname==="/fixture/snapshot")return Response.json({repo:await repo.snapshot(),global:await env.TEST.getByName("global").snapshot(),account:await env.TEST.getByName(`account:${await accountKeyFor("owner")}`).snapshot()});
 if(url.pathname==="/fixture/mutate"){const mode=url.searchParams.get("mode")!;if(mode==="repo-delete")await repo.beginRepositoryDeletion();else if(mode==="account-delete")await env.TEST.getByName(`account:${await accountKeyFor("owner")}`).beginAccountDeletion();else await repo.mutate(mode);return new Response("ok");}
 if(url.pathname==="/fixture/race"){await control.setProfile({handle:url.searchParams.get("mode")!,displayName:"",bio:"",joinedAt:""});return new Response("ok");}
 const deny=()=>{providerWrites.push("write-or-vm");throw new Error("Reconciliation attempted provider write or VM access");};
 const race=async(mode:string)=>{if((await control.getProfile()).handle===mode)await repo.mutate("demote");};
 const bucket={head:async(key:string)=>{const value=await env.BUCKET.head(key);await race("head");return value;},list:async(options:R2ListOptions)=>{const value=await env.BUCKET.list(options);await race("list");return value;},get:deny,put:deny,delete:deny,createMultipartUpload:deny};
 return worker.fetch(request,{REPOSITORY_CONTROLLER:env.TEST,EVIDENCE_BUCKET:bucket,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example",INTEGRATOR:{getByName:deny},ARTIFACTS:{get:deny,delete:deny}} as unknown as Env,ctx);
}};
