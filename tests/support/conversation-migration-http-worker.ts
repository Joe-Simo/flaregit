import worker from '../../src/server/worker';
import {ConversationMigrationFixture} from './conversation-migration-worker';
import type {Env} from '../../src/server/env';
export {ConversationMigrationFixture};
interface FixtureEnv extends Env {FIXTURE_ISSUER:string}
export default {async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc');
 if(url.pathname==='/fixture/seed'){const seeded=await repository.fetch('https://test/seed');if(!seeded.ok)return seeded;return repository.fetch('https://test/begin');}
 if(url.pathname==='/fixture/budget')return env.REPOSITORY_CONTROLLER.getByName('global').fetch('https://test/budget?reason='+encodeURIComponent(url.searchParams.get('reason')??'none'));
 if(url.pathname==='/fixture/reads')return repository.fetch('https://test/reads');
 if(url.pathname==='/fixture/mode')return repository.fetch('https://test/mode?failure='+encodeURIComponent(url.searchParams.get('failure')??'none'));
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example'} as unknown as Env,ctx);
}};
