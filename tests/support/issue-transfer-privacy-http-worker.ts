export {AuthorityController} from '../../src/server/authority-controller';
import worker from '../../src/server/worker';
import {RepositoryController} from '../../src/server/durable-object';
import {accountOf,accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';

const transferSourceId='p111111111111',transferDestinationId='p222222222222';
export class IssueTransferPrivacyFixture extends RepositoryController{
 private hookStage:'freeze'|'reservation'|'activation'|null=null;private hookPaused:string|null=null;private releaseHook:(()=>void)|undefined;private lostAck:'reservation'|'activation'|'finalization'|null=null;private loseFinalizationDispatch=false;private lostCancellationAck:'destination'|'source'|null=null;
 private unexpectedTransferError:{name:string;stackFrames:string[];sqlMessage?:string}|null=null;private attachmentDeleteCount=0;private attachmentPutCount=0;private pauseWrite=false;private writePaused=false;private writeCompleted=false;private releaseWrite:(()=>void)|undefined;
 private pauseRead=false;private readPaused=false;private releaseRead:(()=>void)|undefined;
 constructor(ctx:DurableObjectState,env:Env){
  let fixture:IssueTransferPrivacyFixture|undefined;const bucket=env.EVIDENCE_BUCKET;
  const wrapped=new Proxy(bucket,{get(target,property){
   if(property==='put')return async(key:string,value:Parameters<R2Bucket['put']>[1],options?:R2PutOptions)=>{
    if(fixture&&key.startsWith('issue-attachment-blobs/'))fixture.attachmentPutCount++;
    if(fixture?.pauseWrite&&key.startsWith('issue-attachment-blobs/')&&key.includes('/pending/')){
     fixture.pauseWrite=false;if(!(value instanceof ReadableStream))throw Error('Actual streamed transfer input required');
     const reader=(value as ReadableStream<Uint8Array>).getReader(),chunks:Uint8Array[]=[];let size=0;
     for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1024){await reader.cancel();throw Error('Synthetic late copy capacity exceeded');}chunks.push(next.value);}
     const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
     fixture.writePaused=true;await new Promise<void>(resolve=>{fixture!.releaseWrite=resolve;});fixture.writePaused=false;
     const result=await target.put(key,bytes,options);fixture.writeCompleted=true;return result;
    }
    return target.put(key,value,options);
   };
   if(property==='delete')return async(keys:Parameters<R2Bucket['delete']>[0])=>{if(fixture)fixture.attachmentDeleteCount+=(typeof keys==='string'?[keys]:keys).filter(key=>key.startsWith('issue-attachment-blobs/')).length;return target.delete(keys);};
   if(property==='get')return async(key:string)=>{
    if(fixture?.pauseRead&&key.startsWith('issue-attachment-blobs/')&&key.includes('/objects/')){fixture.pauseRead=false;fixture.readPaused=true;await new Promise<void>(resolve=>{fixture!.releaseRead=resolve;});fixture.readPaused=false;}
    return target.get(key);
   };
   const value=Reflect.get(target,property) as unknown;return typeof value==='function'?value.bind(target):value;
  }});
  super(ctx,{...env,EVIDENCE_BUCKET:wrapped});fixture=this;
 }
 async seedTransfer(which:'source'|'destination'){
  const projectId=which==='source'?transferSourceId:transferDestinationId;
  await this.initialize({projectId,projectName:which==='source'?'Private transfer source':'Private transfer destination',canonicalRepoName:'synthetic-transfer-'+which,head:'a'.repeat(40),verificationPolicy:{kind:'git-integrity'},ownerId:'transfer-admin'});
  await this.addMember(which==='source'?'source-only-admin':'destination-only-admin','owner');
  if(which==='source'){
   await this.addMember('source-member','member');
   const issue=await this.createIssue({title:'Private transferable issue secret',body:'Private transferable body secret',author:'Original contributor'});
   await this.addComment({subject:`issue:${issue.number}`,author:'Original commenter',body:'Private transferable comment secret'});
   await this.threadPreference('source-member',`issue:${issue.number}`,{mode:'subscribed',expectedVersion:0},Date.now()+300000);
   const state=await this.getState();state.tasks['source-linked-task']={id:'source-linked-task',issue:issue.number,goal:'Private source task secret',contributor:{id:'source-member',name:'Original contributor',type:'human'},baseCommit:'a'.repeat(40),currentCommit:'a'.repeat(40),status:'working',allowedScope:[],requirements:[],workspace:{repoName:'synthetic-source-task',remote:'https://fixture.invalid',branch:'task/source-linked-task'},checkpoints:[],createdAt:'2026-10-08',updatedAt:'2026-10-08'};this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS git_task_writers(task_id TEXT PRIMARY KEY,user_id TEXT NOT NULL)');this.ctx.storage.sql.exec('INSERT INTO git_task_writers VALUES(?,?)','source-linked-task','source-member');
   const current=await this.getIssue(issue.number);return {number:issue.number,revision:current!.stateRevision!};
  }
  return null;
 }
 protected override issueTransferUnexpectedError(error:unknown):void{this.unexpectedTransferError={name:error instanceof Error?error.name:'Unknown',...(error instanceof Error&&(error.stack??'').includes('IssueTransferLedger.usedCapacity')?{sqlMessage:error.message.slice(0,300)}:{}),stackFrames:error instanceof Error?(error.stack??'').split('\n').filter(line=>/^\s*at /.test(line)).slice(0,8).map(line=>line.slice(0,500)):[]};}
 async freshSourceIssue(){const issue=await this.createIssue({title:'Private transferable issue secret',body:'Private transferable body secret',author:'Original contributor'});await this.addComment({subject:`issue:${issue.number}`,author:'Original commenter',body:'Private transferable comment secret'});const current=await this.getIssue(issue.number);return {number:issue.number,revision:current!.stateRevision!};}
 async armHook(stage:'freeze'|'reservation'|'activation'){this.hookStage=stage;this.hookPaused=null;}
 async hookStatus(){return{paused:this.hookPaused};}
 async resumeHook(){this.releaseHook?.();this.releaseHook=undefined;}
 async dropTransferAcknowledgement(stage:'reservation'|'activation'|'finalization'){this.lostAck=stage;}
 private async pauseHook(stage:'freeze'|'reservation'|'activation'){if(this.hookStage!==stage)return;this.hookStage=null;this.hookPaused=stage;await new Promise<void>(resolve=>{this.releaseHook=resolve;});this.hookPaused=null;}
 protected override async beforeIssueTransferFreeze(){await this.pauseHook('freeze');}
 protected override async beforeIssueTransferReservation(){await this.pauseHook('reservation');}
 protected override async beforeIssueTransferActivation(){await this.pauseHook('activation');}
 protected override async afterIssueTransferReservation(){if(this.lostAck==='reservation'){this.lostAck=null;throw Error('Synthetic transfer reservation acknowledgement lost after real canonical allocation');}}
 protected override async afterIssueTransferActivation(){if(this.lostAck==='activation'){this.lostAck=null;throw Error('Synthetic transfer activation acknowledgement lost after real canonical commit');}}
 protected override async afterIssueTransferFinalization(){if(this.lostAck==='finalization'){this.lostAck=null;throw Error('Synthetic transfer finalization acknowledgement lost after real durable unlock');}}
 async loseNextFinalizationDispatch(){this.loseFinalizationDispatch=true;}
 override async issueTransferFinishDestination(...args:Parameters<RepositoryController['issueTransferFinishDestination']>):ReturnType<RepositoryController['issueTransferFinishDestination']>{if(this.loseFinalizationDispatch){this.loseFinalizationDispatch=false;return{ok:false,status:503,error:'Synthetic destination finalization dispatch has no acknowledgement'};}return super.issueTransferFinishDestination(...args);}
 async attachmentStorageMutations(){return{puts:this.attachmentPutCount,deletes:this.attachmentDeleteCount};}
 async attachmentPuts(){return{puts:this.attachmentPutCount};}
 async armAttachmentWrite(){this.pauseWrite=true;this.writePaused=false;this.writeCompleted=false;}
 async attachmentWriteStatus(){return{paused:this.writePaused,completed:this.writeCompleted};}
 async resumeAttachmentWrite(){this.releaseWrite?.();this.releaseWrite=undefined;}
 async driftTransferAudience(){await this.addMember('destination-audience-drift','member');}
 async dropCancellationAcknowledgement(stage:'destination'|'source'){this.lostCancellationAck=stage;}
 protected override async beforeIssueTransferCancellation(){}
 protected override async afterIssueTransferDestinationCancellation(){if(this.lostCancellationAck==='destination'){this.lostCancellationAck=null;throw Error('Synthetic destination cancellation acknowledgement lost after durable fence');}}
 protected override async afterIssueTransferSourceCancellation(){if(this.lostCancellationAck==='source'){this.lostCancellationAck=null;throw Error('Synthetic source cancellation acknowledgement lost after durable unlock');}}
 async armAttachmentRead(){this.pauseRead=true;this.readPaused=false;}
 async attachmentReadStatus(){return {paused:this.readPaused};}
 async resumeAttachmentRead(){this.releaseRead?.();this.releaseRead=undefined;}
 async revokeTransferAdmin(){this.ctx.storage.sql.exec('DELETE FROM members WHERE user_id=?','transfer-admin');}
 async restoreTransferAdmin(){await this.addMember('transfer-admin','owner');}
 async cancellationAudit(requestId:string){const row=this.ctx.storage.sql.exec<{document:string}>('SELECT document FROM issue_transfer_cancellations WHERE request_id=?',requestId).toArray()[0];if(!row)return null;const value=JSON.parse(row.document) as {actorId:string;cancelId:string;phase:string;manifest:{actorId:string}};return{actorId:value.actorId,cancelId:value.cancelId,phase:value.phase,originalActorId:value.manifest.actorId};}
 async authoritySnapshot(){const writers=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='git_task_writers'").toArray().length?this.ctx.storage.sql.exec<{task_id:string;user_id:string}>('SELECT task_id,user_id FROM git_task_writers ORDER BY task_id').toArray():[];const transfers=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='issue_transfer_receipts'").toArray().length?this.ctx.storage.sql.exec<{document:string}>('SELECT document FROM issue_transfer_receipts ORDER BY request_id').toArray().map(row=>{const value=JSON.parse(row.document) as {phase:string;destinationNumber?:number;manifest:{requestId:string}};return {requestId:value.manifest.requestId,phase:value.phase,...(value.destinationNumber===undefined?{}:{destinationNumber:value.destinationNumber})};}):[];const prefs=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='thread_preferences'").toArray().length?this.ctx.storage.sql.exec<{actor_id:string;subject:string}>('SELECT actor_id,subject FROM thread_preferences ORDER BY actor_id,subject').toArray():[];return{unexpectedTransferError:this.unexpectedTransferError,writers,transfers,preferences:prefs,members:this.ctx.storage.sql.exec<{user_id:string;role:string}>('SELECT user_id,role FROM members ORDER BY user_id').toArray(),tasks:Object.keys((await this.getState()).tasks),issues:this.ctx.storage.sql.exec<{number:number;title:string}>('SELECT number,title FROM issues ORDER BY number').toArray()};}
}
export default{
 async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){
  const url=new URL(request.url),source=env.REPOSITORY_CONTROLLER.getByName(`project:${transferSourceId}`) as unknown as IssueTransferPrivacyFixture,destination=env.REPOSITORY_CONTROLLER.getByName(`project:${transferDestinationId}`) as unknown as IssueTransferPrivacyFixture;
  if(url.pathname==='/fixture/seed'){
   const issue=await source.seedTransfer('source');await destination.seedTransfer('destination');const tokens:Record<string,{secret:string;id:string}>={};
   for(const [name,user,scope,character,pinned] of [['admin','transfer-admin','full','a',false],['pinned','transfer-admin','full','p',true],['read','transfer-admin','read','r',false],['sourceOnly','source-only-admin','full','s',false],['destinationOnly','destination-only-admin','full','d',false],['member','source-member','full','m',false]] as const){
    const key=await accountKeyFor(user),account=accountOf(env,key);await account.setProfile({handle:user,displayName:user,bio:'',joinedAt:new Date().toISOString()});const secret=`fgt_${key}_${character.repeat(32)}`,saved=await account.createApiToken(user,'Synthetic transfer '+name,secret,{scope,...(pinned?{repo:transferSourceId}:{})});tokens[name]={secret,id:saved.id};for(const id of user==='destination-only-admin'?[transferDestinationId]:user==='transfer-admin'?[transferSourceId,transferDestinationId]:[transferSourceId])await account.addProject({id,name:id===transferSourceId?'Private transfer source':'Private transfer destination',role:user==='source-member'?'member':'owner',kind:'repository'});
   }
   const authority=env.AUTHORITY.get(env.AUTHORITY.idFromName('authority')),redirectUri='https://fixture.example/callback',verifier='v'.repeat(43);
   const app=await authority.call({method:'POST',pathname:'/api/oauth/apps',search:'',body:{name:'Synthetic transfer app',redirectUris:[redirectUri],scopes:['issues:read','issues:write']},userId:'transfer-admin'});if(app.status!==201)throw Error('Synthetic OAuth app setup failed');const {clientId}=JSON.parse(app.body) as {clientId:string};
   const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),codeChallenge=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
   const grant=await authority.call({method:'POST',pathname:'/api/oauth/install',search:'',body:{clientId,redirectUri,repositoryId:transferSourceId,scope:'issues:read issues:write',codeChallenge},userId:'transfer-admin'});if(grant.status!==200)throw Error('Synthetic OAuth installation failed');const {code}=JSON.parse(grant.body) as {code:string};
   const exchanged=await authority.call({method:'POST',pathname:'/api/oauth/token',search:'',body:{grant_type:'authorization_code',clientId,redirectUri,code,codeVerifier:verifier}});if(exchanged.status!==200)throw Error('Synthetic OAuth exchange failed');const {access_token:oauth}=JSON.parse(exchanged.body) as {access_token:string};
   return Response.json({issue,tokens,oauth,source:transferSourceId,destination:transferDestinationId});
  }
  const target=url.searchParams.get('target')==='destination'?destination:source;
  if(url.pathname==='/fixture/new-issue')return Response.json(await source.freshSourceIssue());
  if(url.pathname==='/fixture/hook-arm'){const stage=url.searchParams.get('stage');if(stage!=='freeze'&&stage!=='reservation'&&stage!=='activation')return Response.json({error:'Invalid fixture hook'},{status:400});await target.armHook(stage);return Response.json({armed:true});}
  if(url.pathname==='/fixture/hook-status')return Response.json(await target.hookStatus());
  if(url.pathname==='/fixture/hook-resume'){await target.resumeHook();return Response.json({resumed:true});}
  if(url.pathname==='/fixture/finalization-dispatch-loss'){await target.loseNextFinalizationDispatch();return Response.json({armed:true});}
  if(url.pathname==='/fixture/lost-ack'){const stage=url.searchParams.get('stage');if(stage!=='reservation'&&stage!=='activation'&&stage!=='finalization')return Response.json({error:'Invalid fixture acknowledgement'},{status:400});await target.dropTransferAcknowledgement(stage);return Response.json({armed:true});}
  if(url.pathname==='/fixture/storage-count')return Response.json(await target.attachmentStorageMutations());
  if(url.pathname==='/fixture/put-count')return Response.json(await target.attachmentPuts());
  if(url.pathname==='/fixture/write-arm'){await target.armAttachmentWrite();return Response.json({armed:true});}
  if(url.pathname==='/fixture/write-status')return Response.json(await target.attachmentWriteStatus());
  if(url.pathname==='/fixture/write-resume'){await target.resumeAttachmentWrite();return Response.json({resumed:true});}
  if(url.pathname==='/fixture/audience-drift'){await destination.driftTransferAudience();return Response.json({changed:true});}
  if(url.pathname==='/fixture/cancel-lost-ack'){const stage=url.searchParams.get('stage');if(stage!=='destination'&&stage!=='source')return Response.json({error:'Invalid cancellation acknowledgement'},{status:400});await target.dropCancellationAcknowledgement(stage);return Response.json({armed:true});}
  if(url.pathname==='/fixture/replacement-admin'){
   await source.addMember('replacement-admin','owner');await destination.addMember('replacement-admin','owner');const account=accountOf(env,await accountKeyFor('replacement-admin'));await account.setProfile({handle:'replacement-admin',displayName:'Replacement administrator',bio:'',joinedAt:new Date().toISOString()});for(const id of [transferSourceId,transferDestinationId])await account.addProject({id,name:'Transfer recovery fixture',role:'owner',kind:'repository'});return Response.json({granted:true});
  }
  if(url.pathname==='/fixture/cancellation-audit')return Response.json(await target.cancellationAudit(url.searchParams.get('request')!));
  if(url.pathname==='/fixture/read-arm'){await target.armAttachmentRead();return Response.json({armed:true});}
  if(url.pathname==='/fixture/read-status')return Response.json(await target.attachmentReadStatus());
  if(url.pathname==='/fixture/read-resume'){await target.resumeAttachmentRead();return Response.json({resumed:true});}
  if(url.pathname==='/fixture/revoke'){await target.revokeTransferAdmin();return Response.json({revoked:true});}
  if(url.pathname==='/fixture/regrant'){await target.restoreTransferAdmin();return Response.json({restored:true});}
  if(url.pathname==='/fixture/authority')return Response.json(await target.authoritySnapshot());
  return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
 }
};
