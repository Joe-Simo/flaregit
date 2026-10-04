import {deploymentTargetRefLabel} from "./deployment-target-display";
export interface RecoveryBranchMetadata{acceptedRef?:string;acceptedRootVersion?:number}
export interface RecoverySelection extends RecoveryBranchMetadata{journalId:string}
export interface RecoveryRevision extends RecoveryBranchMetadata{commit:string;tree:string|null;journalId?:string}
export function recoverySelection(target:RecoveryRevision):RecoverySelection|undefined{return target.journalId?{journalId:target.journalId,...(target.acceptedRef!==undefined?{acceptedRef:target.acceptedRef}:{}),...(target.acceptedRootVersion!==undefined?{acceptedRootVersion:target.acceptedRootVersion}:{})}:undefined;}
export function recoveryTargetKey(target:RecoveryRevision):string{return JSON.stringify({journalId:target.journalId??null,commit:target.commit,acceptedRef:target.acceptedRef??null,acceptedRootVersion:target.acceptedRootVersion??null});}
export function recoverySnapshotMatches(snapshot:RecoveryRevision,target:RecoveryRevision):boolean{return snapshot.commit===target.commit&&(!snapshot.tree||!target.tree||snapshot.tree===target.tree)&&snapshot.acceptedRef===target.acceptedRef&&snapshot.acceptedRootVersion===target.acceptedRootVersion&&(snapshot.journalId===undefined||target.journalId===undefined||snapshot.journalId===target.journalId);}
export function recoveryDownloadNotice(snapshot:RecoveryRevision):string{return`Download started for ${deploymentTargetRefLabel(snapshot)} · commit ${snapshot.commit}.`;}
export function selectedRecoveryTarget<T extends RecoveryRevision>(targets:T[]|undefined,current:RecoveryRevision|null|undefined,key:string|null):RecoveryRevision|null{return key===null?current??null:targets?.find(target=>recoveryTargetKey(target)===key)??null;}
