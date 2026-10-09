import {MetadataArchives} from '../../src/server/metadata-archive';
import worker from '../../src/server/worker';
import {IssueStateFixture} from './issue-state-worker';
import type {Env} from '../../src/server/env';

export class IssueLifecycleFixture extends IssueStateFixture {
 private deletionArmed=false;private deletionPaused=false;private deletionRelease:(()=>void)|undefined;
 async armDeletion(){this.deletionArmed=true;}
 async deletionStatus(){return{paused:this.deletionPaused};}
 async resumeDeletion(){this.deletionRelease?.();this.deletionRelease=undefined;}
 protected override async beforeIssueDeletionCommit(){if(!this.deletionArmed)return;this.deletionArmed=false;this.deletionPaused=true;await new Promise<void>(resolve=>{this.deletionRelease=resolve;});this.deletionPaused=false;}
 async seedArchiveHistory(number:number){new MetadataArchives(this.ctx.storage);this.ctx.storage.sql.exec('INSERT INTO metadata_archive_history VALUES(?,?,?)','comments','owner-audit-fixture',JSON.stringify({subject:'issue:'+number,body:'Private owner archival context'}));}
 async audit(number:number){return{markers:this.ctx.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM issue_tombstones WHERE issue_number=?',number).toArray()[0]!.count,retained:this.ctx.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM issues WHERE number=?',number).toArray()[0]!.count};}
}
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as IssueLifecycleFixture;
 if(url.pathname==='/fixture/seed'){await repository.seed();return Response.json({seeded:true});}
 if(url.pathname==='/fixture/token')return Response.json(await repository.token());
 if(url.pathname==='/fixture/member-token')return Response.json(await repository.memberToken());
 if(url.pathname==='/fixture/revoke'){await repository.revoke(url.searchParams.get('id')!);return Response.json({revoked:true});}
 if(url.pathname==='/fixture/arm'){await repository.armDeletion();return Response.json({armed:true});}
 if(url.pathname==='/fixture/pause-status')return Response.json(await repository.deletionStatus());
 if(url.pathname==='/fixture/resume'){await repository.resumeDeletion();return Response.json({resumed:true});}
 if(url.pathname==='/fixture/inspect')return Response.json(await repository.getIssue(1));
 if(url.pathname==='/fixture/history'){await repository.seedArchiveHistory(Number(url.searchParams.get('number')));return Response.json({seeded:true});}
 if(url.pathname==='/fixture/audit')return Response.json(await repository.audit(Number(url.searchParams.get('number'))));
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as Env,ctx);
}};
