import {z} from "zod";
import {isSafeRef} from "../core/sanitize";
export const taskCreationTargetSchema=z.object({ref:z.string().refine(value=>value.startsWith("refs/heads/")&&isSafeRef(value)),acceptedCommit:z.string().regex(/^[a-f0-9]{40}$/).refine(value=>!/^0{40}$/.test(value)).nullable(),acceptedVersion:z.number().int().nonnegative().safe(),policyVersion:z.number().int().nonnegative().safe()}).strict().refine(value=>value.acceptedCommit!==null||value.acceptedVersion===0,"Unborn target requires version zero");
export const taskCreationInputSchema=z.object({goal:z.string().min(1).max(300),dependsOn:z.string().regex(/^[a-z0-9][a-z0-9-]{2,100}$/).nullable(),issue:z.number().int().positive().nullable(),expectedTarget:taskCreationTargetSchema.optional()}).strict();
export type TaskCreationInput=z.infer<typeof taskCreationInputSchema>;
export function taskCreationPayload(input:TaskCreationInput):string{const parsed=taskCreationInputSchema.parse(input);return JSON.stringify({goal:parsed.goal,dependsOn:parsed.dependsOn,issue:parsed.issue,...(parsed.expectedTarget?{expectedTarget:parsed.expectedTarget}:{})});}
