import {z} from 'zod';
const uuid=z.uuid();
const revision=z.number().int().nonnegative().safe();
const snapshot=z.object({stateRevision:revision,canStateWrite:z.boolean()});
export function parseIssueNumber(value:string|undefined){if(!value||! /^[1-9][0-9]{0,6}$/.test(value))throw Error('Issue number must be a positive integer of at most seven digits');return Number(value);}
export function validateIssueMutationIdentity(input:{issue:string|undefined;request?:string|true;revision?:string|true}){
 const issueNumber=parseIssueNumber(input.issue);
 if(input.request!==undefined&&(typeof input.request!=='string'||!uuid.safeParse(input.request).success))throw Error('--request requires the full original UUID');
 if(input.request!==undefined&&input.revision===undefined)throw Error('Replay requires both --request UUID and the original --revision N');
 let expectedRevision:number|undefined;
 if(input.revision!==undefined){if(typeof input.revision!=='string'||! /^(0|[1-9][0-9]*)$/.test(input.revision)||!revision.safeParse(Number(input.revision)).success)throw Error('--revision must be a nonnegative safe integer');expectedRevision=Number(input.revision);}
 return{issueNumber,requestId:typeof input.request==='string'?input.request:undefined,expectedRevision};
}
/** A replay preserves the original request, action, issue and revision. It never
 * derives a replacement revision from the issue's newer state. */
export async function prepareIssueStateCommand(input:{repositoryId:string;issue:string|undefined;action:'close'|'reopen';request?:string|true;revision?:string|true},read:()=>Promise<unknown>){
 const identity=validateIssueMutationIdentity(input);let expectedRevision=identity.expectedRevision;
 if(input.request===undefined){const current=snapshot.safeParse(await read());if(!current.success)throw Error('Issue state revision or permission was not confirmed');if(!current.data.canStateWrite)throw Error('Issue state is read-only for this credential');expectedRevision??=current.data.stateRevision;}
 if(expectedRevision===undefined)throw Error('Original issue state revision required');
 const requestId=identity.requestId??crypto.randomUUID(),issueNumber=identity.issueNumber,state=input.action==='close'?'closed' as const:'open' as const;
 return{route:`/p/${input.repositoryId}/issues/${issueNumber}`,body:{state,expectedRevision,requestId},metadata:{repositoryId:input.repositoryId,issueNumber,action:input.action,requestId,expectedRevision,retry:`Reuse issue ${input.action} for this repository and issue with --request ${requestId} --revision ${expectedRevision} if the response is lost.`}};
}
