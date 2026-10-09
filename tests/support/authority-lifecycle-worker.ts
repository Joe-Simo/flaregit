import {RepositoryConnections} from "../../src/server/connections";
import worker from '../../src/server/worker';
import {RepositoryController} from '../../src/server/durable-object';
import {AuthorityController} from '../../src/server/authority-controller';
import type {Env} from '../../src/server/env';
export {AuthorityController};
export class AuthorityAccountFixture extends RepositoryController {
  async fixtureSeed(){
    const projectId='p123456789abc',commit='a'.repeat(40);
    const state=await this.initialize({projectId,projectName:'OAuth fixture',canonicalRepoName:'synthetic-oauth',head:commit,verificationPolicy:{kind:'git-integrity'},ownerId:'member'});
    const at=new Date().toISOString();
    state.candidates['candidate-one']={id:'candidate-one',attemptNumber:1,participatingTaskIds:[],participatingCommits:{},expectedAcceptedBase:commit,frozenPolicyVersion:1,frozenVerificationPolicy:{kind:'git-integrity'},frozenRequirements:[],candidateCommit:commit,repairAttempts:[],status:'awaiting_review',createdAt:at,updatedAt:at};
    this.ctx.storage.sql.exec('INSERT INTO project(id,doc) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc',JSON.stringify(state));
    const connections=new RepositoryConnections(this.ctx.storage,projectId),provider=connections.create('Fixture CI',['report-check']);
    connections.freeze({repositoryId:projectId,candidateId:'candidate-one',commit,tree:'b'.repeat(40),policy:{version:1,mode:'augment',checks:[{id:'build',providerId:provider.metadata.id,required:true}]}});
  }
  async fixtureRemoveMember(){this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id='member'");}
  override async accountLifecycle(): Promise<'active'|'deleting'|'deleted'> {return await this.ctx.storage.get<'active'|'deleting'|'deleted'>('fixture-life') ?? 'active';}
  async fixtureLifecycle(value:'active'|'deleting'|'deleted'){await this.ctx.storage.put('fixture-life',value);}
}
export default {async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname==='/fixture/seed') {await (env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as AuthorityAccountFixture).fixtureSeed();return new Response('ok');}
  if(url.pathname==='/fixture/revoke-member') {await (env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as AuthorityAccountFixture).fixtureRemoveMember();return new Response('ok');}
  if(url.pathname==='/fixture/lifecycle'){
    const {accountKeyFor}=await import('../../src/server/projects');
    const stub=env.REPOSITORY_CONTROLLER.getByName('account:'+await accountKeyFor('member')) as unknown as AuthorityAccountFixture;
    await stub.fixtureLifecycle(url.searchParams.get('state') as 'active'|'deleting'|'deleted');return new Response('ok');
  }
  return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
}};
