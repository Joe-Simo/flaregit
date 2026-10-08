import {searchCode,validateCodeSearchQuery,type SearchableFile} from '../core/code-search';
import {blame,type Commit as BlameCommit,MAX_BLAME_LINES} from '../core/blame';
import {RepositoryBrowseRequestError,validateRepositoryPath} from './public-repositories';
import {resolveCommit,type CommitInfo,type RepositoryReader,type TreeEntry} from './browse';

const MAX_FILES=200,MAX_TREES=200,MAX_INDEX_BYTES=4*1024*1024,MAX_FILE_BYTES=256*1024,MAX_ANCESTORS=64;
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
const digest=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
export class CodeInspectionError extends Error{constructor(message:string,readonly status:400|404|413|503=413){super(message);}}
/** These immutable objects live only inside one authority-rechecked repository request. */
async function textObject(repo:RepositoryReader,hash:string,budget:{bytes:number}){
 const blob=await repo.readBlob(hash);if(!blob)throw new CodeInspectionError('Pinned file object is unavailable',503);
 if(blob.size>MAX_FILE_BYTES)return {text:null,reason:'Files larger than 256 KiB were excluded'};
 if(budget.bytes+blob.size>MAX_INDEX_BYTES)return {text:null,reason:'The 4 MiB text inspection bound was reached'};
 const bytes=new Uint8Array(await blob.arrayBuffer());budget.bytes+=bytes.length;
 if(bytes.length!==blob.size)throw new CodeInspectionError('Pinned file size changed',503);
 const header=new TextEncoder().encode(`blob ${bytes.length}\0`),object=new Uint8Array(header.length+bytes.length);object.set(header);object.set(bytes,header.length);
 if(hex(await crypto.subtle.digest('SHA-1',object))!==hash)throw new CodeInspectionError('Pinned file hash does not match its bytes',503);
 if(bytes.includes(0))return {text:null,reason:null};
 try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),reason:null};}catch{return {text:null,reason:null};}
}
async function enumerate(repo:RepositoryReader,treeHash:string){
 const files:Array<{path:string;entry:TreeEntry}>=[],pending=[{hash:treeHash,prefix:''}];let trees=0;let reason:string|null=null;
 while(pending.length){if(trees>=MAX_TREES){reason='The 200-tree inspection bound was reached';break;}const frame=pending.pop()!,entries=await repo.readTree(frame.hash);trees++;
 if(!entries)throw new CodeInspectionError('Pinned repository tree is unavailable',503);
 if(entries.length>10000)throw new CodeInspectionError('A repository tree exceeds inspection capacity');
 for(const entry of [...entries].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).reverse()){
  if(!entry.name||entry.name.includes('/')||entry.name==='.'||entry.name==='..'||entry.name.includes('\0'))throw new CodeInspectionError('Repository tree contains an unsafe path',503);
  const path=frame.prefix?`${frame.prefix}/${entry.name}`:entry.name;
  if(entry.type==='tree')pending.push({hash:entry.hash,prefix:path});else if(entry.type==='blob'&&entry.mode!=='160000')files.push({path,entry:{name:entry.name,hash:entry.hash,mode:entry.mode,type:'blob'}});
  if(files.length>10000)throw new CodeInspectionError('Repository file inventory exceeds inspection capacity');
 }
 }
 return {files:files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),reason};
}
export type PinnedSearchResult=Awaited<ReturnType<typeof searchPinnedCode>>;
/** Cursor scope includes current principal, repository incarnation/permission context, exact commit and query. No cross-request private index is retained. */
export async function searchPinnedCode(repo:RepositoryReader,head:CommitInfo,input:{query:string;cursor?:string;scope:string;role:'owner'|'member'}){
 const query=validateCodeSearchQuery(input.query);if(!query.ok)throw new RepositoryBrowseRequestError(query.error);
 const scopeKey=await digest(JSON.stringify([input.scope,input.role,head.hash,query.query]));let offset:string|undefined;
 if(input.cursor){try{if(input.cursor.length>512||!/^[A-Za-z0-9_-]+$/.test(input.cursor))throw Error();const parsed=JSON.parse(atob(input.cursor.replaceAll('-','+').replaceAll('_','/'))) as {key?:unknown;offset?:unknown};if(parsed.key!==scopeKey||typeof parsed.offset!=='string'||!/^(0|[1-9][0-9]*)$/.test(parsed.offset))throw Error();offset=parsed.offset;}catch{throw new RepositoryBrowseRequestError('Search cursor does not match this repository, revision, permission or query');}}
 const inventory=await enumerate(repo,head.treeHash),budget={bytes:0},files:SearchableFile[]=[],reasons=new Set<string>();if(inventory.reason)reasons.add(inventory.reason);
 for(const file of inventory.files.slice(0,MAX_FILES)){const result=await textObject(repo,file.entry.hash,budget);if(result.reason)reasons.add(result.reason);if(result.text!==null)files.push({path:file.path,text:result.text,access:'members'});}
 if(inventory.files.length>MAX_FILES)reasons.add('Only the first 200 files were inspected; use Git for a complete repository search');
 const result=searchCode({files,query:query.query,actor:{role:input.role},cursor:offset});if(!result.ok)throw new RepositoryBrowseRequestError(result.error);
 if(result.reason)reasons.add(result.reason);
 const nextCursor=result.nextCursor===null?null:btoa(JSON.stringify({key:scopeKey,offset:result.nextCursor})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 return {...result,commit:head.hash,nextCursor,complete:result.complete&&reasons.size===0,indexComplete:reasons.size===0,reason:reasons.size?[...reasons].join('; '):null,textOnly:true as const,indexedBytes:budget.bytes};
}
async function fileAt(repo:RepositoryReader,commit:CommitInfo,path:string):Promise<TreeEntry|null>{
 const segments=path.split('/');let tree=commit.treeHash;
 for(let i=0;i<segments.length;i++){const entries=await repo.readTree(tree);if(!entries)throw new CodeInspectionError('Pinned history tree is unavailable',503);const entry=entries.find(item=>item.name===segments[i]);if(!entry)return null;if(i===segments.length-1)return entry.type==='blob'&&entry.mode!=='160000'?{name:entry.name,hash:entry.hash,mode:entry.mode,type:'blob'}:null;if(entry.type!=='tree')return null;tree=entry.hash;}
 return null;
}
export type PinnedBlameResult=Awaited<ReturnType<typeof blamePinnedFile>>;
/** Complete first-parent ancestry only. Uniquely identical moved blobs can be followed; modified/ambiguous moves are disclosed as unsupported. */
export async function blamePinnedFile(repo:RepositoryReader,head:CommitInfo,path:string){
 validateRepositoryPath(path);if(!path)throw new RepositoryBrowseRequestError('File path required');
 const history:BlameCommit[]=[],renames:Array<{commit:string;from:string;to:string}>=[],budget={bytes:0};let current:CommitInfo|null=head,currentPath=path;
 while(current){if(history.length>=MAX_ANCESTORS)throw new CodeInspectionError('Blame requires complete ancestry and is limited to 64 first-parent commits; use Git for deeper history');
 const entry=await fileAt(repo,current,currentPath);if(history.length===0&&!entry)throw new CodeInspectionError('File not found',404);
 const text=entry?await textObject(repo,entry.hash,budget):{text:null,reason:null};if(entry&&text.text===null)throw new CodeInspectionError(text.reason??'Blame supports UTF-8 text files only');
 if(text.text!==null&&text.text.split('\n').length>MAX_BLAME_LINES+1)throw new CodeInspectionError('Blame is limited to 5000 lines');
 const parentHash=current.parents[0]??null;
 history.push({sha:current.hash,parent:parentHash,author:current.author.name,timestamp:new Date(current.committedAt).toISOString(),files:text.text===null?{}:{[path]:text.text}});
 if(!parentHash)break;
 const parent=await resolveCommit(repo,parentHash);if(!parent||parent.hash!==parentHash)throw new CodeInspectionError('Pinned history parent is unavailable',503);
 if(entry&&!await fileAt(repo,parent,currentPath)){
 const candidates=(await enumerate(repo,parent.treeHash));if(candidates.reason)throw new CodeInspectionError('Rename inspection exceeded its tree bound');
 const identical=candidates.files.filter(file=>file.entry.hash===entry.hash&&file.entry.mode===entry.mode);
 if(identical.length===1){const source=identical[0]!;if(!await fileAt(repo,current,source.path)){renames.push({commit:current.hash,from:source.path,to:currentPath});currentPath=source.path;}}
 }
 current=parent;
 }
 const result=blame(history,path,head.hash);if(!result.ok)throw new CodeInspectionError(result.error);
 return {commit:head.hash,path,lines:result.lines,comparison:'first-parent' as const,renameTracking:'unique-exact-content' as const,renames,complete:true as const,scannedCommits:history.length};
}
