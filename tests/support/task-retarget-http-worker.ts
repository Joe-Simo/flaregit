import worker from '../../src/server/worker';
import {RepositoryController} from '../../src/server/durable-object';
import {AcceptedBranchRoots} from '../../src/server/accepted-branch-roots';
import {TaskRetargets} from '../../src/server/task-retarget';
import {BranchNativeAttempts} from '../../src/server/branch-creation-operations';
import {PrivateRecoveryOperations} from '../../src/server/private-recovery';
import {accountKeyFor,globalOf,accountOf} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
import type {Task} from '../../src/core/types';
const sdkMarkers=new Map<string,string>();
function fixtureArtifacts(state:{revoked:boolean}){return{get:async(name:string)=>({info:async()=>{return{name,id:'retarget-provider',description:sdkMarkers.get(name)??null,remote:`https://${'a'.repeat(32)}.artifacts.cloudflare.net/workspace`,defaultBranch:'main'};},createToken:async(scope:'read'|'write',ttl:number)=>({plaintext:'synthetic-retarget-read-scope',scope,expiresAt:new Date(Date.now()+ttl*1000).toISOString()}),revokeToken:async()=>state.revoked,[Symbol.dispose]:()=>{}})} as unknown as Env['ARTIFACTS'];}

export class TaskRetargetHttpFixture extends RepositoryController {
 private pauseAfterNative=false;
 private stopped=true;private transportState:{revoked:boolean};private sealed=new Set<string>();private commands=0;
 constructor(ctx:DurableObjectState,env:Env){const transportState={revoked:true};super(ctx,{...env,ARTIFACTS:fixtureArtifacts(transportState)});this.transportState=transportState;}
 protected override branchRepositoryProvider(){return this.env.ARTIFACTS;}
 protected override branchNativeSandbox(nativeId:string){return{exec:async(args:string[])=>{if(this.sealed.has(nativeId))throw Error('Stopped native cannot restart');this.commands++;const env=this.env as Env&{OWNED_NATIVE_URL:string};return await(await fetch(env.OWNED_NATIVE_URL+'/exec',{method:'POST',body:JSON.stringify({nativeId,command:args[2]})})).json();},seal:async()=>{this.sealed.add(nativeId);},destroy:async()=>{},lifetimeStatus:async()=>({sealed:this.sealed.has(nativeId),state:this.stopped?'stopped':'stopping'})} as unknown as ReturnType<Env['INTEGRATOR']['getByName']>;}
 async armPostNative(){this.pauseAfterNative=true;}
 async postNativeReady(){const lock=new TaskRetargets(this.ctx.storage).lockState('change');return !!lock?.native_attempt_id&&new BranchNativeAttempts(this.ctx.storage).get(lock.native_attempt_id)?.state==='stopped'&&lock.credential_state==='revoked';}
 override async accountLifecycle():Promise<'active'|'deleting'|'deleted'>{
  if(this.pauseAfterNative){this.pauseAfterNative=false;const repository=this.env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as TaskRetargetHttpFixture;if(await repository.postNativeReady()){const env=this.env as Env&{OWNED_NATIVE_URL:string};await fetch(env.OWNED_NATIVE_URL+'/post-native',{method:'POST',body:'{}'});}else this.pauseAfterNative=true;}
  return super.accountLifecycle();
 }
 async beginFixtureGitWrite(){const id=crypto.randomUUID();await this.beginGitGatewayAttempt(id,'change',true,'owner',null);await this.recordGitGatewayCredential(id,'synthetic-completed-write-scope',Date.now()+60000,'write');if(!await this.markGitGatewayDispatch(id))throw Error('Fixture Git dispatch was denied');return {id};}
 async finishFixtureGitWrite(id:string){return this.finishGitGatewayAttempt(id,{transportFinished:true,credentialRevoked:true});}
 async mode(input:{stopped?:boolean;revoked?:boolean}){this.stopped=input.stopped!==false;this.transportState.revoked=input.revoked!==false;}
 async stats(){return{commands:this.commands};}
 async seed(input:{base:string;head:string;target:string}){
  const projectId='p123456789abc';await this.initialize({projectId,projectName:'Retarget protocol fixture',canonicalRepoName:'canonical',head:input.target,defaultBranch:'main',verificationPolicy:{kind:'git-integrity'},ownerId:'owner'});const seededIncarnation=new PrivateRecoveryOperations(this.ctx.storage).incarnation();
  const primaryScope={projectId,incarnation:seededIncarnation,canonicalRepoName:'canonical',ref:'refs/heads/main'},history=new AcceptedBranchRoots(this.ctx.storage);history.initializePrimary(primaryScope,{commit:input.target,requirements:[]},()=>{});history.publish({...primaryScope,operationId:crypto.randomUUID(),expectedHead:input.target,expectedVersion:0,commit:input.base,requirementsSnapshot:{commit:input.base,requirements:[]}},()=>{});
  const accepted=await this.getState();accepted.acceptedState.currentCommit=input.base;this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(accepted));await this.addMember('reader','member');
  const selected=(await this.contributionTargets('owner')).targets.find(target=>target.ref==='refs/heads/main')!,credential={viaToken:false,sessionExpiresAt:Date.now()+60000};
  const prepared=await this.prepareTaskCreationIntent('change','owner',{goal:'Retarget owned work',dependsOn:null,issue:null,expectedTarget:{ref:selected.ref,acceptedCommit:selected.acceptedCommit,acceptedVersion:selected.acceptedVersion,policyVersion:selected.policyVersion}},credential);await this.beginTaskCreationFork(prepared.eventId,'owner',credential);sdkMarkers.set(prepared.workspaceRepoName,`FlareGit creation ${prepared.eventId}/${prepared.allocationId}`);await this.recordTaskCreationForkAcknowledgement(prepared.eventId,{providerRepoId:'retarget-provider',name:prepared.workspaceRepoName,description:`FlareGit creation ${prepared.eventId}/${prepared.allocationId}`},'synthetic-initial-fork-key');if(!await this.revokeTaskCreationForkToken(prepared.eventId)){
   using provider=await this.env.ARTIFACTS.get(prepared.workspaceRepoName);const info=await provider.info(),capacity=await globalOf(this.env).coreGitCapacity(prepared.accountKey),row=this.ctx.storage.sql.exec<{status:string;cleared:number}>('SELECT status,token IS NULL AS cleared FROM initial_fork_credentials WHERE event_id=?',prepared.eventId).toArray()[0];throw Error('Fixture initial credential cleanup unavailable '+JSON.stringify({metadata:{idMatches:info.id==='retarget-provider',nameMatches:info.name===prepared.workspaceRepoName,markerMatches:info.description===`FlareGit creation ${prepared.eventId}/${prepared.allocationId}`},credential:row,coreBudgetReason:capacity.core.reason,coreEnvelopeAllowed:capacity.core.nextEnvelopeAllowed}));
  }
  await this.confirmTaskCreationFork(prepared.eventId,{allocationId:prepared.allocationId,workspaceRepoName:prepared.workspaceRepoName,sourceRepoName:prepared.selection.sourceRepoName,sourceCommit:prepared.selection.baseCommit,providerRepoId:'retarget-provider',nativeState:'not_allocated',credentialsComplete:true},'owner',credential);
  const now=new Date().toISOString(),task:Task={id:'change',goal:'Retarget owned work',contributor:{id:'owner',name:'Original author',type:'human'},baseCommit:prepared.selection.baseCommit,currentCommit:prepared.selection.baseCommit,status:'working',allowedScope:['*'],requirements:[],workspace:{repoName:prepared.workspaceRepoName,remote:`https://${'a'.repeat(32)}.artifacts.cloudflare.net/workspace`,branch:'task/change'},checkpoints:[],createdAt:now,updatedAt:now};await this.commitTaskCreationIntent(prepared.eventId,task,'owner',credential);await this.ingestCheckpoint({eventId:'fixture-checkpoint',taskId:'change',commit:input.head,ready:true});
  const incarnation=prepared.incarnation,roots=new AcceptedBranchRoots(this.ctx.storage);roots.createRoot({operationId:crypto.randomUUID(),projectId,incarnation,canonicalRepoName:'canonical',actorId:'owner',accountKey:await accountKeyFor('owner'),branch:'release',sourceCommit:input.target,acceptedCommit:input.base,phase:'confirmed',observedCommit:input.target,createdAt:Date.now()},{observedHead:input.target,sourceCommit:input.target,acceptedCommit:input.base,ancestryVerified:true,nativeStopped:true,credentialsRevoked:true},{commit:input.target,requirements:[]},()=>{});
  const release=(await this.contributionTargets('owner')).targets.find(target=>target.ref==='refs/heads/release')!;return{target:{ref:release.ref,acceptedCommit:release.acceptedCommit,acceptedVersion:release.acceptedVersion,policyVersion:release.policyVersion},head:input.head};
 }
}
export default{async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as TaskRetargetHttpFixture;
 if(url.pathname==='/fixture/seed'){try{return Response.json(await repository.seed(await request.json() as Parameters<TaskRetargetHttpFixture['seed']>[0]));}catch(error){return Response.json({error:error instanceof Error?error.message:'Seed failed'},{status:500});}}
 if(url.pathname==='/fixture/mode'){await repository.mode(await request.json() as Parameters<TaskRetargetHttpFixture['mode']>[0]);return Response.json({ok:true});}
 if(url.pathname==='/fixture/arm-post-native'){await(accountOf(env,await accountKeyFor('owner')) as unknown as TaskRetargetHttpFixture).armPostNative();return Response.json({ok:true});}
 if(url.pathname==='/fixture/git-write-start')return Response.json(await repository.beginFixtureGitWrite());
 if(url.pathname==='/fixture/git-write-finish'){const input=await request.json() as {id:string};return Response.json({settled:await repository.finishFixtureGitWrite(input.id)});}
 if(url.pathname==='/fixture/stats')return Response.json(await repository.stats());
 return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
}};
