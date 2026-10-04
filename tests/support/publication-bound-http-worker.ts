import worker from '../../src/server/worker';
import {AcceptedTargetFixture} from './accepted-target-binding-worker';
import {accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
export {AcceptedTargetFixture};
export default {async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){
 const url=new URL(request.url),repo=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc');
 if(url.pathname.startsWith('/fixture/')){
  if(url.pathname==='/fixture/token') {const account=env.REPOSITORY_CONTROLLER.getByName('account:'+await accountKeyFor('owner')) as unknown as AcceptedTargetFixture,token='fgt_'+await accountKeyFor('owner')+'_'+'x'.repeat(32);await account.createApiToken('owner','Fixture read only',token,{scope:'read',repo:'p123456789abc'});return Response.json({token});}
  return repo.fetch(new Request('http://fixture'+url.pathname.replace('/fixture','')+url.search,request));
 }
 return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
}};
