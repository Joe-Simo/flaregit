import {z} from 'zod';
import {validateRepositoryPath} from './public-repositories';
import {validateRecoveryRemote} from './private-recovery-bundle';
import {q,gitAuthEnv} from './shell';
import type {BranchGitExecutor} from './branch-git';
const hash=z.string().regex(/^[a-f0-9]{40}$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const browserEditSchema=z.object({requestId:z.uuid(),expectedHead:hash,expectedTree:hash,path:z.string().min(1).max(1024),expectedBlob:hash.nullable(),contentBase64:z.string().max(350000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),contentSha256:digest,message:z.string().trim().min(1).max(300)}).strict();
export type BrowserEditInput=z.infer<typeof browserEditSchema>;
const identitySchema=z.object({projectId:z.string().min(1),incarnation:z.uuid(),canonicalRepoName:z.string().min(1),taskId:z.string().regex(/^[a-z0-9-]{3,101}$/),workspaceRepoName:z.string().min(1),providerRepoId:z.string().min(1),remote:z.string().min(1),branch:z.string().min(1),actorId:z.string().min(1),maintainerWriteSource:z.object({creatorId:z.string().min(1).max(256),revision:z.number().int().positive().safe()}).strict().optional(),authorName:z.string().min(1).max(120),authorEmail:z.string().min(1).max(200),createdAt:z.string().datetime(),input:browserEditSchema}).strict();
export type BrowserEditIdentity=z.infer<typeof identitySchema>;
const recordSchema=z.object({identity:identitySchema,phase:z.enum(['prepared','push_unknown','confirmed','refused']),blob:hash,commit:hash.optional(),tree:hash.optional(),reason:z.string().optional()}).strict();
export type BrowserEditRecord=z.infer<typeof recordSchema>;
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function browserEditBytes(input:BrowserEditInput){
  validateRepositoryPath(input.path);if(input.path.split('/').some(segment=>segment.toLowerCase()==='.git')||input.path.includes('\\')||/[\u0000-\u001f\u007f]/.test(input.path))throw Error('Unsafe browser edit path');
  const decoded=atob(input.contentBase64),bytes=Uint8Array.from(decoded,character=>character.charCodeAt(0));if(bytes.length>256*1024)throw Error('Browser edits are limited to 256 KiB');
  if(hex(await crypto.subtle.digest('SHA-256',bytes))!==input.contentSha256)throw Error('Uploaded content digest differs');
  const header=new TextEncoder().encode(`blob ${bytes.length}\0`),object=new Uint8Array(header.length+bytes.length);object.set(header);object.set(bytes,header.length);
  return {bytes,blob:hex(await crypto.subtle.digest('SHA-1',object))};
}
/** Exact browser contributions remain separate from canonical accepted history. */
export class BrowserEdits{
  constructor(private readonly storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS browser_edit_operations(id TEXT PRIMARY KEY,payload TEXT NOT NULL,doc TEXT NOT NULL)');}
  get(id:string){z.uuid().parse(id);const row=this.storage.sql.exec<{doc:string}>('SELECT doc FROM browser_edit_operations WHERE id=?',id).toArray()[0];return row?recordSchema.parse(JSON.parse(row.doc)):null;}
  prepare(identity:BrowserEditIdentity,blob:string,authorize:()=>void){const parsed=identitySchema.parse(identity);hash.parse(blob);if(parsed.branch!==`task/${parsed.taskId}`||parsed.workspaceRepoName===parsed.canonicalRepoName)throw Error('A private human contribution branch is required');validateRecoveryRemote(parsed.remote);return this.storage.transactionSync(()=>{authorize();const id=parsed.input.requestId,payload=JSON.stringify(parsed),row=this.storage.sql.exec<{payload:string;doc:string}>('SELECT payload,doc FROM browser_edit_operations WHERE id=?',id).toArray()[0];if(row){if(row.payload!==payload)throw Error('Browser edit retry belongs to different content or contribution');return recordSchema.parse(JSON.parse(row.doc));}if(this.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM browser_edit_operations').toArray()[0]!.count>=1000)throw Error('Browser edit history capacity reached');const record:BrowserEditRecord={identity:parsed,blob,phase:'prepared'};this.storage.sql.exec('INSERT INTO browser_edit_operations VALUES(?,?,?)',id,payload,JSON.stringify(record));return record;});}
  update(identity:BrowserEditIdentity,change:(record:BrowserEditRecord)=>void,authorize:()=>void){return this.storage.transactionSync(()=>{authorize();const record=this.get(identity.input.requestId);if(!record||JSON.stringify(record.identity)!==JSON.stringify(identity))throw Error('Browser edit identity changed');change(record);recordSchema.parse(record);this.storage.sql.exec('UPDATE browser_edit_operations SET doc=? WHERE id=?',JSON.stringify(record),identity.input.requestId);return record;});}
}
/** Bare Git plumbing never checks out or executes customer files, filters or hooks. */
export async function publishBrowserEdit(executor:BranchGitExecutor,record:BrowserEditRecord,token:string,saveProposal:(commit:string,tree:string)=>Promise<void>,markPush:()=>Promise<void>){
  record=recordSchema.parse(record);
  const {identity}=record,{input}=identity,ref=`refs/heads/${identity.branch}`,directory=`/workspace/browser-edit-${input.requestId}`;validateRecoveryRemote(identity.remote);
  const run=async(command:string,extra?:Record<string,string>)=>{await executor.beforeCommand('before');const result=await executor.exec(command,{...gitAuthEnv(token),...extra});await executor.beforeCommand('after');if(!result.success)throw Error('Browser contribution Git operation unconfirmed');return result.stdout.trim();};
  const observe=async()=>{const text=await run(`git ls-remote --refs ${q(identity.remote)} ${q(ref)}`);if(!text)return null;const match=/^([a-f0-9]{40})\t([^\n]+)$/.exec(text);if(!match||match[2]!==ref)throw Error('Contribution ref observation differs');return match[1]!;};
  const prior=await observe();if(record.phase==='push_unknown')return {confirmed:prior===record.commit,commit:record.commit,observed:prior};
  if(prior!==null&&prior!==input.expectedHead)throw Error('Contribution head changed; saved edit was not pushed');
  await run(`git init --quiet --bare ${q(directory)} && git -C ${q(directory)} fetch --quiet --no-tags ${q(identity.remote)} ${q(input.expectedHead)}`);
  const tree=await run(`git -C ${q(directory)} rev-parse --verify ${q(`${input.expectedHead}^{tree}`)}`);if(tree!==input.expectedTree)throw Error('Viewed tree differs from the contribution base');
  const existing=await run(`git -C ${q(directory)} ls-tree -rz ${q(input.expectedHead)} -- ${q(input.path)}`),entry=existing?/^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(existing):null;
  if(existing&&(!entry||entry[3]!==input.path)||input.expectedBlob!==(entry?.[2]??null))throw Error('Original path or file hash changed; symlinks and trees cannot be overwritten');
  // Each upload argument is at most 32 KiB. A bounded private file carries the
  // aggregate payload; no command embeds the entire upload or a credential.
  const upload=`${directory}/uploaded.base64`;
  await run(`umask 077; : > ${q(upload)}`);
  for(let offset=0;offset<input.contentBase64.length;offset+=32768)await run(`printf %s ${q(input.contentBase64.slice(offset,offset+32768))} >> ${q(upload)}`);
  const blob=await run(`base64 -d < ${q(upload)} | git -C ${q(directory)} hash-object -w --stdin`);if(blob!==record.blob)throw Error('Native uploaded blob digest differs');
  await run(`git -C ${q(directory)} read-tree ${q(input.expectedHead)} && git -C ${q(directory)} update-index --add --cacheinfo ${q(`${entry?.[1]??'100644'},${blob},${input.path}`)}`);
  const proposedTree=await run(`git -C ${q(directory)} write-tree`);if(!/^[a-f0-9]{40}$/.test(proposedTree))throw Error('Edited tree unavailable');
  const date=`@${Math.floor(Date.parse(identity.createdAt)/1000)} +0000`,commit=await run(`git -C ${q(directory)} commit-tree ${q(proposedTree)} -p ${q(input.expectedHead)} -m ${q(input.message)}`,{GIT_AUTHOR_NAME:identity.authorName,GIT_AUTHOR_EMAIL:identity.authorEmail,GIT_COMMITTER_NAME:identity.authorName,GIT_COMMITTER_EMAIL:identity.authorEmail,GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date});if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Edited commit unavailable');
  await saveProposal(commit,proposedTree);await markPush();
  // The durable push marker precedes dispatch. A lost acknowledgement can only read back this exact commit.
  try{await run(`git -C ${q(directory)} push --quiet --force-with-lease=${q(`${ref}:${prior??''}`)} ${q(identity.remote)} ${q(`${commit}:${ref}`)}`);}catch{/* Read back exact immutable commit; never issue a replacement push. */}
  const observed=await observe();return {confirmed:observed===commit,commit,observed};
}
