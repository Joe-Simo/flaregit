import {z} from 'zod';
const id=z.string().min(1).max(256);
export const forkPermissionScopeSchema=z.object({projectId:id,incarnation:z.uuid(),taskId:id,repoName:id,branch:id,creatorId:id}).strict();
export type ForkPermissionScope=z.infer<typeof forkPermissionScopeSchema>;
export interface ForkPermissionSource {creatorId:string;revision:number}
export interface ForkPermission {enabled:boolean;revision:number}
/** Consent is bound to the exact human creator and fork, independent of repository ownership. */
export class ForkPermissions {
 constructor(private readonly storage:Pick<DurableObjectStorage,'sql'|'transactionSync'>){
  storage.sql.exec('CREATE TABLE IF NOT EXISTS human_fork_permissions(task_id TEXT PRIMARY KEY,scope TEXT NOT NULL,revision INTEGER NOT NULL,enabled INTEGER NOT NULL)');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS human_fork_permission_history(task_id TEXT NOT NULL,revision INTEGER NOT NULL,scope TEXT NOT NULL,enabled INTEGER NOT NULL,actor_id TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(task_id,revision))');
 }
 read(scope:ForkPermissionScope):ForkPermission {
  const key=JSON.stringify(forkPermissionScopeSchema.parse(scope)),row=this.storage.sql.exec<{scope:string;revision:number;enabled:number}>('SELECT scope,revision,enabled FROM human_fork_permissions WHERE task_id=?',scope.taskId).toArray()[0];
  if(!row)return {enabled:false,revision:0};if(row.scope!==key)throw Error('Original human fork scope changed');return {enabled:row.enabled===1,revision:row.revision};
 }
 update(scope:ForkPermissionScope,actorId:string,expectedRevision:number,enabled:boolean,authorize:()=>void):ForkPermission {
  z.number().int().nonnegative().safe().parse(expectedRevision);z.boolean().parse(enabled);forkPermissionScopeSchema.parse(scope);
  return this.storage.transactionSync(()=>{
   authorize();if(actorId!==scope.creatorId)throw Error('Only the human fork creator may allow maintainer edits');
   const current=this.read(scope);if(current.revision!==expectedRevision)throw Error('Fork permission revision changed');
   const revision=current.revision+1,encoded=JSON.stringify(scope);
   if(revision>10000)throw Error('Fork permission audit capacity reached');
   this.storage.sql.exec('INSERT INTO human_fork_permission_history VALUES(?,?,?,?,?,?)',scope.taskId,revision,encoded,enabled?1:0,actorId,Date.now());
   this.storage.sql.exec('INSERT INTO human_fork_permissions VALUES(?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled',scope.taskId,encoded,revision,enabled?1:0);
   return {enabled,revision};
  });
 }
 source(scope:ForkPermissionScope):ForkPermissionSource|null {const current=this.read(scope);return current.enabled?{creatorId:scope.creatorId,revision:current.revision}:null;}
 assert(scope:ForkPermissionScope,source:ForkPermissionSource) {const current=this.source(scope);if(!current||current.creatorId!==source.creatorId||current.revision!==source.revision)throw Error('Human fork maintainer consent was revoked or changed');}
}
