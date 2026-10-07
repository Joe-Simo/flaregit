import worker from '../../src/server/worker';
import reviewFixture,{ReviewAuthorityFixture} from './review-decision-authority-http-worker';
import {accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
const projectId='p123456789abc';
let reads=0;
export class BillingOutageFixture extends ReviewAuthorityFixture{
 override async getBilling():ReturnType<ReviewAuthorityFixture['getBilling']>{await this.ctx.storage.put('billingFailures',Number(await this.ctx.storage.get('billingFailures')??0)+1);throw Error('Synthetic optional billing unavailable');}
 async billingFailures(){return Number(await this.ctx.storage.get('billingFailures')??0);}
}
type FixtureEnv=Parameters<typeof reviewFixture.fetch>[1];
export default{async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){
 const path=new URL(request.url).pathname;
 if(path==='/fixture/billing-count')return Response.json(await (env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor('owner')}`) as unknown as BillingOutageFixture).billingFailures());
 if(path==='/fixture/read-count')return Response.json(reads);
 if(path.startsWith('/fixture/'))return reviewFixture.fetch(request,env,ctx);
 const commit={hash:'b'.repeat(40),treeHash:'c'.repeat(40),parents:[],message:'Synthetic accepted revision',author:{name:'Synthetic author',email:'fixture@example.invalid'},committedAt:1};
 const repo={log:async()=>{reads++;return[commit];},readCommit:async()=>{reads++;return commit;},readTree:async()=>{reads++;return[{name:'readme.md',type:'blob',hash:'d'.repeat(40),mode:'100644'}];},readBlob:async()=>{reads++;return new Blob(['synthetic private repository contents']);},[Symbol.dispose]() {}};
 return worker.fetch(request,{REPOSITORY_CONTROLLER:env.REPOSITORY_CONTROLLER,API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS:'1000000',REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS:'1000000',CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS:'2000000',CORE_GIT_GLOBAL_MONTHLY_USD_MICROS:'2000000',ARTIFACTS:{get:async(name:string)=>{if(name!=='synthetic')throw Error('Foreign provider scope');return repo;}},INTEGRATION_WORKFLOW:{get:async()=>({sendEvent:async()=>{}})},INTEGRATION_QUEUE:{send:async()=>{}},PAID_CHECKOUT_ENABLED:'true'} as unknown as Env,ctx);
}};
