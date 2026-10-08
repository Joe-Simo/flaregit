import worker from '../../src/server/worker';
import {RepositoryLifecycleFixture} from './repository-lifecycle-http-worker';
import type {OrganizationAccessSnapshot} from '../../src/server/organization-access';
import type {Task} from '../../src/core/types';
import type {Env} from '../../src/server/env';
export class OrganizationFixture extends RepositoryLifecycleFixture {
 async seedInheritedContribution(taskId='team-contribution'){
  const actorId='outsider',now=new Date().toISOString(),task:Task={id:taskId,goal:'Team contribution',contributor:{id:actorId,name:'Team contributor',type:'human'},baseCommit:'a'.repeat(40),currentCommit:'a'.repeat(40),allowedScope:[],status:'working',requirements:[],workspace:{repoName:`test-${taskId}`,remote:'https://private.invalid',branch:`task/${taskId}`},checkpoints:[],createdAt:now,updatedAt:now};
  return this.createTask(task,actorId,{goal:task.goal,dependsOn:null,issue:null},undefined,{viaToken:false,sessionExpiresAt:Date.now()+60000});
 }
 async beginInheritedGateway(){const id=crypto.randomUUID(),scope=await this.beginGitGatewayAttempt(id,'team-contribution',true,'outsider',null);await this.recordGitGatewayCredential(id,'synthetic-test-capability',Date.now()+60000,'write');return {id,scope};}
 private failing=false;
 async failSynchronization(value:boolean){this.failing=value;}
 override async synchronizeOrganization(doc:OrganizationAccessSnapshot){if(this.failing)throw Error('Test repository unavailable');return super.synchronizeOrganization(doc);}
}
export default {async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){
 const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as OrganizationFixture;
 if(url.pathname==='/fixture/seed'){await repository.seed();return Response.json({ok:true});}
 if(url.pathname==='/fixture/contribution'){try{return Response.json(await repository.seedInheritedContribution());}catch{return Response.json({error:'Contribution denied'},{status:403});}}
 if(url.pathname==='/fixture/cancel-contribution')return Response.json(await repository.seedInheritedContribution('cancel-contribution'));
 if(url.pathname==='/fixture/handoff'){await repository.beginAgentTask('team-contribution','fixture-agent-run');return Response.json({ok:true});}
 if(url.pathname==='/fixture/members')return Response.json(await repository.listMembers());
 if(url.pathname==='/fixture/verify-capability'){const input=await request.json() as {secret:string;write:boolean};return Response.json({valid:!!await repository.verifyGitCapability(input.secret,'team-contribution',input.write)});}
 if(url.pathname==='/fixture/gateway')return Response.json(await repository.beginInheritedGateway());
 if(url.pathname==='/fixture/gateway-dispatch')return Response.json({allowed:await repository.markGitGatewayDispatch(url.searchParams.get('id')!)});
 if(url.pathname==='/fixture/synchronization'){await repository.failSynchronization(url.searchParams.get('fail')==='true');return Response.json({ok:true});}
 return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
}};
