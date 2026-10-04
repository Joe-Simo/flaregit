import {RepositoryController} from '../../src/server/durable-object';
import type {Env} from '../../src/server/env';
export class AgentAuthorityFixture extends RepositoryController {
 private observedStatus='running';private stopCalls=0;
 protected override async agentWorkflowTerminalStatus(){return this.observedStatus;}
 override async confirmAgentNativeStopped(_attemptId:string,_nativeId:string){this.stopCalls++;return false;}

 override async reserveCoreGitOperation(){return {allowed:true,existing:false,basis:"conservative_operation_envelope"} as const;}
 override async fetch(request:Request){const path=new URL(request.url).pathname;try{
  if(path==='/seed'){
   const task={id:'task',goal:'Improve source',baseCommit:'a'.repeat(40),currentCommit:'a'.repeat(40),workspace:{repoName:'workspace',branch:'task',remote:'https://example.com/git'},status:'working',agentWorkflowInstanceId:'run'};
   this.ctx.storage.sql.exec('INSERT INTO project VALUES(1,?)',JSON.stringify({projectId:'p123456789abc',projectName:'Fixture',canonicalRepoName:'canonical',tasks:{task},candidates:{},verificationPolicy:{}}));
   await this.addMember('owner','owner');await this.registerWorkflow('run','agent',undefined,'owner');return Response.json({seeded:true});
  }
  if(path==='/sweep'){this.observedStatus=new URL(request.url).searchParams.get('status')??'running';await this.retryAgentNativeStops();return Response.json({stopCalls:this.stopCalls});}
  if(path==='/recover')return Response.json(await this.recoverAgentNativeAttempt(new URL(request.url).searchParams.get('id')!,{userId:'owner',displayName:'Owner',viaToken:false},undefined,Date.now()+60000));
  if(path==='/claim')return Response.json(await this.claimAgentRun({runId:'run',taskId:'task',startingCommit:'a'.repeat(40),startingBranchHead:'a'.repeat(40),branch:'task',goal:'Improve source',context:{comments:[]},allowedScope:['*'],protectedPaths:[]}));
  if(path==='/proposal')return Response.json(await this.saveAgentProposal('run','task',{'src/fix.ts':'export const fixed = true;'}));
  if(path==='/withdraw'){this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id='owner'");return Response.json({withdrawn:true});}
  if(path==='/begin')return Response.json(await this.beginAgentNativeAttempt(await request.json() as Parameters<RepositoryController['beginAgentNativeAttempt']>[0]));
  if(path==='/credential'){const input=await request.json() as {attemptId:string;id:string;scope:'read'|'write';expiry:number};return Response.json(await this.beginAgentCredential(input.attemptId,input.id,input.scope,input.expiry));}
  if(path==='/record'){const input=await request.json() as {attemptId:string;id:string};await this.recordAgentCredential(input.attemptId,input.id,'synthetic-server-secret',Date.now()+300000);return Response.json({recorded:true});}
  if(path==='/destroy'){await this.destroy();return Response.json({deleted:true});}
  return new Response('Not found',{status:404});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Failure'},{status:409});}}
}
export default {fetch:(request:Request,env:Env)=>env.REPOSITORY_CONTROLLER.getByName('fixture').fetch(request)};
