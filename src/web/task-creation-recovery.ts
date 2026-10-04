import {z} from "zod";
import {apiJson} from "./api";
import {taskCreationInputSchema,type TaskCreationInput} from "../server/task-creation";
import {targetSchema,type ContributionTarget,type ContributionCreationIntent} from "./contribution-target-selection";
/** Only original server-recorded input is restored. Current branch lists cannot
 * retarget a saved request; local agent startup preference is intentionally absent.
 */
export function restoreTaskCreationRequest(taskId:string,raw:TaskCreationInput):{goal:string;dependsOn:string|null;issue:number|null;target:ContributionTarget|null;intent:ContributionCreationIntent}{
 if(!/^[a-z0-9][a-z0-9-]{2,100}$/.test(taskId))throw Error("Saved task creation identity is invalid");const input=taskCreationInputSchema.parse(raw),target=input.expectedTarget?{...input.expectedTarget,branch:input.expectedTarget.ref.slice("refs/heads/".length)}:null;
 const signature=JSON.stringify({goal:input.goal,dependsOn:input.dependsOn,issue:input.issue,target});return{goal:input.goal,dependsOn:input.dependsOn,issue:input.issue,target,intent:{signature,taskId,payload:{taskId,goal:input.goal,...(input.dependsOn?{dependsOn:input.dependsOn}:{}),...(input.issue!==null?{issue:input.issue}:{}),...(input.expectedTarget?{expectedTarget:structuredClone(input.expectedTarget)}:{})}}};
}
export interface PendingTaskCreation{taskId:string;input:TaskCreationInput;phase:"prepared"|"dispatching"|"fork_unknown"|"fork_confirmed"|"committed";canRestore:boolean;canRetry:boolean;providerAcknowledgementKnown?:boolean;capturedTarget?:ContributionTarget}
export function pendingCreationPhaseLabel(phase:PendingTaskCreation["phase"],providerAcknowledgementKnown=false):string{if(providerAcknowledgementKnown&&phase!=="committed"&&phase!=="prepared")return "Fork recorded · verification pending";return{prepared:"Request saved",dispatching:"Fork acknowledgement pending",fork_unknown:"Fork outcome unconfirmed",fork_confirmed:"Fork acknowledgement recorded",committed:"Change saved"}[phase];}

const rowSchema=z.object({taskId:z.string().regex(/^[a-z0-9][a-z0-9-]{2,100}$/),eventId:z.uuid(),input:taskCreationInputSchema,capturedTarget:targetSchema.optional(),phase:z.enum(["prepared","dispatching","fork_unknown","fork_confirmed","committed"]),credentialState:z.enum(["not_requested","issuance_unknown","cleanup_pending","revoked"]),providerAcknowledgementKnown:z.boolean(),isCreator:z.boolean(),hasTask:z.boolean(),sourceCurrent:z.boolean(),canRetryOriginal:z.boolean(),canRestore:z.boolean(),createdAt:z.number(),updatedAt:z.number()}).strict().refine(value=>!value.canRestore||value.isCreator&&value.canRetryOriginal);
export type TaskCreationRecoveryRow=z.infer<typeof rowSchema>;
export function parseTaskCreationRecovery(value:unknown){return z.object({creations:z.array(rowSchema).max(20),nextCursor:z.string().regex(/^[1-9][0-9]{0,15}$/).nullable(),complete:z.boolean()}).strict().parse(value);}
export async function readTaskCreationRecovery(projectId:string,signal:AbortSignal,cursor?:string){if(!/^[a-z0-9]{12,16}$/.test(projectId)||cursor!==undefined&&!/^[1-9][0-9]{0,15}$/.test(cursor))throw Error("Invalid saved creation scope");return parseTaskCreationRecovery(await apiJson<unknown>(`/p/${projectId}/task-creations${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`,{signal}));}
