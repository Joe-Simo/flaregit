import { downloadPrivateRecovery } from "../../src/server/private-recovery-download";
import { recoveryBundleKey, recoveryScopeId } from "../../src/server/private-recovery";
import { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { RepositoryController } from "../../src/server/durable-object";
import { FlareGitPrivateRecoveryWorkflow, type PrivateRecoveryParams } from "../../src/server/private-recovery-workflow";
import { accountKeyFor } from "../../src/server/projects";
import type { Env } from "../../src/server/env";
import type { FlareGitProjectState } from "../../src/core/types";
const defaultProjectId = "p123456789abc", commit = "a".repeat(40), tree = "b".repeat(40);
/** Synthetic Git command output tests orchestration only; native closure tests exercise real Git. */
export class RecoveryLedgerFixture extends RepositoryController {
 seed(projectId:string) { const state = { projectId, projectName:"Recovery fixture",canonicalRepoName:"fixture-repo",acceptedBaseline:{commit,tree,acceptedAt:new Date().toISOString()},acceptedState:{currentCommit:commit,history:[],activeRequirements:[]},journal:[],tasks:{},candidates:{},policyVersion:1,verificationPolicy:{},decisions:{},evidence:{} } as unknown as FlareGitProjectState; this.ctx.storage.sql.exec("INSERT INTO project(id,doc) VALUES(1,?)",JSON.stringify(state)); }
 fixtureRotate() {this.ctx.storage.sql.exec("DELETE FROM private_recovery_operations");this.ctx.storage.sql.exec("DELETE FROM private_recovery_incarnation");}
 async fixtureConfigure(failExec:boolean,failStop:boolean) { await this.ctx.storage.put({failExec,failStop}); }
 async fixtureCount(kind:string,value="") { const rows=await this.ctx.storage.get<Array<{kind:string;value:string}>>("calls")??[]; rows.push({kind,value});await this.ctx.storage.put("calls",rows); }
 async fixtureFlags() { return {failExec:await this.ctx.storage.get<boolean>("failExec"),failStop:await this.ctx.storage.get<boolean>("failStop")}; }
 fixtureSlots() {this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS private_recovery_slots(id TEXT PRIMARY KEY,account_key TEXT NOT NULL,created_at TEXT NOT NULL)");return this.ctx.storage.sql.exec("SELECT id,account_key FROM private_recovery_slots ORDER BY id").toArray();}
 async fixtureCalls() {return await this.ctx.storage.get("calls")??[];}
}
const global = (env:Env)=>env.REPOSITORY_CONTROLLER.getByName("global") as unknown as RecoveryLedgerFixture;
class SandboxFixture extends RpcTarget {
 constructor(private env:Env,private name:string){super();}
 async exec(args:string[]){ const ledger=global(this.env);await ledger.fixtureCount("exec",this.name);if((await ledger.fixtureFlags()).failExec)return{success:false,stdout:"",stderr:"synthetic Git failure"};let stdout="";if(args.includes("--is-shallow-repository"))stdout="false";else if(args.includes("cat-file")&&args.includes("-t"))stdout="commit";else if(args.includes("rev-parse"))stdout=tree;else if(args.includes("list-heads"))stdout=`${commit} refs/heads/main\n${commit} HEAD`;else if(args[0]==="stat"||args[0]==="sh")stdout="3";else if(args[0]==="sha256sum")stdout="039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";return{success:true,stdout,stderr:""}; }
 async readFileChunk(){return new Uint8Array([1,2,3]);}
 async destroy(){await global(this.env).fixtureCount("destroy",this.name);if((await global(this.env).fixtureFlags()).failStop)throw new Error("synthetic stop unavailable");}
 async lifetimeStatus(){return{state:(await global(this.env).fixtureFlags()).failStop?"running":"stopped"};}
}
export class RecoveryIntegratorFixture extends WorkerEntrypoint<Env>{
 async exec(name:string,args:string[]){return new SandboxFixture(this.env,name).exec(args);}
 async readFileChunk(){return new Uint8Array([1,2,3]);}
 async destroy(name:string){return new SandboxFixture(this.env,name).destroy();}
 async lifetimeStatus(name:string){return new SandboxFixture(this.env,name).lifetimeStatus();}
}
export class RecoveryWorkflowFixture extends FlareGitPrivateRecoveryWorkflow {
 constructor(ctx:ExecutionContext,env:Env){
 const service=env.INTEGRATOR as unknown as {exec(name:string,args:string[]):Promise<{success:boolean;stdout:string;stderr:string}>;readFileChunk():Promise<Uint8Array>;destroy(name:string):Promise<void>;lifetimeStatus(name:string):Promise<{state:string}>};
 super(ctx,{...env,EVIDENCE_BUCKET:{get:(key:string)=>env.EVIDENCE_BUCKET.get(key),head:(key:string)=>env.EVIDENCE_BUCKET.head(key),put:(key:string,body:string,options:R2PutOptions)=>env.EVIDENCE_BUCKET.put(key,body,options),resumeMultipartUpload:(key:string,id:string)=>env.EVIDENCE_BUCKET.resumeMultipartUpload(key,id),createMultipartUpload:async(key:string,options:R2MultipartOptions)=>{await global(env).fixtureCount("multipart",key);return env.EVIDENCE_BUCKET.createMultipartUpload(key,options);}},INTEGRATOR:{getByName:(name:string)=>({exec:(args:string[])=>service.exec(name,args),readFileChunk:()=>service.readFileChunk(),destroy:()=>service.destroy(name),lifetimeStatus:()=>service.lifetimeStatus(name)})},ARTIFACTS:{get:async()=>{await global(env).fixtureCount("artifacts");return{info:async()=>({remote:`https://${"a".repeat(32)}.artifacts.cloudflare.net/fixture.git`}),createToken:async()=>({plaintext:"synthetic-fixture-token"}),[Symbol.dispose](){}};}}} as unknown as Env);}
}
export default {async fetch(request:Request,env:Env&{RECOVERY:Workflow<PrivateRecoveryParams>}){
 const url=new URL(request.url),id=url.searchParams.get("id")!,projectId=url.searchParams.get("project")??defaultProjectId;const ledger=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as RecoveryLedgerFixture;const accountKey=await accountKeyFor("owner");
 try{
 if(url.pathname==="/seed"){await ledger.seed(projectId);await ledger.addMember("owner","owner","Owner");await ledger.addMember("reader","member","Reader");return new Response("ok");}
 if(url.pathname==="/prepare")return Response.json(await ledger.privateRecoveryPrepare(id,commit,url.searchParams.get("wrong")?"d".repeat(40):tree,url.searchParams.get("member")?"member":"owner",accountKey));
 if(url.pathname==="/flags"){await global(env).fixtureConfigure(url.searchParams.get("exec")==="fail",url.searchParams.get("stop")==="fail");return new Response("ok");}
 if(url.pathname==="/start"){const op=await ledger.privateRecoveryOperation(id);if(!op)throw new Error("Missing operation");await env.RECOVERY.create({id:recoveryScopeId(op),params:{projectId,operationId:id}});return new Response("ok");}
 if(url.pathname==="/restart"){if((await ledger.privateRecoveryOperation(id))?.status!=="ready")await ledger.privateRecoveryMarkDispatch(id,"uncertain",recoveryScopeId((await ledger.privateRecoveryOperation(id))!));const op=await ledger.privateRecoveryOperation(id);if(!op)throw new Error("Missing operation");await(await env.RECOVERY.get(url.searchParams.get("scope")??recoveryScopeId(op))).restart();return new Response("ok");}
 if(url.pathname==="/status"){const op=await ledger.privateRecoveryOperation(id);if(!op)throw new Error("Missing operation");return Response.json(await(await env.RECOVERY.get(url.searchParams.get("scope")??recoveryScopeId(op))).status());}
 if(url.pathname==="/rotate"){await ledger.fixtureRotate();return new Response("ok");}
 if(url.pathname==="/demote-owner"){await ledger.addMember("owner","member");return new Response("ok");}
 if(url.pathname==="/reserve-current"){const op=await ledger.privateRecoveryOperation(id);if(!op)throw new Error("Missing operation");await global(env).reservePrivateRecoveryStorage(recoveryScopeId(op),accountKey);return new Response("ok");}
 if(url.pathname==="/drop-receipt"||url.pathname==="/corrupt-object"){const op=await ledger.privateRecoveryOperation(id);if(!op)throw new Error("Missing operation");const key=recoveryBundleKey(op);await env.EVIDENCE_BUCKET.delete(`${key}.json`);if(url.pathname==="/corrupt-object"){const object=await env.EVIDENCE_BUCKET.get(key);if(!object)throw new Error("Missing bundle");await env.EVIDENCE_BUCKET.put(key,await object.arrayBuffer(),{customMetadata:{...object.customMetadata,tree:"d".repeat(40)}});}return new Response("ok");}
 if(url.pathname==="/receipt-document"){const op=await ledger.privateRecoveryOperation(id);if(!op)throw new Error("Missing operation");const receipt=await env.EVIDENCE_BUCKET.get(`${recoveryBundleKey(op)}.json`);return receipt?new Response(await receipt.text(),{headers:{"Content-Type":"application/json"}}):new Response("missing",{status:404});}
 if(url.pathname==="/download"){
 const actor=url.searchParams.get("actor")??"owner";let authorizationChecks=0;const operation=await ledger.privateRecoveryOperation(id);if(!operation?.receipt)return new Response("missing",{status:404});
 return downloadPrivateRecovery(request,{snapshot:operation.receipt,receipt:operation.receipt,objectKey:recoveryBundleKey(operation),authorize:async()=>{if(url.searchParams.has("revoke")&&++authorizationChecks===3)await ledger.removeMember(actor);return await ledger.canGitAccess(actor,null,false)&&await ledger.privateRecoveryReadable(id)&&await (env.REPOSITORY_CONTROLLER.getByName(`account:${accountKey}`) as unknown as RecoveryLedgerFixture).accountLifecycle()==="active";},getObject:key=>env.EVIDENCE_BUCKET.get(key)});
 }
 if(url.pathname==="/snapshot"){const op=await ledger.privateRecoveryOperation(id);if(!op)throw new Error("Missing operation");return Response.json({slots:await global(env).fixtureSlots(),scope:recoveryScopeId(op),calls:await global(env).fixtureCalls(),spent:await global(env).managedSpendReserved(new Date().toISOString().slice(0,7),accountKey),operation:await ledger.privateRecoveryOperation(id),native:await global(env).nativeComputeStatus(`recovery-${recoveryScopeId(op)}`)});}
 if(url.pathname==="/exhaust"){await global(env).reserveManagedSpend({runId:"exhaustion",accountKey,usdMicros:1000000-await global(env).managedSpendReserved(new Date().toISOString().slice(0,7),accountKey),maxInputBytes:1,maxOutputTokens:1,maxCalls:1,maxContainerSeconds:1},{accountUsdMicros:1000000,globalUsdMicros:1000000});return new Response("ok");}
 return new Response("missing",{status:404});
 }catch(error){return new Response(String(error),{status:500});}
}};
