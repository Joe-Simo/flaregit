import {z} from "zod";
import {isSafeRef} from "../core/sanitize";
const sha=z.string().regex(/^[a-f0-9]{40}$/).refine(value=>!/^0{40}$/.test(value));
const tagRef=z.string().refine(value=>value.startsWith("refs/tags/")&&isSafeRef(value));
const actor=z.object({id:z.string().min(1),displayName:z.string().min(1)}).strict();
const tagIdentity=z.object({ref:tagRef,object:sha,peeledCommit:sha.nullable()}).strict();
export const tagSchema=z.object({name:z.string().min(1),ref:tagRef,object:sha,objectType:z.enum(["commit","tag","tree","blob"]),peeledCommit:sha.nullable()}).strict().refine(value=>value.ref===`refs/tags/${value.name}`&&(value.objectType!=="commit"||value.peeledCommit===value.object)&&(value.objectType!=="tree"&&value.objectType!=="blob"||value.peeledCommit===null));
export type GitTag=z.infer<typeof tagSchema>;
export const tagTargetSchema=z.object({ref:z.string().refine(value=>value.startsWith("refs/heads/")&&isSafeRef(value)),commit:sha,acceptedVersion:z.number().int().nonnegative().safe(),policyVersion:z.number().int().positive().safe()}).strict();
export type TagTarget=z.infer<typeof tagTargetSchema>;
const cursor=z.string().regex(/^[1-9][0-9]{0,15}$/).nullable();
export function parseTagInventory(value:unknown){return z.object({tags:z.array(tagSchema).max(200),nextCursor:cursor,complete:z.boolean(),observedAt:z.string().datetime()}).strict().parse(value);}
export function parseTagTargets(value:unknown){return z.object({targets:z.array(tagTargetSchema).max(200),complete:z.boolean()}).strict().parse(value);}
export const tagOperationSchema=z.object({operationId:z.uuid(),requestId:z.uuid().optional(),tagName:z.string().min(1),kind:z.enum(["lightweight","annotated"]),target:tagTargetSchema,phase:z.enum(["prepared","issuance_unknown","credential_received","push_unknown","observed"]),credentialState:z.enum(["not_requested","issuance_unknown","cleanup_pending","revoked"]),nativeState:z.enum(["not_allocated","unconfirmed","stopped"]),confirmed:z.boolean(),tag:tagSchema.optional(),canReconcile:z.boolean(),canResumeOriginal:z.boolean()}).strict().refine(value=>!value.confirmed||value.phase==="observed"&&value.tag!==undefined&&value.tag.name===value.tagName&&value.tag.peeledCommit===value.target.commit&&value.tag.objectType===(value.kind==="annotated"?"tag":"commit")&&value.credentialState==="revoked"&&value.nativeState==="stopped");
export type TagOperation=z.infer<typeof tagOperationSchema>;
export function parseTagOperations(value:unknown){return z.object({operations:z.array(tagOperationSchema).max(20),nextCursor:cursor,complete:z.boolean()}).strict().parse(value);}
export const releaseSchema=z.object({id:z.uuid(),tag:tagIdentity,title:z.string().min(1).max(200),notes:z.string().max(50000),state:z.enum(["draft","published"]),revision:z.number().int().nonnegative().safe(),author:actor,editor:actor,createdAt:z.string().datetime(),updatedAt:z.string().datetime(),publishedAt:z.string().datetime().optional()}).strict().refine(value=>value.tag.peeledCommit!==null&&(value.state!=="published"||value.publishedAt!==undefined));
export type RepositoryRelease=z.infer<typeof releaseSchema>;
export function parseReleases(value:unknown){return z.object({releases:z.array(releaseSchema).max(20),nextCursor:cursor,complete:z.boolean()}).strict().parse(value);}
export interface TagCreationRequest{requestId:string;tagName:string;kind:"lightweight"|"annotated";message?:string;expectedTarget:TagTarget}
export function tagCreationRequest(previous:TagCreationRequest|null,input:Omit<TagCreationRequest,"requestId">,newId:()=>string):TagCreationRequest{
 if(previous)return previous;
 if(!input.tagName||input.tagName.startsWith("refs/")||!isSafeRef(`refs/tags/${input.tagName}`))throw Error("Use a valid short Git tag name");
 if(input.message!==undefined&&input.message.length>5000)throw Error("Tag message exceeds the supported length");
 if(input.kind==="annotated"&&!input.message?.trim())throw Error("An annotated tag needs a message");
 if(input.kind==="lightweight"&&input.message!==undefined)throw Error("A lightweight tag has no annotation");
 return{requestId:z.uuid().parse(newId()),tagName:input.tagName,kind:input.kind,...(input.message!==undefined?{message:input.message}:{}),expectedTarget:tagTargetSchema.parse(input.expectedTarget)};
}
export interface ReleaseDraftRequest{requestId:string;releaseId?:string;expectedRevision:number|null;tag:RepositoryRelease["tag"];title:string;notes:string}
export interface ReleasePublishRequest{requestId:string;releaseId:string;expectedRevision:number;tag:RepositoryRelease["tag"]}
