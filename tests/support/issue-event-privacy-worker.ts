import worker from '../../src/server/worker';
import {IssueLifecycleFixture} from './issue-lifecycle-worker';
import type {Env} from '../../src/server/env';
import type {IssueEventSource} from '../../src/server/issue-event-sources';
export class IssueEventPrivacyFixture extends IssueLifecycleFixture{
 private late:{kind:'activity'|'inbox';number:number}|undefined;
 async armEvent(kind:'activity'|'inbox',number:number){this.late={kind,number};}
 private async removeForRace(number:number){const issue=await this.getIssue(number);if(!issue)return;const token=await this.token(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token.secret))),byte=>byte.toString(16).padStart(2,'0')).join('');const result=await this.deleteIssueMutation(number,{expectedRevision:issue.stateRevision,requestId:crypto.randomUUID(),confirmed:true},{userId:'owner',displayName:'Fixture owner',viaToken:true},{personalTokenHash:hash});if(!result.ok)throw Error('Synthetic deletion was not confirmed');}
 override async listActivity(...args:Parameters<IssueLifecycleFixture['listActivity']>){const rows=await super.listActivity(...args);if(this.late?.kind==='activity'){const number=this.late.number;this.late=undefined;await this.removeForRace(number);}return rows;}
 override async issueEventAvailable(userId:string,source:IssueEventSource){const result=await super.issueEventAvailable(userId,source);if(this.late?.kind==='inbox'&&this.late.number===source.number){this.late=undefined;await this.removeForRace(source.number);}return result;}
 async seedLegacyEvents(){await this.logActivity('legacy-sensitive-author','issue.opened','Legacy private deleted title');await this.logActivity('legacy-sensitive-author','comment.added','Legacy private deleted path.ts');}
 rawAudit(){return this.ctx.storage.sql.exec('SELECT summary FROM activity ORDER BY id').toArray();}
}
export default{async fetch(request:Request,env:Env,ctx:ExecutionContext){const url=new URL(request.url),repo=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as IssueEventPrivacyFixture;
 if(url.pathname==='/fixture/seed'){await repo.seed();await repo.seedLegacyEvents();return new Response('ok');}
 if(url.pathname==='/fixture/token')return Response.json(await repo.token());
 if(url.pathname==='/fixture/arm-event'){await repo.armEvent(url.searchParams.get('kind') as 'activity'|'inbox',Number(url.searchParams.get('number')));return new Response('ok');}
 if(url.pathname==='/fixture/raw-audit')return Response.json(await repo.rawAudit());
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as Env,ctx);
}};
