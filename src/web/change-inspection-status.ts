import type {Task} from '../core/types';
/** A pushed remote is not disproved by absent app checkpoint metadata. */
export function changeInspectionStatus(tasks:readonly Pick<Task,'currentCommit'|'checkpoints'>[],sharedFiles:number){const pending=tasks.filter(task=>!task.currentCommit||!task.checkpoints.some(checkpoint=>checkpoint.commitHash===task.currentCommit)).length;return{pending,sharedFilesLabel:pending>0&&sharedFiles===0?'—':String(sharedFiles),sharedFilesNote:pending>0?`${pending} change${pending===1?'':'s'} awaiting inspection`:null};}
