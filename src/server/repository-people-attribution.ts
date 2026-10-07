import type {Task} from '../core/types';
export type PeopleContribution=Pick<Task,'id'|'goal'|'status'|'updatedAt'|'contributor'>;
export interface PeopleWriter {taskId:string;userId:string}
export function exactHumanContributions(tasks:readonly PeopleContribution[],writers:readonly PeopleWriter[],userId:string):PeopleContribution[]{
 const owned=new Set(writers.filter(writer=>writer.userId===userId).map(writer=>writer.taskId));
 return tasks.filter(task=>task.contributor.type==='human'&&owned.has(task.id));
}
export function unattributedHumanContributions(tasks:readonly PeopleContribution[],writers:readonly PeopleWriter[],memberIds:readonly string[]):PeopleContribution[]{
 const current=new Set(memberIds),known=new Set(writers.filter(writer=>current.has(writer.userId)).map(writer=>writer.taskId));
 return tasks.filter(task=>task.contributor.type==='human'&&!known.has(task.id));
}
