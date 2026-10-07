import worker from '../../src/server/worker';
import {PreviewOnboardingFixture} from './preview-onboarding-controller-worker';
import {accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
export {PreviewOnboardingFixture};
export default {async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){const url=new URL(request.url),repo=env.REPOSITORY_CONTROLLER.getByName('project:p123456abcdef') as unknown as PreviewOnboardingFixture,global=env.REPOSITORY_CONTROLLER.getByName('global') as unknown as PreviewOnboardingFixture,key=await accountKeyFor('owner'),account=env.REPOSITORY_CONTROLLER.getByName('account:'+key) as unknown as PreviewOnboardingFixture;
 if(url.pathname==='/fixture/seed'){await repo.seed();await account.addProject({id:'p123456abcdef',name:'Local preview',kind:'native',role:'owner'});const read='fgt_'+key+'_'+'r'.repeat(32),full='fgt_'+key+'_'+'f'.repeat(32);await account.createApiToken('owner','Local read',read,{scope:'read',repo:'p123456abcdef'});const created=await account.createApiToken('owner','Local full',full,{scope:'full',repo:'p123456abcdef'});return Response.json({read,full,fullId:created.id});}
 if(url.pathname==='/fixture/enable'){await repo.configure('true','1');await global.configure('true','1');return new Response('ok');}
 if(url.pathname==='/fixture/calls')return Response.json(await repo.callsMade());
 if(url.pathname==='/fixture/revoke'){await account.revokeApiToken(url.searchParams.get('id')!);return new Response('ok');}
 return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
}};
