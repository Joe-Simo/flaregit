import {BranchAuthorityFixture} from './branch-authority-worker';
import type {Env} from '../../src/server/env';
export class AcceptedRegistryFixture extends BranchAuthorityFixture {
 override async fetch(request:Request){const url=new URL(request.url);try{
 if(url.pathname==='/registry')return Response.json(await this.acceptedBranchRegistrySnapshot());
 if(url.pathname==='/legacy-ref'){const state=await this.getState();delete state.defaultBranch;this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));return Response.json({changed:true});}
 if(url.pathname==='/recorded-current'){const state=await this.getState();state.acceptedState.currentCommit='b'.repeat(40);this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));return Response.json({changed:true});}
 if(url.pathname==='/projection-failure'){this.ctx.storage.sql.exec("CREATE TRIGGER reject_root_update BEFORE UPDATE ON accepted_branch_roots BEGIN SELECT RAISE(ABORT,'synthetic registry capacity failure'); END");return Response.json({armed:true});}
 if(url.pathname==='/restore-projection'){this.ctx.storage.sql.exec('DROP TRIGGER reject_root_update');return Response.json({restored:true});}
 if(url.pathname==='/accept'){const state=await this.getState(),candidateId='candidate-projection',commit='b'.repeat(40),journalId=crypto.randomUUID(),stamp=new Date().toISOString();state.candidates[candidateId]={id:candidateId,attemptNumber:1,participatingTaskIds:[],participatingCommits:{},expectedAcceptedBase:state.acceptedState.currentCommit,frozenPolicyVersion:state.policyVersion,frozenVerificationPolicy:{},frozenRequirements:[],repairAttempts:[],candidateCommit:commit,status:'verified',createdAt:stamp,updatedAt:stamp};state.journal.push({id:journalId,candidateId,candidateCommit:commit,candidateTree:'c'.repeat(40),expectedHead:state.acceptedState.currentCommit,newHead:commit,outputDigest:'synthetic-verified-output',state:'PREPARED',timestamp:stamp});this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));await this.completePublish(journalId);return Response.json({journalId,state:await this.getState()});}
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Failure'},{status:409});}return super.fetch(request);}
}
export default {fetch:(request:Request,env:Env)=>env.REPOSITORY_CONTROLLER.getByName(new URL(request.url).searchParams.get('name')??'fixture').fetch(request)};
