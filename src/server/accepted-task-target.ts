import {acceptedTargetSchema,assertCompatibleAcceptedTargetBatch,type FrozenAcceptedTarget} from '../core/accepted-target';
import type {FlareGitProjectState,Task} from '../core/types';
import {AcceptedBranchRoots} from './accepted-branch-roots';
import {freezeAcceptedTarget} from './accepted-target-binding';
import {taskCreationPayload,type TaskCreationInput} from './task-creation';
export interface InternalTaskTargetOptions {acceptedTargetRef:string}
/** Opt-in backend binding only. Unbound legacy task objects remain untouched. */
export function bindTaskAcceptedTarget(roots:AcceptedBranchRoots,state:FlareGitProjectState,incarnation:string,task:Task,options?:InternalTaskTargetOptions):Task {
 const parent=task.dependsOn?state.tasks[task.dependsOn]:undefined;
 if(task.dependsOn&&!parent)throw Error('Selected parent change is unavailable');
 const ref=options?.acceptedTargetRef??parent?.acceptedTarget?.ref;
 if(ref===undefined){if(task.acceptedTarget)throw Error('An explicit registered target is required for a bound task');return task;}
 const target=acceptedTargetSchema.parse(freezeAcceptedTarget(roots,state,incarnation,ref));
 if(parent){
  if(parent.status==='accepted'){
   if(parent.acceptedTarget){const old=parent.acceptedTarget;if(old.projectId!==target.projectId||old.incarnation!==target.incarnation||old.canonicalRepoName!==target.canonicalRepoName||old.ref!==target.ref)throw Error('Accepted parent belongs to another target');}
   else if(target.ref!==`refs/heads/${state.defaultBranch??''}`)throw Error('Legacy accepted parent only belongs to its recorded primary target');
   const proven=state.journal.some(journal=>{if(journal.state!=='ACCEPTED')return false;const candidate=state.candidates[journal.candidateId];if(!candidate||!candidate.participatingTaskIds.includes(parent.id)||candidate.participatingCommits[parent.id]!==parent.currentCommit||candidate.candidateCommit!==journal.newHead)return false;const ref=journal.acceptedTarget?.ref??candidate.acceptedTarget?.ref??`refs/heads/${state.defaultBranch??''}`;if(ref!==target.ref)return false;if(target.ref===`refs/heads/${state.defaultBranch??''}`)return state.acceptedState.history.some(item=>item.candidateId===candidate.id&&item.commit===journal.newHead&&item.participatingTasks.includes(parent.id));return roots.get({projectId:target.projectId,incarnation:target.incarnation,canonicalRepoName:target.canonicalRepoName,ref:target.ref})?.history.some(item=>item.operationId===journal.id&&item.commit===journal.newHead)===true;});
   if(!proven)throw Error('Accepted parent checkpoint has no publication proof on the selected target');
  }else{if(!parent.acceptedTarget)throw Error('A bound stack cannot inherit an unbound parent');assertCompatibleAcceptedTargetBatch([parent.acceptedTarget,target]);}
 }
 if(task.acceptedTarget)assertCompatibleAcceptedTargetBatch([task.acceptedTarget,target]);
 const base=parent?.currentCommit??target.acceptedCommit;
 if(task.baseCommit!==base||task.currentCommit!==base)throw Error('New task workspace does not match its selected accepted target or parent checkpoint');
 return {...task,acceptedTarget:structuredClone(target)};
}
export function boundTaskCreationPayload(input:TaskCreationInput,target?:FrozenAcceptedTarget):string {
 const legacy=taskCreationPayload(input);if(!target)return legacy;
 const value=acceptedTargetSchema.parse(target);
 return JSON.stringify({input:JSON.parse(legacy) as TaskCreationInput,acceptedTarget:value});
}
/** A retry identifies the original immutable creation, even after its root advances. */
export function assertTaskTargetRetry(task:Task,options?:InternalTaskTargetOptions,inheritedTargetRef?:string):void {
 if(task.acceptedTarget){if((options?.acceptedTargetRef??inheritedTargetRef)!==task.acceptedTarget.ref)throw Error('Task creation retry omitted or changed its frozen accepted target');acceptedTargetSchema.parse(task.acceptedTarget);}
 else if(options)throw Error('An unbound legacy task cannot acquire a target through replay');
}
