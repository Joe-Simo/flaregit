import worker from '../../src/server/worker';
import {LfsHttpFixture} from './lfs-http-worker';
import type {Env} from '../../src/server/env';
import {accountOf,accountKeyFor} from '../../src/server/projects';

export class IssueStateFixture extends LfsHttpFixture {
 private armed=false;private paused=false;private stateCommitRelease:(()=>void)|undefined;
 async arm(){this.armed=true;}
 async pauseStatus(){return{paused:this.paused};}
 async resume(){this.stateCommitRelease?.();this.stateCommitRelease=undefined;}
 protected override async beforeIssueStateCommit(){if(!this.armed)return;this.armed=false;this.paused=true;await new Promise<void>(resolve=>{this.stateCommitRelease=resolve;});this.paused=false;}
 async memberToken(){const account=accountOf(this.env,await accountKeyFor('member')),secret=`fgt_${await accountKeyFor('member')}_${'b'.repeat(40)}`,record=await account.createApiToken('member','Issue state member fixture',secret,{scope:'full'});return{secret,id:record.id};}
 async revokeMember(){await this.removeMember('member');}
 override async seed(){await super.seed();await this.createIssue({title:'State transitions',body:'Canonical state fixture',author:'owner'});}
 async internalClose(){return this.setIssueState(1,'closed','owner');}
}
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as IssueStateFixture;
 if(url.pathname==='/fixture/seed'){await repository.seed();return Response.json({seeded:true});}
 if(url.pathname==='/fixture/token')return Response.json(await repository.token());
 if(url.pathname==='/fixture/member-token')return Response.json(await repository.memberToken());
 if(url.pathname==='/fixture/revoke-member'){await repository.revokeMember();return Response.json({revoked:true});}
 if(url.pathname==='/fixture/arm'){await repository.arm();return Response.json({armed:true});}
 if(url.pathname==='/fixture/pause-status')return Response.json(await repository.pauseStatus());
 if(url.pathname==='/fixture/resume'){await repository.resume();return Response.json({resumed:true});}
 if(url.pathname==='/fixture/revoke'){await repository.revoke(url.searchParams.get('id')!);return Response.json({revoked:true});}
 if(url.pathname==='/fixture/internal-close')return Response.json(await repository.internalClose());
 if(url.pathname==='/fixture/inspect')return Response.json(await repository.getIssue(1));
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as Env,ctx);
}};
