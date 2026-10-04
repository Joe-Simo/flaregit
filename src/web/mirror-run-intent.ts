/** One browser request keeps one mirror operation identity across an unknown ACK.
 * Safe display context is not server export authority and contains no credentials. */
export interface MirrorRunIntent {requestId:string;target:string}
export function mirrorRunIntent(previous:MirrorRunIntent|null,target:string,newId:()=>string):MirrorRunIntent{
 if(previous)return previous;
 const url=new URL(target);if(url.protocol!=="https:"||url.hostname!=="github.com"||url.search||url.hash||url.username||url.password||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url.pathname))throw Error("A configured GitHub repository is required");
 return{requestId:newId(),target};
}
export interface MirrorIntentStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
const intentKey=(identity:string,projectId:string)=>`flaregit.mirror.${JSON.stringify([identity,projectId])}`;
export function readMirrorIntent(storage:MirrorIntentStorage,identity:string,projectId:string):MirrorRunIntent|null{try{const raw=storage.getItem(intentKey(identity,projectId));if(!raw||raw.length>2000)return null;const value:unknown=JSON.parse(raw);if(!value||typeof value!=="object"||!("requestId"in value)||!("target"in value)||typeof value.requestId!=="string"||typeof value.target!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId)||Object.keys(value).length!==2)return null;const requestId=value.requestId;return mirrorRunIntent(null,value.target,()=>requestId);}catch{return null;}}
export function saveMirrorIntent(storage:MirrorIntentStorage,identity:string,projectId:string,intent:MirrorRunIntent):boolean{try{storage.setItem(intentKey(identity,projectId),JSON.stringify(intent));return readMirrorIntent(storage,identity,projectId)?.requestId===intent.requestId;}catch{return false;}}
export function clearMirrorIntent(storage:MirrorIntentStorage,identity:string,projectId:string):void{try{storage.removeItem(intentKey(identity,projectId));}catch{/* Durable server operations remain preserved. */}}
