import worker from '../../src/server/worker';
import {RepositoryLifecycleFixture} from './repository-lifecycle-http-worker';
import type {OrganizationAccessSnapshot} from '../../src/server/organization-access';
import type {Env} from '../../src/server/env';
export class OrganizationFixture extends RepositoryLifecycleFixture {
 private failing=false;
 async failSynchronization(value:boolean){this.failing=value;}
 override async synchronizeOrganization(doc:OrganizationAccessSnapshot){if(this.failing)throw Error('Test repository unavailable');return super.synchronizeOrganization(doc);}
}
export default {async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){
 const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as OrganizationFixture;
 if(url.pathname==='/fixture/seed'){await repository.seed();return Response.json({ok:true});}
 if(url.pathname==='/fixture/synchronization'){await repository.failSynchronization(url.searchParams.get('fail')==='true');return Response.json({ok:true});}
 return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
}};
