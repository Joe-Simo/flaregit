import {z} from 'zod';
import {isSafeRef} from './sanitize';
import type {Requirement} from './types';
const nonzeroCommit=z.string().regex(/^[a-f0-9]{40}$/).refine(value=>!/^0{40}$/.test(value),'Committed accepted history is required');
const version=z.number().int().nonnegative().safe();
const jsonRecord=z.record(z.string(),z.json());
const assertion=z.object({id:z.string(),description:z.string(),input:jsonRecord.optional(),expectedOutput:z.json().optional()}).strict();
const requirement=z.object({id:z.string(),title:z.string(),description:z.string(),version,status:z.enum(['approved','superseded','rejected']),assertions:z.array(assertion),originTaskId:z.string(),approvedAt:z.string(),clarifyingQuestion:z.string().optional(),policyPatch:jsonRecord.optional()}).strict();
/** Frozen repository-ledger binding only; provider inventories and current default refs are not targets. */
export const acceptedRequirementsSchema=z.array(requirement);
const targetScope={projectId:z.string().min(1).max(128),incarnation:z.uuid(),canonicalRepoName:z.string().min(1).max(200),ref:z.string().refine(value=>value.startsWith('refs/heads/')&&isSafeRef(value)),branch:z.string().refine(value=>isSafeRef(value))};
const committedTargetSchema=z.object({...targetScope,kind:z.literal('committed').optional(),acceptedCommit:nonzeroCommit,acceptedVersion:version,requirements:acceptedRequirementsSchema,policyVersion:version,policy:jsonRecord}).strict().refine(value=>value.ref===`refs/heads/${value.branch}`,'Accepted target branch and ref disagree');
const unbornTargetSchema=z.object({...targetScope,kind:z.literal('unborn'),acceptedCommit:z.null(),acceptedVersion:z.literal(0),requirements:z.tuple([]),policyVersion:version,policy:jsonRecord}).strict().refine(value=>value.ref===`refs/heads/${value.branch}`,'Accepted target branch and ref disagree');
export const acceptedTargetSchema=z.union([committedTargetSchema,unbornTargetSchema]);
export type CommittedAcceptedTarget=Omit<z.infer<typeof committedTargetSchema>,"requirements"|"policy">&{requirements:Requirement[];policy:Record<string,unknown>};
export type UnbornAcceptedTarget=Omit<z.infer<typeof unbornTargetSchema>,"policy">&{policy:Record<string,unknown>};
export type FrozenAcceptedTarget=CommittedAcceptedTarget|UnbornAcceptedTarget;
function canonical(value:z.infer<ReturnType<typeof z.json>>):string{if(Array.isArray(value))return `[${value.map(item=>canonical(item)).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;return JSON.stringify(value);}
/** Every contribution in one integration batch must carry the same explicit frozen target. */
export function assertCompatibleAcceptedTargetBatch(values:readonly FrozenAcceptedTarget[]):FrozenAcceptedTarget{
 if(values.length===0)throw Error('An integration batch needs an explicit frozen accepted target');
 const targets=values.map(value=>acceptedTargetSchema.parse(value)),first=targets[0]!;
 const fingerprint=(target:FrozenAcceptedTarget)=>canonical(z.json().parse({...target,kind:target.kind??"committed"}));
 const expected=fingerprint(first);
 if(targets.some(target=>fingerprint(target)!==expected))throw Error('Integration batch mixes accepted target scope, base, version, requirements or policy');
 return first;
}

export const taskTargetGenerationSchema=z.object({eventId:z.uuid(),generation:z.number().int().positive().safe(),acceptedTarget:acceptedTargetSchema,baseCommit:nonzeroCommit.nullable(),currentCommit:nonzeroCommit,retargetedFrom:z.object({ref:z.string(),branch:z.string()}).strict().optional()}).strict();
export type TaskTargetGeneration=Omit<z.infer<typeof taskTargetGenerationSchema>,"acceptedTarget">&{acceptedTarget:FrozenAcceptedTarget};
/** A computed active generation never rewrites the task's original creation binding. */
export function effectiveTaskAcceptedTarget(task:{acceptedTarget?:FrozenAcceptedTarget;targetGeneration?:TaskTargetGeneration;baseCommit:string|null;currentCommit:string|null}):FrozenAcceptedTarget|undefined{
 if(!task.targetGeneration)return task.acceptedTarget;
 const generation=taskTargetGenerationSchema.parse(task.targetGeneration),original=task.acceptedTarget&&acceptedTargetSchema.parse(task.acceptedTarget);
 if(!original||generation.baseCommit!==task.baseCommit||generation.currentCommit!==task.currentCommit)throw Error('Active target generation does not match the contribution checkpoint');
 const next=generation.acceptedTarget;
 const changedBranch=next.ref!==original.ref||next.branch!==original.branch;
 if(next.projectId!==original.projectId||next.incarnation!==original.incarnation||next.canonicalRepoName!==original.canonicalRepoName||next.policyVersion<original.policyVersion||(!changedBranch&&next.acceptedVersion<original.acceptedVersion)||(changedBranch&&(!generation.retargetedFrom||generation.retargetedFrom.ref!==original.ref||generation.retargetedFrom.branch!==original.branch)))throw Error('Active target generation changed repository scope or accepted base');
 return structuredClone(next);
}

export function assertFrozenRequirementsMatch(expected:Requirement[],actual:Requirement[]):void{
 const normalized=(value:Requirement[])=>canonical(z.json().parse(JSON.parse(JSON.stringify(acceptedRequirementsSchema.parse(value)))));
 if(normalized(expected)!==normalized(actual))throw Error('Frozen candidate requirements differ from approved contribution context');
}
