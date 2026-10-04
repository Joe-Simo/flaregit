import {z} from "zod";
import {isSafeRef} from "../core/sanitize";
/** Normal creation explicitly records initialization. Empty/bootstrap and demos are separate workflows. */
export const repositoryCreationRequestSchema=z.object({kind:z.literal("repository"),initialization:z.enum(["readme","empty"]),requestId:z.uuid(),name:z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._ -]+$/),defaultBranch:z.string().min(1).max(200).refine(value=>value!=="HEAD"&&!value.startsWith("refs/")&&isSafeRef(value)),description:z.string().max(300).refine(value=>!/[\x00-\x1f\x7f]/.test(value)).optional()}).strict();
export type RepositoryCreationRequest=z.infer<typeof repositoryCreationRequestSchema>;
