import worker from '../../src/server/worker';
import {PrivateRecoveryOperations} from '../../src/server/private-recovery';
import {RepositoryController} from '../../src/server/durable-object';
import {accountOf,accountKeyFor} from '../../src/server/projects';
import type {LfsCredential} from '../../src/server/lfs-http';
import type {Env} from '../../src/server/env';
export class LfsHttpFixture extends RepositoryController {
 private waitingForLfsBytes=false;private lfsReadRequests=0;
 private dropNextAcknowledgment=false;private delayedWrite?:{key:string;bytes:Uint8Array<ArrayBuffer>;options?:R2PutOptions};private readonly realBucket:R2Bucket;
 constructor(ctx:DurableObjectState,env:Env){let fixture:LfsHttpFixture|undefined;const realBucket=env.EVIDENCE_BUCKET;
  const bucket=new Proxy(realBucket,{get(target,property){if(property==='put')return async(key:string,value:Parameters<R2Bucket['put']>[1],options?:R2PutOptions)=>{
   if(fixture?.dropNextAcknowledgment&&key.includes('/pending/')){fixture.dropNextAcknowledgment=false;if(!(value instanceof ReadableStream))throw Error('Streaming SDK input required');const reader=(value as ReadableStream<Uint8Array>).getReader(),chunks:Uint8Array[]= [];let size=0;for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1024){await reader.cancel();throw Error('Fault fixture transfer bound exceeded');}chunks.push(next.value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}fixture.delayedWrite={key,bytes,options};throw Error('Fixture SDK transport acknowledgment was lost before the delayed atomic PUT completed');}
   return target.put(key,value,options);
  };const member=Reflect.get(target,property) as unknown;return typeof member==='function'?member.bind(target):member;}});
  super(ctx,{...env,EVIDENCE_BUCKET:bucket});this.realBucket=realBucket;fixture=this;
 }
 async dropAcknowledgment(){this.dropNextAcknowledgment=true;}
 async completeLateWrite(){if(!this.delayedWrite)throw Error('A stopped full-body unknown write is required');const saved=this.delayedWrite;await this.realBucket.put(saved.key,saved.bytes,saved.options);this.delayedWrite=undefined;}
 async writeStatus(oid:string){const row=this.ctx.storage.sql.exec<{state:string}>("SELECT state FROM lfs_writes WHERE json_extract(state,'$.oid')=? LIMIT 1",oid).toArray()[0];if(!row)return null;const state=JSON.parse(row.state) as {phase:string;emittedBytes:number;producerClosed:boolean;writeSettled:boolean};return{phase:state.phase,emittedBytes:state.emittedBytes,producerClosed:state.producerClosed,writeSettled:state.writeSettled};}

 async seed(){await this.initialize({projectId:'p123456789abc',projectName:'LFS fixture',canonicalRepoName:'fixture-lfs',head:'a'.repeat(40),tree:'b'.repeat(40),verificationPolicy:{},ownerId:'owner'});await this.addMember('member','member');
  // Only native provider allocation is replaced. Writer membership and consent
  // use the production task record and durable original creator identity.
  const state=await this.getState();state.tasks['fixture-task']={id:'fixture-task',goal:'LFS fixture',contributor:{id:'owner',name:'Owner',type:'human'},baseCommit:'a'.repeat(40),currentCommit:'a'.repeat(40),status:'working',allowedScope:[],requirements:[],workspace:{repoName:'fixture-lfs-task',remote:'https://fixture.invalid',branch:'task/fixture-task'},checkpoints:[],createdAt:'2026-10-08',updatedAt:'2026-10-08'};
  state.tasks['member-task']={...state.tasks['fixture-task'],id:'member-task',contributor:{id:'member',name:'Creator',type:'human'},workspace:{repoName:'fixture-member-task',remote:'https://fixture.invalid',branch:'task/member-task'}};
  this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS git_task_writers(task_id TEXT PRIMARY KEY,user_id TEXT NOT NULL)');this.ctx.storage.sql.exec("INSERT INTO git_task_writers VALUES('fixture-task','owner'),('member-task','member')");
  new PrivateRecoveryOperations(this.ctx.storage).incarnation();
  await this.taskForkPermissionUpdate('member-task','member',{enabled:true,expectedRevision:0},{viaToken:false,sessionExpiresAt:Date.now()+60000});
 }
 async regrant(){const current=await this.taskForkPermission('member-task','member');const revoked=await this.taskForkPermissionUpdate('member-task','member',{enabled:false,expectedRevision:current.revision},{viaToken:false,sessionExpiresAt:Date.now()+60000});return this.taskForkPermissionUpdate('member-task','member',{enabled:true,expectedRevision:revoked.revision},{viaToken:false,sessionExpiresAt:Date.now()+60000});}
 async readStatus(){return{waiting:this.waitingForLfsBytes,reads:this.lfsReadRequests};}
 override async lfsUpload(object:{oid:string;size?:number},body:ReadableStream<Uint8Array>,actor:LfsCredential){let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;const fixture=this;const observed=new ReadableStream<Uint8Array>({async pull(controller){fixture.waitingForLfsBytes=true;fixture.lfsReadRequests++;try{reader??=body.getReader();const next=await reader.read();fixture.waitingForLfsBytes=false;if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){fixture.waitingForLfsBytes=false;controller.error(error);}},cancel:reason=>reader?reader.cancel(reason):body.cancel(reason)},{highWaterMark:0});try{return await super.lfsUpload(object,observed,actor);}finally{
  // Incoming RPC-stream cancellation can wait for its caller's response. Do
  // not make the response wait on that same cancellation handshake.
  void (reader?reader.cancel():body.cancel()).catch(()=>{});reader?.releaseLock();fixture.waitingForLfsBytes=false;
 }}
 async injectUnknownWrite(oid:string,receipt:boolean){const row=this.ctx.storage.sql.exec<{stage_key:string;size:number}>('SELECT stage_key,size FROM lfs_objects WHERE incarnation=? AND oid=?',new PrivateRecoveryOperations(this.ctx.storage).incarnation(),oid).toArray()[0];if(!row)throw Error('Reserved test object required');const writeId=crypto.randomUUID();this.ctx.storage.sql.exec('INSERT INTO lfs_writes VALUES(?,?)',row.stage_key,JSON.stringify({key:row.stage_key,writeId,oid,size:row.size,phase:'unknown'}));if(receipt)await this.env.EVIDENCE_BUCKET.put(row.stage_key,new Uint8Array([0,255,128,10,13,0,1]),{customMetadata:{oid,lfsWriteId:writeId}});}
 async deleteLfsRepository(){await this.beginRepositoryDeletion();await this.destroy();return{deleted:true};}
 async token(){const account=accountOf(this.env,await accountKeyFor('owner')),secret=`fgt_${await accountKeyFor('owner')}_${'a'.repeat(40)}`,record=await account.createApiToken('owner','LFS fixture',secret,{scope:'full'});return{secret,id:record.id};}
 async revoke(id:string){await accountOf(this.env,await accountKeyFor('owner')).revokeApiToken(id);}
 override async reserveRepositoryReadOperation(){return{allowed:true,existing:false,basis:'conservative_operation_envelope'} as const;}
}
let pointer:{oid:string;size:number}|undefined;
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as LfsHttpFixture;
 if(url.pathname==='/fixture/seed'){await repository.seed();return Response.json({seeded:true});}
 if(url.pathname==='/fixture/drop-ack'){await repository.dropAcknowledgment();return Response.json({armed:true});}
 if(url.pathname==='/fixture/complete-late-write'){await repository.completeLateWrite();return Response.json({completed:true});}
 if(url.pathname==='/fixture/write-status')return Response.json(await repository.writeStatus(url.searchParams.get('oid')!));
 if(url.pathname==='/fixture/unknown-write'){await repository.injectUnknownWrite(url.searchParams.get('oid')!,url.searchParams.get('receipt')==='true');return Response.json({injected:true});}
 if(url.pathname==='/fixture/delete-lfs'){try{return Response.json(await repository.deleteLfsRepository());}catch{return Response.json({deleted:false},{status:409});}}
 if(url.pathname==='/fixture/token')return Response.json(await repository.token());
 if(url.pathname==='/fixture/regrant')return Response.json(await repository.regrant());
 if(url.pathname==='/fixture/lfs-read-status')return Response.json(await repository.readStatus());
 if(url.pathname==='/fixture/session-upload'){try{await repository.lfsUpload({oid:url.searchParams.get('oid')!},request.body!,{userId:'owner',taskId:'member-task',sessionExpiresAt:Date.now()+60000});return Response.json({stored:true});}catch{return new Response('Original upload lineage was refused',{status:409});}}
 if(url.pathname==='/fixture/revoke'){await repository.revoke(url.searchParams.get('id')!);return Response.json({revoked:true});}
 if(url.pathname==='/fixture/public'){pointer=await request.json() as {oid:string;size:number};await repository.setRepositoryVisibility('public',true,'owner');return Response.json({public:true});}
 if(url.pathname==='/fixture/private'){await repository.setRepositoryVisibility('private',true,'owner');return Response.json({public:false});}
 const artifact={readCommit:async(hash:string)=>({hash,treeHash:'b'.repeat(40),parents:[]}),readTree:async()=>[{name:'binary.dat',hash:'c'.repeat(40),mode:'100644',type:'blob'}],readBlob:async()=>pointer?new Blob([`version https://git-lfs.github.com/spec/v1\noid sha256:${pointer.oid}\nsize ${pointer.size}\n`]):new Blob(['ordinary accepted file']),[Symbol.dispose]:()=>{}};
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})},ARTIFACTS:{get:async()=>artifact}} as unknown as Env,ctx);
}};
