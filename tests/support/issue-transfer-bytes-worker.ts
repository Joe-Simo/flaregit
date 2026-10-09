import {DurableObject} from 'cloudflare:workers';
import {IssueAttachments,type IssueAttachmentScope,type IssueAttachmentInput} from '../../src/server/issue-attachments';
import {copyIssueTransferAttachment,type TransferByteInput} from '../../src/server/issue-transfer-bytes';
interface FixtureEnv{BYTES:DurableObjectNamespace<TransferByteFixture>;BUCKET:R2Bucket}
export class TransferByteFixture extends DurableObject<FixtureEnv>{
 private store=new IssueAttachments(this.ctx.storage);
 async authorize(){if(await this.ctx.storage.get('revoked'))throw Error('Fixture transfer admin scope revoked');}
 async prepare(scope:IssueAttachmentScope,input:IssueAttachmentInput,nonce:string){await this.ctx.storage.put({nonce,phase:'prepared'});return this.store.prepare(scope,input,{userId:'owner',displayName:'Synthetic transfer operator'},()=>{});}
 async seedSource(scope:IssueAttachmentScope,input:IssueAttachmentInput,bytes:Uint8Array){this.store.prepare(scope,input,{userId:'uploader',displayName:'Original uploader'},()=>{});await this.store.upload(scope,input.id,new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),bytes.length,this.env.BUCKET,()=>this.authorize(),'uploader');return this.store.transferSource(scope,input.id);}
 async assertAttempt(nonce:string){if(await this.ctx.storage.get('nonce')!==nonce)throw Error('Original nonce ownership changed');}
 async markUnknown(nonce:string){await this.assertAttempt(nonce);await this.ctx.storage.put('phase','unknown');}
 async replaceNonce(){await this.ctx.storage.put('nonce',crypto.randomUUID());}
 async download(scope:IssueAttachmentScope,id:string,producerIdentity:string){await this.ctx.storage.put('downloads',Number(await this.ctx.storage.get('downloads')??0)+1);return this.store.downloadForTransfer(scope,id,producerIdentity,this.env.BUCKET,()=>this.authorize());}
 async upload(scope:IssueAttachmentScope,id:string,stream:ReadableStream<Uint8Array>,nonce:string,loseAck:boolean){const check=async()=>{await this.authorize();await this.assertAttempt(nonce);};await check();await this.ctx.storage.put('uploads',Number(await this.ctx.storage.get('uploads')??0)+1);const result=await this.store.upload(scope,id,stream,undefined,this.env.BUCKET,check,'owner');if(loseAck)throw Error('Synthetic upload acknowledgement lost');return result;}
 async confirm(scope:IssueAttachmentScope,id:string,nonce:string){const check=async()=>{await this.authorize();await this.assertAttempt(nonce);};const result=await this.store.confirmForTransfer(scope,id,this.env.BUCKET,check);await check();return result;}
 async read(scope:IssueAttachmentScope,id:string){const result=await this.store.download(scope,id,this.env.BUCKET,()=>this.authorize());return new Uint8Array(await new Response(result.body).arrayBuffer());}
 async stats(scope?:IssueAttachmentScope,id?:string){return{attachmentPhase:scope&&id?this.store.current(scope,id).phase:undefined,uploads:await this.ctx.storage.get('uploads')??0,downloads:await this.ctx.storage.get('downloads')??0,phase:await this.ctx.storage.get('phase')};}
}
export default{async fetch(request:Request,env:FixtureEnv){
 const scenario=new URL(request.url).searchParams.get('scenario')??'success',source=env.BYTES.getByName('source-'+scenario),destination=env.BYTES.getByName('destination-'+scenario),bytes=new Uint8Array([0,255,128,10,13,42]),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
 const sourceScope={projectId:'p123456789abc',incarnation:crypto.randomUUID(),issue:1,issueCreatedAt:'2026-10-08T12:00:00.000Z',issueAuthor:'Original issue author'},destinationScope={projectId:'p999999999999',incarnation:crypto.randomUUID(),issue:2,issueCreatedAt:'2026-10-08T12:00:01.000Z',issueAuthor:'Transferred issue author'},original={id:crypto.randomUUID(),name:'binary.dat',sha256,size:bytes.length},destinationId=crypto.randomUUID(),nonce=crypto.randomUUID();
 const originalProof=await source.seedSource(sourceScope,original,bytes);await destination.prepare(destinationScope,{...original,id:destinationId},nonce);
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
 const copied=receipt?Array.from(await destination.read(destinationScope,destinationId)):null;
 return Response.json({receipt,error,cancelled,copied,source:await source.stats(),destination:await destination.stats(destinationScope,destinationId)});
}};
