import {z} from 'zod';
export interface IssueDraftScope{identity:string;projectId:string}
export interface IssueDraftStorage{getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
const draftSchema=z.object({title:z.string().max(200),body:z.string().max(20000),intent:z.object({signature:z.string(),key:z.uuid()}).strict().nullable()}).strict().refine(value=>value.intent===null||value.intent.signature===JSON.stringify({title:value.title.trim(),body:value.body.trim()}));
export type IssueDraft=z.infer<typeof draftSchema>;
const key=(scope:IssueDraftScope)=>`flaregit.issue-draft.${JSON.stringify([scope.identity,scope.projectId])}`;
export function readIssueDraft(storage:IssueDraftStorage,scope:IssueDraftScope):IssueDraft|null{try{const raw=storage.getItem(key(scope));if(!raw||raw.length>100000)return null;return draftSchema.parse(JSON.parse(raw));}catch{return null;}}
export function saveIssueDraft(storage:IssueDraftStorage,scope:IssueDraftScope,draft:IssueDraft):boolean{try{const value=draftSchema.parse(draft);const raw=JSON.stringify(value);storage.setItem(key(scope),raw);return storage.getItem(key(scope))===raw;}catch{return false;}}
export function clearIssueDraft(storage:IssueDraftStorage,scope:IssueDraftScope):boolean{try{storage.removeItem(key(scope));return storage.getItem(key(scope))===null;}catch{return false;}}
interface IssueDraftInventoryStorage extends IssueDraftStorage{length:number;key(index:number):string|null}
/** Keep recovery across transient binding loss, purge only after a verified
 * principal change or loaded sign-out. Other repository drafts remain scoped. */
export function clearIssueDraftRecovery(activeIdentity:string|null,suppliedStorage?:IssueDraftInventoryStorage):void{try{const storage=suppliedStorage??sessionStorage;const prefix='flaregit.issue-draft.',keep=activeIdentity===null?null:`${prefix}[${JSON.stringify(activeIdentity)},`;const keys=Array.from({length:storage.length},(_,index)=>storage.key(index));for(const key of keys)if(key?.startsWith(prefix)&&(!keep||!key.startsWith(keep)))storage.removeItem(key);}catch{/* Restoration still validates exact current identity and repository. */}}
