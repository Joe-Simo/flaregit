import {AutoPublicationFixture} from './auto-publication-worker';
import {IntegrationNativePhases} from '../../src/server/integration-native-phase';
import {PublicationNativePhases} from '../../src/server/publication-native-phase';
import type {Env} from '../../src/server/env';
export class PublicationPhaseFixture extends AutoPublicationFixture {
 async exercise(mode:string){
  const {context}=await this.setup({base:'a'.repeat(40),commit:'b'.repeat(40),tree:'d'.repeat(40)});
  const state=await this.getState(),candidate=state.candidates.candidate!,target=candidate.acceptedTarget!;
  const approved=await this.recordReview(candidate.id,{approved:true,actor:{userId:'owner',displayName:'Synthetic owner',viaToken:false},note:'Exact local fixture approval'},candidate.candidateCommit!,undefined,{ref:target.ref,acceptedCommit:target.acceptedCommit,acceptedVersion:target.acceptedVersion});
  if(!approved.ok)throw Error(approved.error);
  const prepared=await this.preparePublish(candidate.id);if(!prepared.ok||!prepared.journal)throw Error('Human preparation failed');
  const now=Date.now(),scope={projectId:state.projectId,incarnation:context.scope.incarnation,workflowId:'workflow',candidateId:'candidate',actorId:'owner',accountKey:context.accountKey};
  this.env.FLAREGIT_SOURCE_VERSION='1'.repeat(40);this.env.CF_VERSION_METADATA={id:'12345678-1234-4234-8234-123456789abc',tag:'fixture',timestamp:new Date().toISOString()};
  const integration={projectId:scope.projectId,incarnation:scope.incarnation,expectedEventId:'workflow',actorId:'owner',sourceVersion:this.env.FLAREGIT_SOURCE_VERSION,image:context.image,acceptedBase:'a'.repeat(40),contributions:[{taskId:'task-one',commit:'b'.repeat(40)}],activatedAt:now-1000,admissionExpiresAt:now+60000,nativeStopAt:now+120000,maxAllocations:1,maxContainerSeconds:1200,maxCommands:64,kind:'native-essential'};
  this.env.INTEGRATION_NATIVE_PHASE_JSON=JSON.stringify(integration);new IntegrationNativePhases(this.ctx.storage);
  this.ctx.storage.sql.exec('INSERT INTO integration_native_phases VALUES(?,?)','workflow',JSON.stringify({config:integration,workerVersion:'12345678-1234-4234-8234-123456789abc',context:'synthetic-local-original-context',candidateId:'candidate',nativeId:crypto.randomUUID(),allocatedAt:now-2000,startClaimed:true}));
  this.env.PUBLICATION_NATIVE_PHASE_JSON=JSON.stringify({...scope,journalId:prepared.journal.id,commit:'b'.repeat(40),tree:'d'.repeat(40),evidenceId:'synthetic-git',reviewActorId:'owner',sourceVersion:this.env.FLAREGIT_SOURCE_VERSION,image:context.image,activatedAt:now-1000,admissionExpiresAt:now+60000,nativeStopAt:now+120000,maxAllocations:1,maxContainerSeconds:1200,maxCommands:64,kind:'native-essential'});
  const original=new IntegrationNativePhases(this.ctx.storage).get('workflow');
  if(mode==='no-approval')candidate.review=undefined;
  if(mode==='stale-commit')candidate.candidateCommit='e'.repeat(40);
  if(mode==='policy')state.policyVersion++;
  if(mode==='unknown-cleanup')this.ctx.storage.sql.exec('DELETE FROM integration_verification_credentials');
  if(mode==='wrong-human')this.env.PUBLICATION_NATIVE_PHASE_JSON=this.env.PUBLICATION_NATIVE_PHASE_JSON.replace('"reviewActorId":"owner"','"reviewActorId":"other"');
  this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));
  if(mode==='revoked')await this.addMember('owner','member');
  if(mode==='initiator-inactive')await (this.env.REPOSITORY_CONTROLLER.getByName('account:'+context.accountKey) as unknown as AutoPublicationFixture).beginAccountDeletion();
  const native=crypto.randomUUID();let allowed=false,replayDenied=false,secondDenied=false,commandLimitDenied=false,detail="";
  try{await this.reserveIntegrationNativeRuntime('workflow','candidate',native,'publish-candidate');const canonicalScope=await this.admitIntegrationNativeCommand('workflow','candidate',native,crypto.randomUUID());allowed=true;await this.integrationNativeStart(canonicalScope,native);try{await this.integrationNativeStart(canonicalScope,native);}catch{replayDenied=true;}try{await this.reserveIntegrationNativeRuntime('workflow','candidate',crypto.randomUUID(),'publish-candidate');}catch{secondDenied=true;}for(let index=1;index<64;index++){const id=crypto.randomUUID();await this.admitIntegrationNativeCommand('workflow','candidate',native,id);await this.finishIntegrationNativeCommand(canonicalScope,native,id,'completed');}try{await this.admitIntegrationNativeCommand('workflow','candidate',native,crypto.randomUUID());}catch{commandLimitDenied=true;}}catch(error){detail=String(error);}
  return{detail,commandLimitDenied,allowed,replayDenied,secondDenied,integrationUnchanged:JSON.stringify(original)===JSON.stringify(new IntegrationNativePhases(this.ctx.storage).get('workflow')),publication:new PublicationNativePhases(this.ctx.storage).get('workflow')?.config??null};
 }
}
export default {async fetch(request:Request,env:Env){try{return Response.json(await (env.REPOSITORY_CONTROLLER.getByName('initial:project:p123456789abc') as unknown as PublicationPhaseFixture).exercise(new URL(request.url).pathname.slice(1)));}catch(error){return Response.json({error:String(error)},{status:409});}}};
