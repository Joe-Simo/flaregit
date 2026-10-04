import type {Task} from "./types";
/** A null base means no accepted commit existed, not an invented empty commit. */
export function hasOlderAcceptedBase(task:Pick<Task,"baseCommit"|"dependsOn">,acceptedCommit:string|null,tasks:Record<string,Pick<Task,"status">>):boolean{
 if(task.baseCommit===acceptedCommit)return false;
 if(!task.dependsOn)return true;
 const parent=tasks[task.dependsOn];return parent?.status==="accepted"||parent?.status==="cancelled";
}
