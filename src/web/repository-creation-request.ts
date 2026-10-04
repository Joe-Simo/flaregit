import {repositoryCreationRequestSchema,type RepositoryCreationRequest} from "../server/repository-creation-request";
export {repositoryCreationRequestSchema,type RepositoryCreationRequest};
/** A creation UUID owns one frozen initialization request, never a second SDK create. */
export function repositoryCreationRequest(previous:RepositoryCreationRequest|null,fields:{name:string;defaultBranch:string;description:string;initialization?:RepositoryCreationRequest["initialization"]},newId:()=>string):RepositoryCreationRequest{
 const body={kind:"repository" as const,initialization:fields.initialization??"readme",requestId:previous?.requestId??newId(),name:fields.name,defaultBranch:fields.defaultBranch,description:fields.description};const parsed=repositoryCreationRequestSchema.parse(body);if(previous){if(JSON.stringify(previous)!==JSON.stringify(parsed))throw Error("The saved repository request differs. Recover its result before creating different repository content.");return previous;}return parsed;
}
