import {DurableObject} from 'cloudflare:workers';
import {IssueAttachments,type IssueAttachmentScope,type IssueAttachmentInput} from '../../src/server/issue-attachments';
import {copyIssueTransferAttachment,type TransferByteInput} from '../../src/server/issue-transfer-bytes';
interface FixtureEnv{BYTES:DurableObjectNamespace<TransferByteFixture>;BUCKET:R2Bucket}
export class TransferByteFixture extends DurableObject<FixtureEnv>{
 private store=new IssueAttachments(this.ctx.storage);
 private latePut=false;private lostDelete=false;private pauseDelete=false;private deleteWaiting=false;private releaseDelete:(()=>void)|undefined;private delayed?:{key:string;bytes:Uint8Array<ArrayBuffer>;options?:R2PutOptions};
 private bucket(){const fixture=this,real=this.env.BUCKET;return new Proxy(real,{get(target,property){if(property==='put')return async(key:string,value:Parameters<R2Bucket['put']>[1],options?:R2PutOptions)=>{if(fixture.latePut&&key.includes('/pending/')){fixture.latePut=false;if(!(value instanceof ReadableStream))throw Error('Actual streaming input required');const bytes=new Uint8Array(await new Response(value).arrayBuffer());if(bytes.length>1024)throw Error('Synthetic delayed write exceeds its bound');fixture.delayed={key,bytes,options};throw Error('Original atomic put acknowledgement unknown');}return target.put(key,value,options);};if(property==='delete')return async(key:string|string[])=>{if(fixture.pauseDelete){fixture.pauseDelete=false;fixture.deleteWaiting=true;await new Promise<void>(resolve=>{fixture.releaseDelete=resolve;});fixture.deleteWaiting=false;}await target.delete(key);if(fixture.lostDelete){fixture.lostDelete=false;throw Error('Original delete acknowledgement unknown');}};const member=Reflect.get(target,property) as unknown;return typeof member==='function'?member.bind(target):member;}});}
 async armCleanupFault(kind:string){if(kind==='put')this.latePut=true;if(kind==='delete')this.lostDelete=true;if(kind==='pause')this.pauseDelete=true;}
 async finishLatePut(){if(this.delayed){await this.env.BUCKET.put(this.delayed.key,this.delayed.bytes,this.delayed.options);this.delayed=undefined;}}
 async deletionWaiting(){return this.deleteWaiting;}
 async releaseDeletion(){this.releaseDelete?.();this.releaseDelete=undefined;}
 private async cleanupAuthority(nonce:string){if(await this.ctx.storage.get('nonce')!==nonce||await this.ctx.storage.get('cancelled')!==true)throw Error('Exact cancelled destination scope required');}
 async cancelTransfer(scope:IssueAttachmentScope,ids:string[],nonce:string){if(await this.ctx.storage.get('nonce')!==nonce)throw Error('Original nonce changed');await this.ctx.storage.put('cancelled',true);return this.store.cancelTransfer(scope,ids,this.bucket(),()=>this.cleanupAuthority(nonce));}
 async inspectCancellation(scope:IssueAttachmentScope,ids:string[],nonce:string){
  const snapshot=()=>this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name").toArray().map(row=>({name:row.name,rows:this.ctx.storage.sql.exec(`SELECT * FROM "${row.name.replaceAll('"','""')}" ORDER BY rowid`).toArray()}));
  const before=JSON.stringify(snapshot()),result=await this.store.inspectCancelledTransferCleanup(scope,ids,()=>this.cleanupAuthority(nonce));return{result,unchanged:JSON.stringify(snapshot())===before};
 }
 async prepareAfterCancellation(scope:IssueAttachmentScope,input:IssueAttachmentInput){return this.store.prepare(scope,input,{userId:'owner',displayName:'Synthetic transfer operator'},()=>{});}
 async addSharedReference(scope:IssueAttachmentScope,input:IssueAttachmentInput,bytes:Uint8Array){this.store.prepare(scope,input,{userId:'owner',displayName:'Other active reference'},()=>{});await this.store.upload(scope,input.id,new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),bytes.length,this.bucket(),async()=>{},'owner');}

 async authorize(){if(await this.ctx.storage.get('cancelled')||await this.ctx.storage.get('revoked'))throw Error('Fixture transfer admin scope revoked');}
 async prepare(scope:IssueAttachmentScope,input:IssueAttachmentInput,nonce:string){await this.ctx.storage.put({nonce,phase:'prepared'});return this.store.prepare(scope,input,{userId:'owner',displayName:'Synthetic transfer operator'},()=>{});}
 async seedSource(scope:IssueAttachmentScope,input:IssueAttachmentInput,bytes:Uint8Array){this.store.prepare(scope,input,{userId:'uploader',displayName:'Original uploader'},()=>{});await this.store.upload(scope,input.id,new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),bytes.length,this.bucket(),()=>this.authorize(),'uploader');return this.store.transferSource(scope,input.id);}
 async assertAttempt(nonce:string){if(await this.ctx.storage.get('nonce')!==nonce)throw Error('Original nonce ownership changed');}
 async markUnknown(nonce:string){await this.assertAttempt(nonce);await this.ctx.storage.put('phase','unknown');}
 async replaceNonce(){await this.ctx.storage.put('nonce',crypto.randomUUID());}
 async download(scope:IssueAttachmentScope,id:string,producerIdentity:string){await this.ctx.storage.put('downloads',Number(await this.ctx.storage.get('downloads')??0)+1);return this.store.downloadForTransfer(scope,id,producerIdentity,this.bucket(),()=>this.authorize());}
 async upload(scope:IssueAttachmentScope,id:string,stream:ReadableStream<Uint8Array>,nonce:string,loseAck:boolean){const check=async()=>{await this.authorize();await this.assertAttempt(nonce);};await check();await this.ctx.storage.put('uploads',Number(await this.ctx.storage.get('uploads')??0)+1);const result=await this.store.upload(scope,id,stream,undefined,this.bucket(),check,'owner');if(loseAck)throw Error('Synthetic upload acknowledgement lost');return result;}
 async confirm(scope:IssueAttachmentScope,id:string,nonce:string){const check=async()=>{await this.authorize();await this.assertAttempt(nonce);};const result=await this.store.confirmForTransfer(scope,id,this.bucket(),check);await check();return result;}
 async read(scope:IssueAttachmentScope,id:string){const result=await this.store.download(scope,id,this.bucket(),()=>this.authorize());return new Uint8Array(await new Response(result.body).arrayBuffer());}
 async readRetained(scope:IssueAttachmentScope,id:string){const result=await this.store.download(scope,id,this.env.BUCKET,async()=>{});return new Uint8Array(await new Response(result.body).arrayBuffer());}
 async stats(scope?:IssueAttachmentScope,id?:string){return{attachmentPhase:scope&&id?this.store.list(scope).find(attachment=>attachment.id===id)?.phase:undefined,uploads:await this.ctx.storage.get<number>('uploads')??0,downloads:await this.ctx.storage.get<number>('downloads')??0,phase:await this.ctx.storage.get<'prepared'|'unknown'>('phase')};}
}
export default{async fetch(request:Request,env:FixtureEnv){
 const scenario=new URL(request.url).searchParams.get('scenario')??'success',source=env.BYTES.getByName('source-'+scenario),destination=env.BYTES.getByName('destination-'+scenario),bytes=new Uint8Array([0,255,128,10,13,42]),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
 const sourceScope={projectId:'p123456789abc',incarnation:crypto.randomUUID(),issue:1,issueCreatedAt:'2026-10-08T12:00:00.000Z',issueAuthor:'Original issue author'},destinationScope={projectId:'p999999999999',incarnation:crypto.randomUUID(),issue:2,issueCreatedAt:'2026-10-08T12:00:01.000Z',issueAuthor:'Transferred issue author'},original={id:crypto.randomUUID(),name:'binary.dat',sha256,size:bytes.length},destinationId=crypto.randomUUID(),nonce=crypto.randomUUID();
 const originalProof=await source.seedSource(sourceScope,original,bytes);await destination.prepare(destinationScope,{...original,id:destinationId},nonce);
 if(scenario==='cleanup-late-put')await destination.armCleanupFault('put');
 const input:TransferByteInput={transferId:crypto.randomUUID(),manifestDigest:'f'.repeat(64),attemptNonce:nonce,actorId:'owner',sourceScope,destinationScope,attachment:{...original,destinationId,authorId:originalProof.authorId,author:originalProof.author,createdAt:originalProof.createdAt,producerIdentity:originalProof.producerIdentity}};
 let cancelled=false;
 const callbacks={authorize:async()=>{await source.authorize();await destination.authorize();},assertAttempt:()=>destination.assertAttempt(nonce),markUnknown:()=>destination.markUnknown(nonce),download:async()=>{
  const response=await source.download(sourceScope,original.id,originalProof.producerIdentity),reader=response.body.getReader();
  let pulls=0;const body=new ReadableStream<Uint8Array>({async pull(controller){if(scenario==='cancel'&&pulls++>0){cancelled=true;await reader.cancel('Synthetic source cancellation');controller.error(Error('Source stream cancelled'));return;}const next=await reader.read();if(next.done){controller.close();return;}const chunk=next.value.slice();if(scenario==='digest')chunk[0]=(chunk[0]??0)^1;controller.enqueue(chunk);},async cancel(reason){cancelled=true;await reader.cancel(reason);}});
  if(scenario==='nonce')await destination.replaceNonce();return{attachment:response.attachment,body};
 },upload:(body:ReadableStream<Uint8Array>)=>destination.upload(destinationScope,destinationId,body,nonce,scenario==='lost-ack'),confirm:()=>destination.confirm(destinationScope,destinationId,nonce)};
 let error:string|undefined,receipt:unknown;
 try{receipt=await copyIssueTransferAttachment(input,callbacks);}catch(cause){error=String(cause);}
 if(scenario==='lost-ack')receipt=await copyIssueTransferAttachment({...input,mode:'recover'},callbacks);
 if(scenario.startsWith('cleanup')){
  let sharedScope:IssueAttachmentScope|undefined,sharedId:string|undefined;
  if(scenario==='cleanup-shared'){sharedScope={...destinationScope,issue:3,issueCreatedAt:'2026-10-08T12:00:02.000Z'};sharedId=crypto.randomUUID();await destination.addSharedReference(sharedScope,{...original,id:sharedId},bytes);}
  if(scenario==='cleanup-delete-ack')await destination.armCleanupFault('delete');
  if(scenario==='cleanup-overlap')await destination.armCleanupFault('pause');
  const running=destination.cancelTransfer(destinationScope,[destinationId],nonce);let overlap:unknown;
  if(scenario==='cleanup-overlap'){for(let i=0;i<100&&!await destination.deletionWaiting();i++)await new Promise(resolve=>setTimeout(resolve,1));if(!await destination.deletionWaiting())throw Error('Owned deletion did not pause');overlap=await destination.cancelTransfer(destinationScope,[destinationId],nonce);await destination.releaseDeletion();}
  const first=await running;let second:unknown;
  if(scenario==='cleanup-late-put'){await destination.finishLatePut();second=await destination.cancelTransfer(destinationScope,[destinationId],nonce);}
  if(scenario==='cleanup-delete-ack')second=await destination.cancelTransfer(destinationScope,[destinationId],nonce);
  let recreateDenied=false;try{await destination.prepareAfterCancellation(destinationScope,{...original,id:destinationId});}catch{recreateDenied=true;}
  const sourceBytes=Array.from(await source.read(sourceScope,original.id)),sharedBytes=sharedScope&&sharedId?Array.from(await destination.readRetained(sharedScope,sharedId)):undefined;
  const inspection=await destination.inspectCancellation(destinationScope,[destinationId],nonce);return Response.json({first,second,overlap,recreateDenied,sourceBytes,sharedBytes,inspection,phase:(await destination.stats(destinationScope,destinationId)).attachmentPhase});
 }
 const copied=receipt?Array.from(await destination.read(destinationScope,destinationId)):null;
 return Response.json({receipt,error,cancelled,copied,source:await source.stats(),destination:await destination.stats(destinationScope,destinationId)});
}};
