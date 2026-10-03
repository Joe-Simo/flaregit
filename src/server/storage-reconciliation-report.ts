/** Observations only: absence never confirms cancellation or releases a hold. */
export interface StorageReconciliationScope {projectId:string;incarnation:string;epoch:string}
export interface StorageReconciliationPlan {
 identity:{projectId:string;incarnation:string};
 kind:"preview"|"evidence"|"private-recovery";
 physicalKey:string;keys:string[];bytes:number;currentWriter:boolean;unfinishedCount:number;
}
export interface StorageReconciliationSnapshot {
 scope:StorageReconciliationScope;plans:StorageReconciliationPlan[];
 legacyInventory:boolean;legacyEvidence:boolean;plansComplete:boolean;plansNextCursor?:string;
}
export interface StorageReconciliationCallbacks {
 authorize():Promise<boolean>;
 head(key:string):Promise<Pick<R2Object,"size"|"customMetadata">|null>;
 list(options:Pick<R2ListOptions,"prefix"|"limit">):Promise<Pick<R2Objects,"objects"|"truncated">>;
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const denied=()=>new Error("Storage reconciliation unavailable");
function validPlan(plan:StorageReconciliationPlan,scope:StorageReconciliationScope):boolean {
 if(plan.identity.projectId!==scope.projectId||plan.identity.incarnation!==scope.incarnation||!Number.isSafeInteger(plan.bytes)||plan.bytes<0||!Number.isSafeInteger(plan.unfinishedCount)||plan.unfinishedCount<0||typeof plan.currentWriter!=="boolean"||!Array.isArray(plan.keys)||plan.keys.length>1000||new Set(plan.keys).size!==plan.keys.length)return false;
 const prefix=plan.kind==="preview"?`builds/${scope.projectId}/`:plan.kind==="evidence"?`evidence/${scope.projectId}/${scope.incarnation}/`:plan.kind==="private-recovery"?`private-recovery/${scope.projectId}/${scope.incarnation}/`:null;
 return !!prefix&&plan.physicalKey.startsWith(prefix)&&plan.keys.every(key=>key===plan.physicalKey||(plan.kind==="private-recovery"&&key===`${plan.physicalKey}.json`)||key.startsWith(`${plan.physicalKey}/`));
}
async function snapshotToken(snapshot:StorageReconciliationSnapshot):Promise<string> {
 const bytes=new TextEncoder().encode(JSON.stringify(snapshot));
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");
}
export async function storageReconciliationReport(input:{snapshot:StorageReconciliationSnapshot;cursor?:string},callbacks:StorageReconciliationCallbacks) {
 const {snapshot}=input,{scope}=snapshot;
 const authorize=async()=>{if(!await callbacks.authorize())throw denied();};
 await authorize();
 if(!/^[a-z0-9]{12,16}$/.test(scope.projectId)||!uuid.test(scope.incarnation)||!scope.epoch||scope.epoch.length>128||snapshot.plans.length>32||snapshot.plans.some(plan=>!validPlan(plan,scope)))throw denied();
 const token=await snapshotToken(snapshot);
 let offset=0;
 if(input.cursor){const match=/^([a-f0-9]{64}):(\d+)$/.exec(input.cursor);if(!match||match[1]!==token)throw denied();offset=Number(match[2]);}
 const keys=snapshot.plans.flatMap((plan,planIndex)=>plan.keys.map((key,keyIndex)=>({key,planIndex,keyIndex})));
 if(!Number.isSafeInteger(offset)||offset<0||offset>keys.length||(offset>0&&offset%32!==0))throw denied();
 const page=keys.slice(offset,offset+32);
 const observations: {plan:number;object:number;status:"present"|"absent"|"unknown";bytes:number|null;metadataPresent:boolean|null}[]=new Array(page.length);
 // Six workers bound both provider calls and authorization checks.
 let next=0;
 await Promise.all(Array.from({length:Math.min(6,page.length)},async()=>{
  while(next<page.length){const index=next++,item=page[index]!;await authorize();
   let value:Pick<R2Object,"size"|"customMetadata">|null|undefined;
   try{value=await callbacks.head(item.key);}catch{value=undefined;}
   await authorize();
   observations[index]={plan:item.planIndex,object:item.keyIndex,status:value===undefined?"unknown":value===null?"absent":"present",bytes:value&&Number.isSafeInteger(value.size)&&value.size>=0?value.size:null,metadataPresent:value?Object.keys(value.customMetadata??{}).length>0:null};
  }
 }));
 const inventory: {kind:StorageReconciliationPlan["kind"];status:"empty"|"nonempty"|"incomplete"|"unknown"}[]=[];
 for(const [kind,prefix] of [["preview",`builds/${scope.projectId}/`],["evidence",`evidence/${scope.projectId}/${scope.incarnation}/`],["private-recovery",`private-recovery/${scope.projectId}/${scope.incarnation}/`]] as const){
  await authorize();let status:"empty"|"nonempty"|"incomplete"|"unknown"="unknown";
  try{const value=await callbacks.list({prefix,limit:1});status=value.objects.length?"nonempty":value.truncated?"incomplete":"empty";}catch{/* Provider failures are observations, never cleanup evidence. */}
  await authorize();inventory.push({kind,status});
 }
 await authorize();
 const end=offset+page.length,pageComplete=observations.every(value=>value.status!=="unknown")&&inventory.every(value=>value.status!=="unknown"&&value.status!=="incomplete");
 const complete=snapshot.plansComplete&&offset===0&&end===keys.length&&pageComplete;
 return {epoch:scope.epoch,complete,pageComplete,cursor:end<keys.length?`${token}:${end}`:null,plansNextCursor:snapshot.plansNextCursor??null,
  plans:snapshot.plans.map((plan,index)=>({plan:index,kind:plan.kind,declaredBytes:plan.bytes,declaredObjects:plan.keys.length,currentWriter:plan.currentWriter,unfinishedCount:plan.unfinishedCount})),
  observations,inventory,legacyInventory:snapshot.legacyInventory,legacyEvidence:snapshot.legacyEvidence,
  holdsPreserved:true as const,absenceConfirmsCancellation:false as const};
}
