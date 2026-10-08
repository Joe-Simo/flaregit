import worker from '../../src/server/worker';
import {LfsHttpFixture} from './lfs-http-worker';
import type {Env} from '../../src/server/env';
export class IssueAttachmentFixture extends LfsHttpFixture {
 private pauseKind:'get'|'delete'|null=null;private paused=false;private resumeGate:(()=>void)|null=null;private oldObjectKey:string|null=null;private readonly attachmentBucket:R2Bucket;
 constructor(ctx:DurableObjectState,env:Env){let fixture:IssueAttachmentFixture|undefined;const bucket=env.EVIDENCE_BUCKET;
  const wrapped=new Proxy(bucket,{get(target,property){if(property==='get'||property==='delete')return async(key:string)=>{if(fixture?.pauseKind===property&&key.startsWith('issue-attachment-blobs/')&&key.includes('/objects/')){fixture.pauseKind=null;fixture.paused=true;if(property==='delete')fixture.oldObjectKey=key;await new Promise<void>(resolve=>{fixture!.resumeGate=resolve;});fixture.paused=false;}return property==='get'?target.get(key):target.delete(key);};const member=Reflect.get(target,property) as unknown;return typeof member==='function'?member.bind(target):member;}});
  super(ctx,{...env,EVIDENCE_BUCKET:wrapped});this.attachmentBucket=bucket;fixture=this;
 }
 async arm(kind:'get'|'delete'){this.pauseKind=kind;this.paused=false;}
 async pauseStatus(){return{paused:this.paused};}
 async resume(){this.resumeGate?.();this.resumeGate=null;}
 async expire(id:string){const row=this.ctx.storage.sql.exec<{document:string}>('SELECT document FROM issue_attachment_refs WHERE id=?',id).toArray()[0];if(!row)throw Error('Attachment reference required');const document=JSON.parse(row.document) as {phase:string;retentionUntil:number};if(document.phase!=='removed')throw Error('Removed attachment required');document.retentionUntil=0;this.ctx.storage.sql.exec('UPDATE issue_attachment_refs SET document=? WHERE id=?',JSON.stringify(document),id);}
 async deleteOldKey(){if(!this.oldObjectKey)throw Error('Owned old object key required');await this.attachmentBucket.delete(this.oldObjectKey);}

 override async seed(){await super.seed();await this.createIssue({title:'Binary evidence',body:'Attach supporting files',author:'owner'});await this.createIssue({title:'Other issue',body:'Separate subject',author:'owner'});}
}
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as IssueAttachmentFixture;
 if(url.pathname==='/fixture/arm'){await repository.arm(url.searchParams.get('kind')==='delete'?'delete':'get');return Response.json({armed:true});}
 if(url.pathname==='/fixture/pause-status')return Response.json(await repository.pauseStatus());
 if(url.pathname==='/fixture/resume'){await repository.resume();return Response.json({resumed:true});}
 if(url.pathname==='/fixture/expire'){await repository.expire(url.searchParams.get('id')!);return Response.json({expired:true});}
 if(url.pathname==='/fixture/late-delete'){await repository.deleteOldKey();return Response.json({deleted:true});}
 if(url.pathname==='/fixture/seed'){await repository.seed();return Response.json({seeded:true});}
 if(url.pathname==='/fixture/token')return Response.json(await repository.token());
 if(url.pathname==='/fixture/revoke'){await repository.revoke(url.searchParams.get('id')!);return Response.json({revoked:true});}
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as Env,ctx);
}};
