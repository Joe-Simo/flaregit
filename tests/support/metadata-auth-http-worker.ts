import worker from '../../src/server/worker';
import {ConversationMigrationFixture} from './conversation-migration-worker';
import {accountOf,accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
export class MetadataAuthFixture extends ConversationMigrationFixture{
 private roleReads=0;
 override async roleOf(userId:string){this.roleReads++;return super.roleOf(userId);}
 async roles(){return this.roleReads;}
 async testToken(){const account=accountOf(this.env,await accountKeyFor('owner')),secret=`fgt_${await accountKeyFor('owner')}_${'a'.repeat(40)}`,saved=await account.createApiToken('owner','Fixture',secret,{scope:'full'});return{secret,id:saved.id};}
 async revokeToken(id:string){return accountOf(this.env,await accountKeyFor('owner')).revokeApiToken(id);}
}
interface FixtureEnv extends Env{FIXTURE_ISSUER:string}
export default{async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as MetadataAuthFixture;
 if(url.pathname==='/fixture/seed')return repository.fetch(new Request('https://test/seed'));
 if(url.pathname==='/fixture/roles')return Response.json({count:await repository.roles()});
 if(url.pathname==='/fixture/token')return Response.json(await repository.testToken());
 if(url.pathname==='/fixture/revoke'){await repository.revokeToken(url.searchParams.get('id')!);return Response.json({ok:true});}
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example'} as unknown as Env,ctx);
}};
