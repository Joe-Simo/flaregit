import {createHash} from 'node:crypto';
import {z} from 'zod';
import {issueAttachmentInputSchema,type IssueAttachmentScope,type IssueAttachment} from './issue-attachments';

const scope=z.object({projectId:z.string().regex(/^[a-z0-9]{12,16}$/),incarnation:z.uuid(),issue:z.number().int().positive().safe(),issueCreatedAt:z.string().min(1).max(200),issueAuthor:z.string().min(1).max(256)}).strict();
export const transferByteInputSchema=z.object({transferId:z.uuid(),manifestDigest:z.string().regex(/^[a-f0-9]{64}$/),attemptNonce:z.uuid(),actorId:z.string().min(1).max(256),sourceScope:scope,destinationScope:scope,attachment:issueAttachmentInputSchema.extend({destinationId:z.uuid(),authorId:z.string().min(1).max(256),author:z.string().min(1).max(256),createdAt:z.string().min(1).max(200),producerIdentity:z.string().min(1).max(3000)}).strict(),mode:z.enum(['copy','recover']).default('copy')}).strict().refine(value=>value.sourceScope.projectId!==value.destinationScope.projectId&&value.attachment.id!==value.attachment.destinationId,'A separate destination repository and attachment identity are required');
export type TransferByteInput=z.input<typeof transferByteInputSchema>;
export type VerifiedTransferAttachment=IssueAttachment&{producerIdentity:string};
export interface TransferByteReceipt {transferId:string;manifestDigest:string;attemptNonce:string;sourceId:string;destinationId:string;sha256:string;size:number;sourceScope:IssueAttachmentScope;destinationScope:IssueAttachmentScope;verified:true}
/** Callbacks are trusted controller operations bound to the durable transfer and
 * nonce. No HTTP caller may supply callback authority or verification receipts. */
export interface TransferByteCallbacks{
 authorize():Promise<void>;
 assertAttempt():Promise<void>;
 markUnknown():Promise<void>;
 download():Promise<{attachment:VerifiedTransferAttachment;body:ReadableStream<Uint8Array>}>;
 upload(body:ReadableStream<Uint8Array>):Promise<unknown>;
 confirm():Promise<{attachment:VerifiedTransferAttachment}>;
}
export async function copyIssueTransferAttachment(value:TransferByteInput,callbacks:TransferByteCallbacks):Promise<TransferByteReceipt>{
 const input=transferByteInputSchema.parse(value),expected=input.attachment;
 const fence=async()=>{await callbacks.assertAttempt();await callbacks.authorize();await callbacks.assertAttempt();};
 const awaitFenced=async<T>(operation:()=>Promise<T>)=>{await fence();const result=await operation();await fence();return result;};
 const confirm=async()=>{
  const {attachment}=await awaitFenced(()=>callbacks.confirm());
  if(attachment.id!==expected.destinationId||attachment.name!==expected.name||attachment.sha256!==expected.sha256||attachment.size!==expected.size||attachment.phase!=='verified'||attachment.authorId!==input.actorId||JSON.stringify(scope.parse(attachment.scope))!==JSON.stringify(input.destinationScope)||attachment.producerIdentity!==JSON.stringify([attachment.id,attachment.scope,attachment.authorId,attachment.sha256,attachment.size]))throw Error('Destination attachment byte readback differs from the original transfer');
  return{transferId:input.transferId,manifestDigest:input.manifestDigest,attemptNonce:input.attemptNonce,sourceId:expected.id,destinationId:expected.destinationId,sha256:expected.sha256,size:expected.size,sourceScope:input.sourceScope,destinationScope:input.destinationScope,verified:true as const};
 };
 // Unknown dispatch only reads and reconciles the exact owned destination. A
 // controller may resume copying only after its previous execution is stopped.
 if(input.mode==='recover')return confirm();
 await fence();const source=await callbacks.download();try{await fence();}catch(error){await source.body.cancel(error).catch(()=>{});throw error;}
 const matches=source.attachment.id===expected.id&&source.attachment.name===expected.name&&source.attachment.sha256===expected.sha256&&source.attachment.size===expected.size&&source.attachment.authorId===expected.authorId&&source.attachment.author===expected.author&&source.attachment.createdAt===expected.createdAt&&source.attachment.phase==='verified'&&source.attachment.producerIdentity===expected.producerIdentity&&JSON.stringify(scope.parse(source.attachment.scope))===JSON.stringify(input.sourceScope);
 if(!matches){await source.body.cancel().catch(()=>{});throw Error('Frozen source attachment producer differs');}
 const reader=source.body.getReader(),hash=createHash('sha256');let size=0,validated=false,closed=false;
 const release=()=>{if(!closed){closed=true;reader.releaseLock();}};
 const stream=new ReadableStream<Uint8Array>({
  async pull(controller){try{await fence();const next=await reader.read();await fence();if(next.done){if(size!==expected.size||hash.digest('hex')!==expected.sha256)throw Error('Transferred attachment size or SHA-256 differs');validated=true;controller.close();release();return;}size+=next.value.byteLength;if(size>expected.size||size>5*1024*1024)throw Error('Transfer attachment exceeded its frozen bound');hash.update(next.value);controller.enqueue(next.value);}catch(error){await reader.cancel(error).catch(()=>{});release();controller.error(error);}},
  async cancel(reason){await reader.cancel(reason).catch(()=>{});release();},
 });
 try{
  await awaitFenced(()=>callbacks.markUnknown());
  await awaitFenced(()=>callbacks.upload(stream));
  if(!validated)throw Error('Destination did not consume and validate the original attachment stream');
  return await confirm();
 }finally{if(!closed){await reader.cancel('Original transfer attempt finished').catch(()=>{});release();}}
}
