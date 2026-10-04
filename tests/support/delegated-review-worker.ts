import {RepositoryController} from '../../src/server/durable-object';
import type {Env} from '../../src/server/env';
export class DelegatedReviewFixture extends RepositoryController {
 override async fetch(request:Request){const url=new URL(request.url),actor={userId:url.searchParams.get('actor')??'owner',displayName:'Human fixture',viaToken:false},expiry=Date.now()+60000;try{
 if(url.pathname==='/seed'){this.ctx.storage.sql.exec('INSERT INTO project VALUES(1,?)',JSON.stringify({projectId:'p123456789abc',projectName:'Review fixture',canonicalRepoName:'canonical',policyVersion:1,verificationPolicy:{},acceptedState:{currentCommit:'a'.repeat(40),history:[]},tasks:{},journal:[],evidence:{evidence:{id:'evidence',status:'passed',candidateCommit:'b'.repeat(40),candidateTree:'c'.repeat(40)}},candidates:{'candidate-one':{id:'candidate-one',candidateCommit:'b'.repeat(40),expectedAcceptedBase:'a'.repeat(40),frozenPolicyVersion:1,evidenceId:'evidence',status:'awaiting_review',workflowInstanceId:'integration-one',participatingTaskIds:[],frozenReviewPolicy:{version:1,policy:{requiredApprovals:1,allowAuthorApproval:false},authorIds:[]}}}}));await this.addMember('owner','owner');await this.addMember('reviewer','member');return Response.json({seeded:true});}
 if(url.pathname==='/policy')return Response.json(await this.configureRepositoryReviewPolicy({eventId:'policy-one',expectedVersion:0,policy:{requiredApprovals:1,allowAuthorApproval:false}},actor,undefined,expiry));
 if(url.pathname==='/policy-two')return Response.json(await this.configureRepositoryReviewPolicy({eventId:'policy-two',expectedVersion:1,policy:{requiredApprovals:2,allowAuthorApproval:false}},actor,undefined,expiry));
 if(url.pathname==='/grant')return Response.json(await this.setRepositoryReviewGrant({eventId:'grant-reviewer',userId:'reviewer',expectedVersion:0,enabled:true},actor,undefined,expiry));
 if(url.pathname==='/revoke')return Response.json(await this.setRepositoryReviewGrant({eventId:'revoke-reviewer',userId:'reviewer',expectedVersion:1,enabled:false},actor,undefined,expiry));
 if(url.pathname==='/review')return Response.json(await this.recordCandidateDelegatedReview('candidate-one',{eventId:'approve-reviewer',expectedCommit:'b'.repeat(40),grantVersion:1,decision:'approve'},actor,undefined,expiry));
 if(url.pathname==='/report')return Response.json(await this.candidateDelegatedReviews('candidate-one',actor,undefined,expiry));
 if(url.pathname==='/state')return Response.json(await this.getState());
 return new Response('Missing fixture route',{status:404});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Failure'},{status:409});}}
}
export default {fetch:(request:Request,env:Env)=>env.REPOSITORY_CONTROLLER.getByName('fixture').fetch(request)};
