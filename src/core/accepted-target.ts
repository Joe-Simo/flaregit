import {z} from 'zod';
import {isSafeRef} from './sanitize';
import type {AcceptedTargetBinding} from '../server/accepted-target-binding';
const nonzeroCommit=z.string().regex(/^[a-f0-9]{40}$/).refine(value=>!/^0{40}$/.test(value),'Committed accepted history is required');
const version=z.number().int().nonnegative().safe();
const jsonRecord=z.record(z.string(),z.json());
const assertion=z.object({id:z.string(),description:z.string(),input:jsonRecord.optional(),expectedOutput:z.json().optional()}).strict();
const requirement=z.object({id:z.string(),title:z.string(),description:z.string(),version,status:z.enum(['approved','superseded','rejected']),assertions:z.array(assertion),originTaskId:z.string(),approvedAt:z.string(),clarifyingQuestion:z.string().optional(),policyPatch:jsonRecord.optional()}).strict();
/** Frozen repository-ledger binding only; provider inventories and current default refs are not targets. */
export const acceptedTargetSchema=z.object({projectId:z.string().min(1).max(128),incarnation:z.uuid(),canonicalRepoName:z.string().min(1).max(200),ref:z.string().refine(value=>value.startsWith('refs/heads/')&&isSafeRef(value)),branch:z.string().refine(value=>isSafeRef(value)),acceptedCommit:nonzeroCommit,acceptedVersion:version,requirements:z.array(requirement),policyVersion:version,policy:jsonRecord}).strict().refine(value=>value.ref===`refs/heads/${value.branch}`,'Accepted target branch and ref disagree');
export type FrozenAcceptedTarget=z.infer<typeof acceptedTargetSchema>;
function canonical(value:z.infer<ReturnType<typeof z.json>>):string{if(Array.isArray(value))return `[${value.map(item=>canonical(item)).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;return JSON.stringify(value);}
/** Every contribution in one integration batch must carry the same explicit frozen target. */
export function assertCompatibleAcceptedTargetBatch(values:readonly AcceptedTargetBinding[]):FrozenAcceptedTarget{
 if(values.length===0)throw Error('An integration batch needs an explicit frozen accepted target');
 const targets=values.map(value=>acceptedTargetSchema.parse(value)),first=targets[0]!;
 const fingerprint=(target:FrozenAcceptedTarget)=>canonical(z.json().parse(target));
 const expected=fingerprint(first);
 if(targets.some(target=>fingerprint(target)!==expected))throw Error('Integration batch mixes accepted target scope, base, version, requirements or policy');
 return first;
}
