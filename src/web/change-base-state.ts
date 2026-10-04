import type {Task} from '@/core/types';
/** Pending stacks intentionally use a contributor base; an accepted parent no longer exempts an old canonical base. */
export function hasOlderAcceptedBase(task:Pick<Task,'baseCommit'|'dependsOn'>,acceptedCommit:string|null,tasks:Record<string,Pick<Task,'status'>>):boolean{
 if(acceptedCommit===null)return false;
 if(task.baseCommit===acceptedCommit)return false;
 if(!task.dependsOn)return true;
 const parent=tasks[task.dependsOn];return parent?.status==='accepted'||parent?.status==='cancelled';
}
