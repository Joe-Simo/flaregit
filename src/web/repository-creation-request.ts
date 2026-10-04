import {z} from "zod";
import {isSafeRef} from "../core/sanitize";
export const repositoryCreationRequestSchema=z.object({kind:z.literal("repository"),initialization:z.literal("readme"),requestId:z.uuid(),name:z.string().trim().min(1).max(60),defaultBranch:z.string().min(1).max(200).refine(value=>isSafeRef(value)&&!value.startsWith("refs/")),description:z.string().max(300).optional()}).strict();
export type RepositoryCreationRequest=z.infer<typeof repositoryCreationRequestSchema>;
/** A creation UUID owns one frozen initialization request, never a second SDK create. */
export function repositoryCreationRequest(previous:RepositoryCreationRequest|null,fields:{name:string;defaultBranch:string;description:string},newId:()=>string):RepositoryCreationRequest{
 const body={kind:"repository" as const,initialization:"readme" as const,requestId:previous?.requestId??newId(),name:fields.name,defaultBranch:fields.defaultBranch,description:fields.description};const parsed=repositoryCreationRequestSchema.parse(body);if(previous){if(JSON.stringify(previous)!==JSON.stringify(parsed))throw Error("The saved repository request differs. Recover its result before creating different repository content.");return previous;}return parsed;
}
