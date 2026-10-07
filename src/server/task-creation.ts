import {z} from "zod";
import {isSafeRef} from "../core/sanitize";
export const taskCreationTargetSchema=z.object({ref:z.string().refine(value=>value.startsWith("refs/heads/")&&isSafeRef(value)),acceptedCommit:z.string().regex(/^[a-f0-9]{40}$/).refine(value=>!/^0{40}$/.test(value)).nullable(),acceptedVersion:z.number().int().nonnegative().safe(),policyVersion:z.number().int().nonnegative().safe()}).strict().refine(value=>value.acceptedCommit!==null||value.acceptedVersion===0,"Unborn target requires version zero");
export const externalToolProvenanceSchema=z.object({execution:z.literal("external"),tool:z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9 ._+-]*$/),sessionId:z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)}).strict();
export const taskCreationInputSchema=z.object({goal:z.string().min(1).max(300),dependsOn:z.string().regex(/^[a-z0-9][a-z0-9-]{2,100}$/).nullable(),issue:z.number().int().positive().nullable(),expectedTarget:taskCreationTargetSchema.optional(),externalTool:externalToolProvenanceSchema.optional()}).strict();
export type TaskCreationInput=z.infer<typeof taskCreationInputSchema>;
export function taskCreationPayload(input:TaskCreationInput):string{const parsed=taskCreationInputSchema.parse(input);return JSON.stringify({goal:parsed.goal,dependsOn:parsed.dependsOn,issue:parsed.issue,...(parsed.expectedTarget?{expectedTarget:parsed.expectedTarget}:{}),...(parsed.externalTool?{externalTool:parsed.externalTool}:{})});}

/** Origin claims are attested by the authenticated creator, never an arbitrary user. */
export function assertExternalTaskProvenance(input:TaskCreationInput,actorId:string|undefined,role:string|undefined,task:{externalTool?:{execution:"external";tool:string;sessionId:string;attestedBy:string};initiatedBy?:{id:string;type:string};contributor:{type:string}}):void{
 if(!input.externalTool){if(task.externalTool)throw Error("Unbound external tool provenance");return;}
 if(!actorId||(role!=="owner"&&role!=="member")||JSON.stringify(task.externalTool)!==JSON.stringify({...input.externalTool,attestedBy:actorId})||task.initiatedBy?.id!==actorId||task.initiatedBy.type!=="human"||task.contributor.type!=="human")throw Error("External tool provenance or attesting creator changed");
}
