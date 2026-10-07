import type {Contributor,FrozenContributionAttribution,Task} from '../core/types';
import type {TaskCreationIntentRecord} from './task-creation-intents';
/** Freeze identity only from the original creator receipt and exact current writer.
 * Legacy tasks retain frozen purpose without retroactively inventing identity. */
export function freezeContributionAttribution(task:Task,creation:TaskCreationIntentRecord|null,writerId:string|null):FrozenContributionAttribution{
 if(!task.currentCommit||!/^[a-f0-9]{40}$/.test(task.currentCommit))throw Error('Exact contribution checkpoint required');
 const purpose={taskId:task.id,commit:task.currentCommit,goal:task.goal,...(task.issue?{issue:task.issue}:{}),...(task.dependsOn?{dependsOn:task.dependsOn}:{})};
 const unavailable=():FrozenContributionAttribution=>({...purpose,status:'unavailable',reason:'legacy_origin_unavailable'});
 if(!creation||creation.phase!=='committed'||creation.taskId!==task.id||creation.actor.userId!==writerId)return unavailable();
 if(JSON.stringify(task.externalTool??null)!==JSON.stringify(creation.input.externalTool?{...creation.input.externalTool,attestedBy:creation.actor.userId}:null))throw Error('Immutable external origin differs from creation receipt');
 const source=task.initiatedBy??(task.contributor.type==='human'?task.contributor:null);
 if(!source||source.type!=='human'||source.id!==writerId&&source.id!==writerId?.slice(-12))return unavailable();
 if(task.contributor.type==='agent'&&!task.agentRunId)return unavailable();
 const initiatedBy:Contributor={...source,id:writerId!},contributor:Contributor=task.contributor.type==='human'?{...task.contributor,id:writerId!}:{...task.contributor};
 return structuredClone({...purpose,status:'recorded',contributor,initiatedBy,...(task.externalTool?{externalTool:task.externalTool}:{})});
}
/** A durable marker prevents subsequent task mutations from rebinding history. */
export class ContributionAttributionLedger{
 constructor(private readonly storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS contribution_attribution(candidate_id TEXT PRIMARY KEY,doc TEXT NOT NULL)');}
 freeze(candidateId:string,records:FrozenContributionAttribution[]){const doc=JSON.stringify(records),old=this.storage.sql.exec<{doc:string}>('SELECT doc FROM contribution_attribution WHERE candidate_id=?',candidateId).toArray()[0];if(old&&old.doc!==doc)throw Error('Frozen contribution attribution changed');if(!old)this.storage.sql.exec('INSERT INTO contribution_attribution VALUES(?,?)',candidateId,doc);return structuredClone(records);}
 assert(candidateId:string,records:FrozenContributionAttribution[]){const old=this.storage.sql.exec<{doc:string}>('SELECT doc FROM contribution_attribution WHERE candidate_id=?',candidateId).toArray()[0];if(!old||old.doc!==JSON.stringify(records))throw Error('Frozen contribution attribution unavailable or changed');}
}
export function assertJournalAttribution(candidate:{frozenAttribution?:FrozenContributionAttribution[]},journal:{contributionAttribution?:FrozenContributionAttribution[]}):void{if(JSON.stringify(candidate.frozenAttribution??null)!==JSON.stringify(journal.contributionAttribution??null))throw Error('Publication changed frozen contribution attribution');}
