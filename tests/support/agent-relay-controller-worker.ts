import {RepositoryController} from "../../src/server/durable-object";
import type {AgentEgressWorkerProps} from "../../src/server/agent-egress-worker";
import {PrivateRecoveryOperations} from "../../src/server/private-recovery";
import type {Env} from "../../src/server/env";
const remote=`https://${"a".repeat(32)}.artifacts.cloudflare.net/git/namespace/workspace.git`;
export class AgentRelayControllerFixture extends RepositoryController{
 private branchHead:string|null=null;private minted=0;private revoked=0;private props:AgentEgressWorkerProps|undefined;private issuanceFault=false;private withdrawOnIssue=false;private eventId=crypto.randomUUID();private allocationId=crypto.randomUUID();
 override async reserveCoreGitOperation(){return{allowed:true,existing:false,basis:"conservative_operation_envelope"} as const;}
 protected override async agentRelayRepository(name:string){
  if(name!=="workspace")throw new Error("Foreign repository refused");
  return{info:async()=>({id:"provider-workspace",name,description:`FlareGit creation ${this.eventId}/${this.allocationId}`,defaultBranch:"main",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),lastPushAt:null,source:"artifacts:namespace/canonical",readOnly:false,remote}),readCommit:async(hash:string)=>({hash,treeHash:"b".repeat(40),message:"Checkpoint fixture",author:{name:"Owner",email:"owner@example.test"},committer:{name:"Owner",email:"owner@example.test"},parents:[],authoredAt:Math.floor(Date.now()/1000),committedAt:Math.floor(Date.now()/1000)}),log:async()=>this.branchHead===null?[]:[{hash:this.branchHead,treeHash:"b".repeat(40),message:"Actual lookup fixture",author:{name:"Owner",email:"owner@example.test"},committer:{name:"Owner",email:"owner@example.test"},parents:[],authoredAt:Math.floor(Date.now()/1000),committedAt:Math.floor(Date.now()/1000)}],createToken:async(scope:"read"|"write"="write",ttl=300)=>{this.minted++;if(this.issuanceFault)throw new Error("Opaque issuance outcome");if(this.withdrawOnIssue)this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id='owner'");return{id:`token-${this.minted}`,plaintext:"synthetic-server-only-token",scope,expiresAt:new Date(Date.now()+ttl*1000).toISOString()};},revokeToken:async(token:string)=>{if(token!=="synthetic-server-only-token")throw new Error("Foreign credential refused");this.revoked++;return true;},[Symbol.dispose]:()=>{}};
 }
 override async fetch(request:Request){const url=new URL(request.url);try{
  if(url.pathname==="/seed"){
   await this.initialize({projectId:"p123456789abc",projectName:"Synthetic relay fixture",canonicalRepoName:"canonical",head:"a".repeat(40),verificationPolicy:{kind:"git-integrity"},ownerId:"owner"});
   const state=await this.getState(),incarnation=new PrivateRecoveryOperations(this.ctx.storage).incarnation();if(!incarnation)throw new Error("Incarnation missing");
   state.tasks.task={id:"task",goal:"Improve source",contributor:{id:"owner",name:"Owner",type:"human"},baseCommit:"a".repeat(40),currentCommit:"a".repeat(40),workspace:{repoName:"workspace",branch:"task/task",remote},allowedScope:["src/"],status:"working",requirements:[],checkpoints:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),agentWorkflowInstanceId:"run"};
   this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));
   this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS task_creation_intents(event_id TEXT PRIMARY KEY,task_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,doc TEXT NOT NULL)");
   const creation={eventId:this.eventId,allocationId:this.allocationId,phase:"committed",providerRepoId:"provider-workspace",workspaceRepoName:"workspace",projectId:state.projectId,incarnation,selection:{sourceRepoName:"canonical"},actor:{userId:"owner",displayName:"Owner",viaToken:false}};this.ctx.storage.sql.exec("INSERT INTO task_creation_intents VALUES(?,?,?,?)",this.eventId,"task",JSON.stringify(creation),JSON.stringify(creation));
   this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS git_task_writers(task_id TEXT PRIMARY KEY,user_id TEXT NOT NULL)");this.ctx.storage.sql.exec("INSERT INTO git_task_writers VALUES(?,?)","task","owner");
   await this.registerWorkflow("run","agent",undefined,"owner");const attempt=await this.beginAgentNativeAttempt({workflowId:"run",runId:"run",taskId:"task",phase:"apply",attemptId:crypto.randomUUID(),nativeId:crypto.randomUUID()});
   this.props={attemptId:attempt.attemptId,nativeId:attempt.nativeId,scope:{projectId:state.projectId,incarnation,actorId:"owner",accountKey:attempt.accountKey,taskId:"task",runId:"run",workflowId:"run",branchGeneration:0,canonicalRepoName:"canonical",forkRepoName:"workspace",remote,branch:"task/task",expectedTip:"a".repeat(40),access:"read"}};
   return Response.json(await this.agentRelayCurrent(this.props));
  }
  if(!this.props)throw new Error("Fixture not initialized");
  if(url.pathname==="/bad-read")return Response.json(await this.agentRelayCurrent({...this.props,scope:{...this.props.scope,expectedTip:"f".repeat(40)}}));
  if(url.pathname==="/claim"){await this.claimAgentRun({runId:"run",taskId:"task",startingCommit:"a".repeat(40),startingBranchHead:this.branchHead,branch:"task/task",goal:"Improve source",context:{comments:[]},allowedScope:["src/"],protectedPaths:[]});this.props={...this.props,scope:{...this.props.scope,expectedTip:this.branchHead,access:"write"}};return Response.json(await this.agentRelayCurrent(this.props));}
  if(url.pathname==="/issuance-fault"){this.issuanceFault=true;return Response.json({armed:true});}
  if(url.pathname==="/withdraw-on-issue"){this.withdrawOnIssue=true;return Response.json({armed:true});}
  if(url.pathname==="/proposal")return Response.json({saved:await this.saveAgentProposal("run","task",{"src/feature.ts":"export const value = 1;"})});
  if(url.pathname==="/mark")return Response.json({marked:await this.markAgentPushed("run","task",url.searchParams.get("commit")??"c".repeat(40))});
  if(url.pathname==="/unrelated-move"){this.branchHead="d".repeat(40);return Response.json({unrelated:true});}
  if(url.pathname==="/credential"){const id=url.searchParams.get("id")!;await this.agentRelayBeforeCredential(this.props,id,"write");const credential=await this.agentRelayCredential(this.props,id,"write");return Response.json({scope:credential.scope,hasServerToken:Boolean(credential.token),minted:this.minted});}
  if(url.pathname==="/transfer-own"){await this.agentRelayBeforeTransfer(this.props,url.searchParams.get("id")!,{oldCommit:this.props.scope.expectedTip,newCommit:url.searchParams.get("commit")??"c".repeat(40),ref:`refs/heads/${this.props.scope.branch}`});return Response.json({recorded:true});}
  if(url.pathname==="/webhook"){const state=await this.getState();state.tasks.task!.currentCommit=this.branchHead;this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));return Response.json({checkpointAdvanced:true});}
  if(url.pathname==="/transfer"){await this.agentRelayBeforeTransfer(this.props,url.searchParams.get("id")!);return Response.json({allowed:true});}
  if(url.pathname==="/move"){this.branchHead="c".repeat(40);return Response.json({moved:true});}
  if(url.pathname==="/current")return Response.json(await this.agentRelayCurrent(this.props,url.searchParams.get("request")??undefined));
  if(url.pathname==="/revoke")return Response.json({revoked:await this.revokeAgentCredential(url.searchParams.get("id")!),count:this.revoked});
  if(url.pathname==="/withdraw"){this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id='owner'");return Response.json({withdrawn:true});}
  if(url.pathname==="/cleanup")return Response.json(await this.cleanupRelayAttempt(this.props));
  return new Response("Not found",{status:404});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Scoped relay refused"},{status:409});}}
}
export default{fetch:(request:Request,env:Env)=>env.REPOSITORY_CONTROLLER.getByName(request.headers.get("x-fixture-instance")??"fixture").fetch(request)};
