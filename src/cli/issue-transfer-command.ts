import {z} from 'zod';
import {parseIssueNumber} from './issue-state-command';
import {issueTransferPendingSchema,transferFinalization,checkedTransferPreview,transferRequest,checkedTransferReceipt,transferCancellation,type IssueTransferRequest} from '../web/issue-transfer-intent';
const destination=z.string().regex(/^[a-z0-9]{12,16}$/);
/** Preview is read-only. Confirmation consumes the exact saved preview, never a
 * replacement snapshot. Original UUID replay never fetches another manifest. */
export async function prepareIssueTransferCommand(input:{repositoryId:string;issue:string|undefined;destination:string|undefined;confirmed:boolean;request?:string|true;manifest?:unknown},read:(route:string)=>Promise<unknown>){
 const number=parseIssueNumber(input.issue);if(!destination.safeParse(input.destination).success||input.destination===input.repositoryId)throw Error('--to requires another exact repository ID');const target=input.destination!;
 if(input.request!==undefined&&(typeof input.request!=='string'||!z.uuid().safeParse(input.request).success))throw Error('--request requires the full original UUID');
 const base=`/p/${input.repositoryId}/issues/${number}`;
 if(!input.confirmed){if(input.request!==undefined||input.manifest!==undefined)throw Error('Original transfer confirmation requires --confirm');return{kind:'preview' as const,preview:checkedTransferPreview(await read(`${base}/transfer-preview?destinationProjectId=${target}`),input.repositoryId,number,target)};}
 if(input.manifest===undefined)throw Error('--confirm requires --manifest FILE containing the exact reviewed preview; retries also require --request UUID');
 const preview=checkedTransferPreview(input.manifest,input.repositoryId,number,target),request=transferRequest(preview,typeof input.request==='string'?input.request:crypto.randomUUID());
 return{kind:'dispatch' as const,route:`${base}/transfer`,request,metadata:{repositoryId:input.repositoryId,issueNumber:number,action:'transfer',requestId:request.requestId,originalRequest:request,retry:`Reuse issue transfer for this source and --to ${target} --confirm --manifest the original preview file --request ${request.requestId}.`}};
}
export function issueTransferCommandReceipt(raw:unknown,repositoryId:string,issue:string,request:IssueTransferRequest){return checkedTransferReceipt(raw,repositoryId,parseIssueNumber(issue),request);}
export async function prepareIssueTransferCancellation(input:{repositoryId:string;issue:string|undefined;destination:string|undefined;confirmed:boolean;request?:string|true;cancelRequest?:string|true;manifest?:unknown}){
 if(!input.confirmed)throw Error('Transfer cancellation requires explicit --confirm');if(typeof input.request!=='string'||!z.uuid().safeParse(input.request).success)throw Error('Cancellation requires --request with the original transfer UUID');
 if(input.cancelRequest!==undefined&&(typeof input.cancelRequest!=='string'||!z.uuid().safeParse(input.cancelRequest).success))throw Error('--cancel-request requires the full original cancellation UUID');
 const command=await prepareIssueTransferCommand(input,async()=>{throw Error('Cancellation cannot read a replacement preview');});if(command.kind!=='dispatch')throw Error('Original transfer binding required');
 const request=transferCancellation(command.request,typeof input.cancelRequest==='string'?input.cancelRequest:crypto.randomUUID());
 return{route:`${command.route}/${command.request.requestId}/cancel`,request,metadata:{repositoryId:input.repositoryId,issueNumber:parseIssueNumber(input.issue),action:'cancel-transfer',requestId:request.requestId,cancelId:request.cancelId,originalCancellation:request,retry:`Reuse issue transfer cancel for this source and --to ${input.destination} --confirm --manifest the original preview --request ${request.requestId} --cancel-request ${request.cancelId}.`}};
}
export function prepareIssueTransferFinalization(input:{repositoryId:string;issue:string|undefined;confirmed:boolean;request?:string|true;finalizeRequest?:string|true;pending:unknown}){
 if(!input.confirmed)throw Error('Active transfer finalization requires explicit --confirm');const number=parseIssueNumber(input.issue),pending=issueTransferPendingSchema.parse(input.pending);
 if(!pending.canFinalizeActive||pending.activeDestinationNumber===undefined)throw Error('A fresh administrator active-destination descriptor is required');
 if(typeof input.request!=='string'||!z.uuid().safeParse(input.request).success||input.request!==pending.originalRequest.requestId)throw Error('--request must identify the exact original transfer');
 if(input.finalizeRequest!==undefined&&(typeof input.finalizeRequest!=='string'||!z.uuid().safeParse(input.finalizeRequest).success))throw Error('--finalize-request requires the full original finalization UUID');
 const request=transferFinalization(pending.originalRequest,pending.activeDestinationNumber,typeof input.finalizeRequest==='string'?input.finalizeRequest:crypto.randomUUID());
 return{route:`/p/${input.repositoryId}/issues/${number}/transfer/${request.requestId}/finalize`,request,original:pending.originalRequest,metadata:{repositoryId:input.repositoryId,issueNumber:number,action:'finalize-active-transfer',requestId:request.requestId,finalizeId:request.finalizeId,originalFinalization:request,retry:`Reuse issue transfer finalize for this issue --confirm --pending the original descriptor file --request ${request.requestId} --finalize-request ${request.finalizeId}.`}};
}
