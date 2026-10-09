import worker from '../../src/server/worker';
import {IssueLifecycleFixture} from './issue-lifecycle-worker';
import {accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
export class AccountDiscoveryFixture extends IssueLifecycleFixture{
 private calls=0;private after=0;private waiting=false;private releaseWaiter:(()=>void)|undefined;
 async armDiscovery(after:number){this.calls=0;this.after=after;}
 async discoveryWaiting(){return this.waiting;}
 async releaseDiscovery(){this.releaseWaiter?.();this.releaseWaiter=undefined;}
 override async apiTokenHashCanRead(...args:Parameters<IssueLifecycleFixture['apiTokenHashCanRead']>){this.calls++;if(this.after&&this.calls===this.after){this.waiting=true;await new Promise<void>(resolve=>{this.releaseWaiter=resolve;});this.waiting=false;}return super.apiTokenHashCanRead(...args);}
 async registerDiscovery(){await this.addProject({id:'p123456789abc',name:'LFS fixture',role:'owner',kind:'repository'});}
}
export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){const url=new URL(request.url),repo=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as AccountDiscoveryFixture,account=env.REPOSITORY_CONTROLLER.getByName('account:'+await accountKeyFor('owner')) as unknown as AccountDiscoveryFixture;
 if(url.pathname==='/fixture/seed'){await repo.seed();await account.registerDiscovery();return new Response('ok');}
 if(url.pathname==='/fixture/token')return Response.json(await repo.token());
 if(url.pathname==='/fixture/arm'){await account.armDiscovery(Number(url.searchParams.get('after')));return new Response('ok');}
 if(url.pathname==='/fixture/waiting')return Response.json(await account.discoveryWaiting());
 if(url.pathname==='/fixture/revoke'){await account.revokeApiToken(url.searchParams.get('id')!);await account.releaseDiscovery();return new Response('ok');}
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as Env,ctx);
}};
