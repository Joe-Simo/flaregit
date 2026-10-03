import {z} from "zod";
export const taskCreationInputSchema=z.object({goal:z.string().min(1).max(300),dependsOn:z.string().regex(/^[a-z0-9][a-z0-9-]{2,40}$/).nullable(),issue:z.number().int().positive().nullable()}).strict();
export type TaskCreationInput=z.infer<typeof taskCreationInputSchema>;
export function taskCreationPayload(input:TaskCreationInput):string{const parsed=taskCreationInputSchema.parse(input);return JSON.stringify({goal:parsed.goal,dependsOn:parsed.dependsOn,issue:parsed.issue});}
