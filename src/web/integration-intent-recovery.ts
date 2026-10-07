import {z} from 'zod';
import {acceptedTargetSchema,effectiveTaskAcceptedTarget} from '@/core/accepted-target';
import type {FlareGitProjectState} from '@/core/types';
import type {IntegrationRequestExpected} from '@/server/integration-request-intents';
export interface IntegrationIntentScope {identity:string;projectId:string}
export interface IntegrationIntentStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
const taskId=z.string().regex(/^[a-z0-9][a-z0-9-]{2,100}$/),sha=z.string().regex(/^[a-f0-9]{40}$/).refine(value=>value!=='0'.repeat(40));
const expected=z.object({acceptedCommit:sha.nullable(),policyVersion:z.number().int().nonnegative().safe(),contributions:z.array(z.object({taskId,commit:sha.nullable(),base:sha.nullable(),acceptedTarget:acceptedTargetSchema.nullable(),targetGeneration:z.object({eventId:z.uuid(),generation:z.number().int().positive().safe()}).strict().nullable()}).strict()).min(1).max(8)}).strict();
const requestSchema=z.object({taskIds:z.array(taskId).min(1).max(8),idempotencyKey:z.uuid(),expected}).strict().refine(value=>new Set(value.taskIds).size===value.taskIds.length&&JSON.stringify(value.taskIds)===JSON.stringify(value.expected.contributions.map(input=>input.taskId)));
const intentSchema=z.object({request:requestSchema,createdAt:z.iso.datetime(),phase:z.enum(['prepared','unknown'])}).strict();
const collectionSchema=z.array(intentSchema).max(16).refine(values=>new Set(values.map(value=>value.request.idempotencyKey)).size===values.length);
export type IntegrationIntent=z.infer<typeof intentSchema>;
export type IntegrationRequest=IntegrationIntent['request'];
const prefix='flaregit.integration-intents.';
const key=(scope:IntegrationIntentScope)=>prefix+JSON.stringify([scope.identity,scope.projectId]);
export function prepareIntegrationIntent(state:FlareGitProjectState,taskIds:string[],idempotencyKey=crypto.randomUUID(),createdAt=new Date().toISOString()):IntegrationIntent{
 const snapshot:IntegrationRequestExpected={acceptedCommit:state.acceptedState.currentCommit,policyVersion:state.policyVersion,contributions:taskIds.map(id=>{const task=state.tasks[id];if(!task||!['ready','blocked'].includes(task.status))throw Error('Select ready or blocked contributions before preparing a new integration request.');return {taskId:id,commit:task.currentCommit,base:task.baseCommit,acceptedTarget:effectiveTaskAcceptedTarget(task)??null,targetGeneration:task.targetGeneration?{eventId:task.targetGeneration.eventId,generation:task.targetGeneration.generation}:null};})};
 return intentSchema.parse(JSON.parse(JSON.stringify({request:{taskIds,idempotencyKey,expected:snapshot},createdAt,phase:'prepared'})));
}
export function readIntegrationIntents(storage:IntegrationIntentStorage,scope:IntegrationIntentScope):IntegrationIntent[]{
 const raw=storage.getItem(key(scope));if(raw===null)return [];if(raw.length>1048576)throw Error('Saved integration recovery data exceeds its browser limit. No request was sent.');
 const records=collectionSchema.parse(JSON.parse(raw));if(records.some(record=>record.request.expected.contributions.some(input=>input.acceptedTarget&&input.acceptedTarget.projectId!==scope.projectId)))throw Error('Saved integration recovery belongs to another repository.');return records;
}
export function saveIntegrationIntent(storage:IntegrationIntentStorage,scope:IntegrationIntentScope,intent:IntegrationIntent):IntegrationIntent[]{
 const next=intentSchema.parse(intent),records=readIntegrationIntents(storage,scope);const existing=records.find(record=>record.request.idempotencyKey===next.request.idempotencyKey);
 if(existing&&JSON.stringify(existing.request)!==JSON.stringify(next.request))throw Error('The original integration request cannot be replaced under the same recovery key.');
 const saved=collectionSchema.parse(existing?records.map(record=>record.request.idempotencyKey===next.request.idempotencyKey?next:record):[...records,next]);const raw=JSON.stringify(saved);if(raw.length>1048576)throw Error('Browser recovery capacity is full. Existing requests remain saved; no new request was sent.');storage.setItem(key(scope),raw);if(storage.getItem(key(scope))!==raw)throw Error('The integration request could not be durably saved in this browser. No request was sent.');return saved;
}
export function acknowledgeIntegrationIntent(storage:IntegrationIntentStorage,scope:IntegrationIntentScope,idempotencyKey:string):IntegrationIntent[]{const remaining=readIntegrationIntents(storage,scope).filter(record=>record.request.idempotencyKey!==idempotencyKey);if(remaining.length)storage.setItem(key(scope),JSON.stringify(remaining));else storage.removeItem(key(scope));return remaining;}
interface InventoryStorage extends IntegrationIntentStorage {length:number;key(index:number):string|null}
export function clearIntegrationIntentRecovery(activeIdentity:string|null,suppliedStorage?:InventoryStorage):void{try{const storage=suppliedStorage??sessionStorage,keep=activeIdentity===null?null:`${prefix}[${JSON.stringify(activeIdentity)},`;const keys=Array.from({length:storage.length},(_,index)=>storage.key(index));for(const name of keys)if(name?.startsWith(prefix)&&(!keep||!name.startsWith(keep)))storage.removeItem(name);}catch{/* Each restoration validates the exact current principal and repository. */}}
