import worker from '../../src/server/worker';
import {PeopleFixture} from './community-people-worker';
import {accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
export class PeopleAccessFixture extends PeopleFixture {
 override async getProfile(){const profile=await super.getProfile();if(this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='fixture_profile_gate'").toArray().length)await fetch((this.env as Env&{FIXTURE_GATE:string}).FIXTURE_GATE);return profile;}
 async arm(){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_profile_gate(id INTEGER)');}
}
export default {async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){const url=new URL(request.url),repo=env.REPOSITORY_CONTROLLER.getByName('project:p123456abcdef') as unknown as PeopleAccessFixture,key=await accountKeyFor('human'),account=env.REPOSITORY_CONTROLLER.getByName('account:'+key) as unknown as PeopleAccessFixture;
if(url.pathname==='/fixture/seed'){await (repo as unknown as PeopleAccessFixture).seed();await account.addProject({id:'p123456abcdef',name:'Local synthetic People',kind:'native',role:'member'});const secret='fgt_'+key+'_'+'x'.repeat(32),created=await account.createApiToken('human','Local synthetic read',secret,{scope:'read',repo:'p123456abcdef'});return Response.json({token:secret,tokenId:created.id});}
if(url.pathname==='/fixture/arm'){await account.arm();return new Response('ok');}
if(url.pathname==='/fixture/remove'){await repo.removeMember('human');return new Response('ok');}
if(url.pathname==='/fixture/rejoin'){await repo.addMember('human','member');return new Response('ok');}
if(url.pathname==='/fixture/revoke'){await account.revokeApiToken(url.searchParams.get('id')!);return new Response('ok');}
return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);}};
