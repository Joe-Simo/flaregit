import {z} from 'zod';
import {validateIssueMutationIdentity} from './issue-state-command';
const snapshot=z.object({stateRevision:z.number().int().nonnegative().safe(),canDeleteIssue:z.boolean()});
/** Deletion is explicit, revision-bound and replayable only with original flags. */
export async function prepareIssueDeletionCommand(input:{repositoryId:string;issue:string|undefined;confirmed:boolean;request?:string|true;revision?:string|true},read:()=>Promise<unknown>){
 if(!input.confirmed)throw Error('Issue deletion requires explicit --confirm');
 const identity=validateIssueMutationIdentity(input);let expectedRevision=identity.expectedRevision;
 if(identity.requestId===undefined){const current=snapshot.safeParse(await read());if(!current.success)throw Error('Issue revision or permission was not confirmed');if(!current.data.canDeleteIssue)throw Error('Issue removal is read-only for this credential');expectedRevision??=current.data.stateRevision;}
 if(expectedRevision===undefined)throw Error('Original issue removal revision required');const requestId=identity.requestId??crypto.randomUUID();
 return{route:`/p/${input.repositoryId}/issues/${identity.issueNumber}`,body:{expectedRevision,requestId,confirmed:true as const},metadata:{repositoryId:input.repositoryId,issueNumber:identity.issueNumber,action:'delete',requestId,expectedRevision,retry:`Reuse issue delete for this repository and issue with --confirm --request ${requestId} --revision ${expectedRevision} if the response is lost.`}};
}
/** 410 is a minimal authorized tombstone. Extra private fields and redirect-like
 * fields are discarded; this helper never fetches another repository. */
export async function readIssueViewResponse(response:Response,issueNumber:number){
 if(response.status===410){let value:unknown;try{value=await response.json();}catch{throw Error('Issue removal status was not confirmed');}const tombstone=z.object({number:z.literal(issueNumber),deleted:z.literal(true),transferred:z.literal(true).optional(),transfer:z.object({projectId:z.string().regex(/^[a-z0-9]{12,16}$/),number:z.number().int().positive().max(9999999)}).optional()}).refine(value=>value.transfer===undefined||value.transferred===true).safeParse(value);if(!tombstone.success)throw Error('Issue removal status was not confirmed');return tombstone.data;}
 if(!response.ok)throw Error(`Issue view answered ${response.status}`);return response.json() as Promise<unknown>;
}
