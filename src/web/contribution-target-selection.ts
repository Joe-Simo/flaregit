import {z} from "zod";
import {isSafeRef} from "../core/sanitize";
const targetSchema=z.object({ref:z.string().refine(value=>value.startsWith("refs/heads/")&&isSafeRef(value)),branch:z.string().refine(isSafeRef),acceptedCommit:z.string().regex(/^[a-f0-9]{40}$/).refine(value=>!/^0{40}$/.test(value)),acceptedVersion:z.number().int().nonnegative().safe(),policyVersion:z.number().int().positive().safe()}).strict().refine(value=>value.ref===`refs/heads/${value.branch}`);
export type ContributionTarget=z.infer<typeof targetSchema>;
export type ContributionTargetExpectation=Omit<ContributionTarget,"branch">;
export function parseContributionTargets(value:unknown):{targets:ContributionTarget[];truncated:boolean}{return z.object({targets:z.array(targetSchema).max(200),truncated:z.boolean()}).strict().parse(value);}
export function contributionExpectation(target:ContributionTarget):ContributionTargetExpectation{const {branch:_branch,...expectation}=targetSchema.parse(target);return expectation;}
export interface ContributionCreationIntent{signature:string;taskId:string;payload:{taskId:string;goal:string;dependsOn?:string;issue?:number;expectedTarget?:ContributionTargetExpectation}}
/** Replay returns the original frozen target tuple, including after root advance.
 * Changing user intent requires a new explicit request; never infer primary.
 */
export function contributionCreationIntent(previous:ContributionCreationIntent|null,input:{goal:string;dependsOn:string|null;issue:number|null;target:ContributionTarget|null;signatureOverride?:string},newTaskId:()=>string):ContributionCreationIntent{
 const signature=input.signatureOverride??JSON.stringify({goal:input.goal,dependsOn:input.dependsOn,issue:input.issue,target:input.target?contributionExpectation(input.target):null});if(previous?.signature===signature)return previous;
 const taskId=newTaskId();return{signature,taskId,payload:{taskId,goal:input.goal,...(input.dependsOn?{dependsOn:input.dependsOn}:{}),...(input.issue!==null?{issue:input.issue}:{}),...(input.target?{expectedTarget:contributionExpectation(input.target)}:{})}};
}
