import {ensureIssueEventSources,bindIssueActivity} from './issue-event-sources';
import {z} from 'zod';
export const issueStateMutationSchema=z.object({state:z.enum(['open','closed']),expectedRevision:z.number().int().nonnegative().safe(),requestId:z.uuid()}).strict();
export type IssueStateMutation=z.infer<typeof issueStateMutationSchema>;
export interface IssueStateScope {projectId:string;incarnation:string;number:number;createdAt:string;author:string}
export interface IssueStateSnapshot {number:number;state:'open'|'closed';stateRevision:number;updated_at:string;closed_by:string|null}
export interface IssueStateResult {issue:IssueStateSnapshot;requestId:string;replayed:boolean;changedSince:boolean;originalState:'open'|'closed';originalRevision:number}
export interface IssueStateCredential {personalTokenHash?:string;sessionExpiresAt?:number;oauth?:{token:string;clientId:string;repositoryId:string}}
export type IssueStateReply<T>={ok:true;value:T}|{ok:false;status:number;error:string};
export class IssueStateError extends Error{constructor(message:string,readonly status:number){super(message);}}
/** State revisions observe every canonical issue update, including internal close
 * and imported/bulk SQL changes. Retry receipts never bypass current authority. */
export class IssueStateLedger {
 constructor(private readonly storage:DurableObjectStorage){ensureIssueEventSources(storage);storage.sql.exec('CREATE TABLE IF NOT EXISTS issue_state_versions(issue_number INTEGER PRIMARY KEY,identity TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL)');storage.sql.exec('CREATE TABLE IF NOT EXISTS issue_state_mutations(actor_id TEXT NOT NULL,request_id TEXT NOT NULL,scope TEXT NOT NULL,payload TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(actor_id,request_id))');storage.sql.exec('CREATE TRIGGER IF NOT EXISTS issue_state_version_update AFTER UPDATE OF state,updated_at,closed_by ON issues BEGIN UPDATE issue_state_versions SET state=NEW.state,updated_at=NEW.updated_at,revision=revision+1 WHERE issue_number=NEW.number; END;');}
 snapshot(scope:IssueStateScope):IssueStateSnapshot{return this.storage.transactionSync(()=>{
  const issue=this.storage.sql.exec<{number:number;state:'open'|'closed';created_at:string;author:string;updated_at:string;closed_by:string|null}>('SELECT number,state,created_at,author,updated_at,closed_by FROM issues WHERE number=?',scope.number).toArray()[0];if(!issue||issue.created_at!==scope.createdAt||issue.author!==scope.author)throw new IssueStateError('Original issue is unavailable',404);
  const identity=JSON.stringify([scope.projectId,scope.number,scope.createdAt,scope.author]),old=this.storage.sql.exec<{identity:string;state:string;updated_at:string;revision:number}>('SELECT identity,state,updated_at,revision FROM issue_state_versions WHERE issue_number=?',scope.number).toArray()[0];
  if(old&&old.identity!==identity)throw new IssueStateError('Original issue identity changed',410);let revision=old?.revision??0;if(!Number.isSafeInteger(revision)||revision<0)throw new IssueStateError('Issue revision capacity reached',413);
  if(old&&(old.state!==issue.state||old.updated_at!==issue.updated_at)){revision++;if(!Number.isSafeInteger(revision))throw new IssueStateError('Issue revision capacity reached',413);}
  this.storage.sql.exec('INSERT INTO issue_state_versions VALUES(?,?,?,?,?) ON CONFLICT(issue_number) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,revision=excluded.revision',scope.number,identity,issue.state,issue.updated_at,revision);
  return{number:issue.number,state:issue.state,stateRevision:revision,updated_at:issue.updated_at,closed_by:issue.closed_by};
 });}
 private apply(scope:IssueStateScope,state:'open'|'closed',displayName:string){const current=this.snapshot(scope);if(current.state===state)return current;const at=new Date(Math.max(Date.now(),(Date.parse(current.updated_at)||0)+1)).toISOString();this.storage.sql.exec('UPDATE issues SET state=?,updated_at=?,closed_by=? WHERE number=?',state,at,state==='closed'?displayName:null,scope.number);return this.snapshot(scope);}
 internal(scope:IssueStateScope,state:'open'|'closed',by:string){return this.storage.transactionSync(()=>this.apply(scope,state,by));}
 mutate(scope:IssueStateScope,input:IssueStateMutation,actor:{userId:string;displayName:string},assert:()=>void):IssueStateResult{return this.storage.transactionSync(()=>{
  assert();const current=this.snapshot(scope),scopeKey=JSON.stringify(scope),payload=JSON.stringify(input),old=this.storage.sql.exec<{scope:string;payload:string;receipt:string}>('SELECT scope,payload,receipt FROM issue_state_mutations WHERE actor_id=? AND request_id=?',actor.userId,input.requestId).toArray()[0];
  if(old){if(old.scope!==scopeKey||old.payload!==payload)throw new IssueStateError('The original status request cannot change',409);const receipt=JSON.parse(old.receipt) as {state:'open'|'closed';revision:number};assert();return{issue:current,requestId:input.requestId,replayed:true,changedSince:current.stateRevision!==receipt.revision,originalState:receipt.state,originalRevision:receipt.revision};}
  if(current.stateRevision!==input.expectedRevision)throw new IssueStateError('Issue changed. Refresh before choosing a new status.',409);
  if(this.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM issue_state_mutations').toArray()[0]!.count>=10000)throw new IssueStateError('Issue status audit capacity reached; original requests are preserved',413);
  assert();const next=this.apply(scope,input.state,actor.displayName);assert();this.storage.sql.exec('INSERT INTO issue_state_mutations VALUES(?,?,?,?,?)',actor.userId,input.requestId,scopeKey,payload,JSON.stringify({state:input.state,revision:next.stateRevision}));if(current.state!==next.state){const activity=this.storage.sql.exec<{id:number}>('INSERT INTO activity(at,actor,type,summary) VALUES(?,?,?,?) RETURNING id',next.updated_at,actor.displayName,next.state==='closed'?'issue.closed':'issue.reopened',`#${scope.number} ${next.state==='closed'?'closed':'reopened'} by ${actor.displayName}`).one();bindIssueActivity(this.storage,activity.id,{number:scope.number,incarnation:scope.incarnation});}return{issue:next,requestId:input.requestId,replayed:false,changedSince:false,originalState:input.state,originalRevision:next.stateRevision};
 });}
}
