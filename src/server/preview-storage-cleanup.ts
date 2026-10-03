import {EVIDENCE_COPY_ID} from "./evidence-copy-id.js";
import {orderedPreviewAssets} from "./preview-assets.js";
import type {PreviewCopyPlan} from "./preview-storage-writers.js";
import type {Env} from "./env.js";
import type {Ledger} from "./durable-object.js";
import {recoverNativeCompute} from "./native-compute.js";
import {globalOf} from "./projects.js";
export interface PreviewCleanupOutcome {cleaned:boolean;recoveryAction:"none"|"retry"|"provider-reconciliation";detail:string}
function strictPlan(plan:PreviewCopyPlan,scope:{projectId:string;incarnation:string}):boolean{
 try {
  if(plan.identity.projectId!==scope.projectId||plan.identity.incarnation!==scope.incarnation||! /^[a-f0-9]{40}$/.test(plan.identity.commit)||!Array.isArray(plan.keys)||!plan.keys.length||plan.keys.length>1000||new Set(plan.keys).size!==plan.keys.length)return false;
  if(plan.kind==="evidence"){
    const prefix=`evidence/${scope.projectId}/${scope.incarnation}/`;
    return plan.keys.length===1&&plan.keys[0]===plan.physicalKey&&plan.physicalKey.startsWith(prefix)&&plan.physicalKey.endsWith(".json")&&EVIDENCE_COPY_ID.test(plan.physicalKey.slice(prefix.length,-5));
  }
  if(plan.kind!=="preview"||plan.physicalKey!==`builds/${scope.projectId}/${plan.identity.commit}`||plan.keys.some(key=>!key.startsWith(`${plan.physicalKey}/`)))return false;
  orderedPreviewAssets(plan.keys.map(key=>key.slice(plan.physicalKey.length+1)).join("\n"));return true;
 }catch{return false;}
}
/** Call only after explicit owner deletion and confirmed repository Workflow shutdown.
 * Enumerated plans survive repository metadata removal. Never infer unknown PUTs cancelled. */
export async function cleanupRepositoryCopies(env:Env,ledger:Ledger):Promise<PreviewCleanupOutcome>{
 try {
  if(!await ledger.repositoryDeletionPending())return{cleaned:false,recoveryAction:"retry",detail:"Repository copy cleanup needs its saved deletion fence."};
  const scope=await ledger.previewCleanupScope(),controller=globalOf(env);
  const plans=await controller.fencePreviewCleanup(scope.projectId,scope.incarnation);
  if(scope.legacyInventory)return{cleaned:false,recoveryAction:"provider-reconciliation",detail:"This repository predates durable storage dispatch tracking. Legacy provider inventory and writer reconciliation are required before deletion can finish, even when the current listing is empty. Git, review, and cleanup records are preserved."};
  for(const plan of plans){
   if(!strictPlan(plan,scope)||!await controller.previewCopyCleanupReady(plan.physicalKey))return{cleaned:false,recoveryAction:"provider-reconciliation",detail:"A preview or evidence writer has an unresolved storage dispatch. Saved records and capacity reservations are preserved; provider reconciliation is required."};
   if(plan.kind==="preview"){
    const key=`build-${scope.projectId}-${plan.identity.commit}`;
    const active=await controller.nativeComputeStatus(key);
    if(active?.active)await recoverNativeCompute(env,key);
    if((await controller.nativeComputeStatus(key))?.active)return{cleaned:false,recoveryAction:"retry",detail:"Preview native workspace shutdown is not yet confirmed. Saved copies and capacity reservations are preserved."};
   }
   for(const key of plan.keys)await env.EVIDENCE_BUCKET.delete(key);
   await controller.finishPreviewCopyCleanup(plan.physicalKey);
  }
  if(scope.legacyEvidence)return{cleaned:false,recoveryAction:"provider-reconciliation",detail:"Tracked copies were cleaned, but legacy unscoped evidence copies require provider inventory reconciliation. Repository records are preserved; no legacy objects were deleted."};
  // A scoped provider listing is necessary before claiming this namespace empty;
  // keys absent from durable plans are never deleted on inference.
  for(const prefix of [`builds/${scope.projectId}/`,`evidence/${scope.projectId}/`]){
   const inventory=await env.EVIDENCE_BUCKET.list({prefix,limit:1});
   if(inventory.objects.length||inventory.truncated)return{cleaned:false,recoveryAction:"provider-reconciliation",detail:"Untracked repository copies remain in the scoped storage inventory. Provider reconciliation is required; those objects and repository records are preserved."};
  }
  return{cleaned:true,recoveryAction:"none",detail:"Tracked repository copies are absent and scoped storage inventory is empty."};
 }catch{return{cleaned:false,recoveryAction:"retry",detail:"Repository copy cleanup is unconfirmed. Retry the saved deletion; metadata and unresolved capacity reservations are preserved."};}
}
