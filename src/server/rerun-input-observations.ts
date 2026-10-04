import {isSafeRef} from "../core/sanitize";
import type {RepositoryReadCapability} from './repository-read-budget';
export interface RerunInputObservationScope {candidateId:string;incarnation:string;expectedCommit:string|null;tasks:Array<{id:string;commit:string;base:string;repoName:string;branch:string;currentCommit:string}>}
export interface RerunInputObservation {taskId:string;expectedCommit:string;ref:string;observedCommit:string|null;namedBranchObservedCommit:string|null;expectedObjectAvailable:boolean|null;status:'observed'|'unavailable'}
const hash=/^[a-f0-9]{40}$/;
export async function observeRerunInputs(scope:RerunInputObservationScope,open:(repoName:string,remainingMs:number)=>Promise<RepositoryReadCapability>,authorize:()=>Promise<void>){
 if(scope.tasks.length>8)throw Error('Frozen input observation bound exceeded');const deadline=Date.now()+10000,rows:RerunInputObservation[]=[];
 for(const task of scope.tasks){if(!hash.test(task.commit)||!isSafeRef(task.branch))throw Error('Frozen input reference is invalid');await authorize();const row:RerunInputObservation={taskId:task.id,expectedCommit:task.commit,ref:`refs/heads/${task.branch}`,observedCommit:null,namedBranchObservedCommit:null,expectedObjectAvailable:null,status:'unavailable'};let repository:RepositoryReadCapability|undefined;
 try{if(Date.now()>=deadline){rows.push(row);continue;}repository=await open(task.repoName,Math.max(1,deadline-Date.now()));const full=(await repository.log({ref:row.ref,limit:1}))[0]?.hash;if(full!==undefined&&!hash.test(full))throw Error('Invalid provider identity');row.observedCommit=full??null;const named=(await repository.log({ref:task.branch,limit:1}))[0]?.hash;if(named!==undefined&&!hash.test(named))throw Error('Invalid provider identity');row.namedBranchObservedCommit=named??null;const object=await repository.readCommit(task.commit);if(object!==null&&(!object||object.hash!==task.commit))throw Error('Invalid provider identity');row.expectedObjectAvailable=object!==null;row.status='observed';}catch{/* Unknown provider/capacity outcomes remain unavailable, never a safe rerun grant. */}finally{repository?.[Symbol.dispose]();}await authorize();rows.push(row);
 }
 await authorize();return {status:rows.every(row=>row.status==='observed')?'observed' as const:'unavailable' as const,checkedAt:new Date().toISOString(),rows};
}
