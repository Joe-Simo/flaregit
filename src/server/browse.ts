import type { ArtifactsRepoCapability } from "../artifacts/cloudflare.js";
import { RepositoryReadError } from "./repository-read-budget.js";
export type RepositoryReader = Pick<ArtifactsRepoCapability, "log" | "readCommit" | "readTree" | "readBlob">;

export interface CommitInfo {
  hash: string;
  treeHash: string;
  message: string;
  author: { name: string; email: string };
  parents: string[];
  committedAt: number;
}

export interface TreeEntry {
  name: string;
  type: "blob" | "tree";
  hash: string;
  mode: string;
}

const HEX40 = /^[0-9a-f]{40}$/;
const MAX_BLOB_BYTES = 4 * 1024 * 1024;

const asCommit = (c: ArtifactsCommitMetadata): CommitInfo => ({
  hash: c.hash,
  treeHash: c.treeHash,
  message: String(c.message ?? ""),
  author: { name: c.author?.name ?? "", email: c.author?.email ?? "" },
  parents: c.parents ?? [],
  committedAt: c.committedAt ?? c.authoredAt ?? 0,
});

export async function listCommits(repo: RepositoryReader, ref: string | undefined, limit: number, offset: number): Promise<CommitInfo[]> {
  const opts: Record<string, unknown> = { limit: Math.min(Math.max(limit, 1), 100), offset: Math.max(offset, 0) };
  if (ref && ref !== "HEAD") opts.ref = HEX40.test(ref) ? ref : ref;
  let rows = await repo.log(opts);
  if (rows.length === 0 && ref && !HEX40.test(ref) && !ref.startsWith("refs/")) rows = await repo.log({ ...opts, ref: `refs/heads/${ref}` });
  return rows.map(asCommit);
}

export async function resolveCommit(repo: RepositoryReader, ref: string | undefined): Promise<CommitInfo | null> {
  if (ref && HEX40.test(ref)) {
    const c = await repo.readCommit(ref);
    return c ? asCommit(c) : null;
  }
  const [head] = await listCommits(repo, ref, 1, 0);
  return head ?? null;
}

const cleanPath = (path: string | undefined): string[] => {
  const parts = (path ?? "").split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) throw new Error("Invalid path");
  return parts;
};

async function entriesAt(repo: RepositoryReader, commit: CommitInfo, segments: string[]): Promise<TreeEntry[]> {
  let entries = (await repo.readTree(commit.treeHash)) as TreeEntry[] | null;
  if (!entries) throw new Error("Tree not found");
  for (const seg of segments) {
    const next = entries.find((e) => e.name === seg && e.type === "tree");
    if (!next) throw new Error("Path not found");
    entries = (await repo.readTree(next.hash)) as TreeEntry[] | null;
    if (!entries) throw new Error("Path not found");
  }
  return entries;
}

export async function listDirectory(repo: RepositoryReader, commit: CommitInfo, path: string | undefined): Promise<TreeEntry[]> {
  const entries = await entriesAt(repo, commit, cleanPath(path));
  // Folders first, then files, each alphabetical (the order people expect from a code browser).
  return [...entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1));
}

export async function readFileText(
  repo: RepositoryReader,
  commit: CommitInfo,
  path: string
): Promise<{ binary: boolean; truncated: boolean; size: number; content: string }> {
  const segments = cleanPath(path);
  const name = segments.pop();
  if (!name) throw new Error("Path required");
  const entries = await entriesAt(repo, commit, segments);
  const entry = entries.find((e) => e.name === name && e.type === "blob");
  if (!entry) throw new Error("File not found");
  const blob = await repo.readBlob(entry.hash);
  if (!blob) throw new Error("File not found");
  if (blob.size > MAX_BLOB_BYTES) return { binary: false, truncated: true, size: blob.size, content: "" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.subarray(0, 8000).includes(0)) return { binary: true, truncated: false, size: blob.size, content: "" };
  return { binary: false, truncated: false, size: blob.size, content: new TextDecoder().decode(bytes) };
}

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  aHash?: string;
  bHash?: string;
  mode?: string;
}

const MAX_CHANGED_FILES = 5000;
const MAX_DIFF_RESULT_BYTES = 16 * 1024 * 1024;

/** Tree-to-tree comparison using only hashes: unchanged subtrees are skipped without being read. */
export async function diffTrees(
  repo: RepositoryReader,
  treeA: string | undefined,
  treeB: string | undefined,
  prefix = "",
  out: FileChange[] = []
): Promise<FileChange[]> {
  let resultBytes = out.reduce((sum, change) => sum + new TextEncoder().encode(JSON.stringify(change)).length, 0);
  if (resultBytes > MAX_DIFF_RESULT_BYTES) throw new RepositoryReadError(413, "metadata_capacity");
  const append = (change: FileChange) => {
    resultBytes += new TextEncoder().encode(JSON.stringify(change)).length;
    if (resultBytes > MAX_DIFF_RESULT_BYTES) throw new RepositoryReadError(413, "metadata_capacity");
    out.push(change);
    if (out.length > MAX_CHANGED_FILES) throw new Error("Diff exceeds the supported 5,000-file inspection limit; no complete diff was recorded");
  };
  if (out.length > MAX_CHANGED_FILES) throw new Error("Diff exceeds the supported 5,000-file inspection limit; no complete diff was recorded");
  type Frame = { kind: "trees"; a?: string; b?: string; path: string } | { kind: "change"; change: FileChange };
  const pending: Frame[] = [{ kind: "trees", a: treeA, b: treeB, path: prefix }];
  while (pending.length) {
    const frame = pending.pop()!;
    if (frame.kind === "change") { append(frame.change); continue; }
    if (frame.a === frame.b) continue;
    const [a, b] = await Promise.all([frame.a ? repo.readTree(frame.a) : Promise.resolve([]), frame.b ? repo.readTree(frame.b) : Promise.resolve([])]);
    if ((frame.a && !a) || (frame.b && !b)) throw new Error("Could not read a repository tree; retry the diff");
    const aMap = new Map((a ?? []).map(entry => [entry.name, entry as TreeEntry]));
    const bMap = new Map((b ?? []).map(entry => [entry.name, entry as TreeEntry]));
    const names = [...new Set([...aMap.keys(), ...bMap.keys()])].sort();
    // Reverse insertion preserves the existing alphabetical depth-first result.
    for (const name of names.reverse()) {
      const ea = aMap.get(name), eb = bMap.get(name);
      if (ea && eb && ea.hash === eb.hash && ea.type === eb.type) continue;
      const path = frame.path ? `${frame.path}/${name}` : name;
      if (ea?.type === "tree" || eb?.type === "tree") {
        if (ea?.type === "blob") pending.push({ kind: "change", change: { path, status: "deleted", aHash: ea.hash } });
        if (eb?.type === "blob") pending.push({ kind: "change", change: { path, status: "added", bHash: eb.hash, mode: eb.mode } });
        pending.push({ kind: "trees", a: ea?.type === "tree" ? ea.hash : undefined, b: eb?.type === "tree" ? eb.hash : undefined, path });
      } else pending.push({ kind: "change", change: { path, status: !ea ? "added" : !eb ? "deleted" : "modified", aHash: ea?.hash, bHash: eb?.hash, mode: (eb ?? ea)?.mode } });
    }
  }
  return out;
}

export async function readBlobByHash(repo: RepositoryReader, hash: string): Promise<{ binary: boolean; truncated: boolean; size: number; content: string }> {
  const blob = await repo.readBlob(hash);
  if (!blob) throw new Error("Blob not found");
  if (blob.size > MAX_BLOB_BYTES) return { binary: false, truncated: true, size: blob.size, content: "" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.subarray(0, 8000).includes(0)) return { binary: true, truncated: false, size: blob.size, content: "" };
  return { binary: false, truncated: false, size: blob.size, content: new TextDecoder().decode(bytes) };
}


type ImmutableTreeEntries=NonNullable<Awaited<ReturnType<RepositoryReader['readTree']>>>;
type ImmutableFileEntry=ImmutableTreeEntries[number];
type HistoryTreeCache=Map<string,ImmutableTreeEntries>;
async function historyTree(repo:RepositoryReader,hash:string,cache:HistoryTreeCache){
  const old=cache.get(hash);if(old)return old;const entries=await repo.readTree(hash);
  if(!entries)throw Error('History tree is unavailable; no complete page was returned');
  cache.set(hash,entries);return entries;
}
const isHistoryFile=(entry:ImmutableFileEntry)=>entry.type!=='tree'&&entry.mode!=='160000';
export async function repositoryEntryAtCommit(repo:RepositoryReader,commit:CommitInfo,path:string,cache:HistoryTreeCache=new Map()):Promise<ImmutableFileEntry|null>{
  const segments=cleanPath(path);let hash=commit.treeHash;
  for(let index=0;index<segments.length;index++){
    const entries=await historyTree(repo,hash,cache),entry=entries.find(item=>item.name===segments[index]);if(!entry)return null;
    if(index===segments.length-1)return entry;if(entry.type!=='tree')return null;hash=entry.hash;
  }
  return null;
}
/** Shared with blame: only one identical object at a new path, with no copy remaining at that path in the source snapshot, proves a conservative move. */
export async function findUniqueExactMovedFile(repo:RepositoryReader,from:CommitInfo,to:CommitInfo,path:string,cache:HistoryTreeCache=new Map()){
  const source=await repositoryEntryAtCommit(repo,from,path,cache);if(!source||!isHistoryFile(source)||await repositoryEntryAtCommit(repo,to,path,cache))return {kind:'none' as const};
  const candidates:Array<{path:string;entry:ImmutableFileEntry}>=[],pending=[{hash:to.treeHash,prefix:''}];let trees=0,files=0;
  while(pending.length){
    if(++trees>200)return {kind:'bounded' as const,reason:'Exact rename inspection exceeded 200 trees; older lineage is incomplete'};
    const frame=pending.pop()!,entries=await historyTree(repo,frame.hash,cache);
    if(entries.length>10000)return {kind:'bounded' as const,reason:'Exact rename inspection exceeded its tree-entry bound; older lineage is incomplete'};
    for(const entry of entries){
      if(!entry.name||entry.name.includes('/')||entry.name.includes('\\')||entry.name==='.'||entry.name==='..'||entry.name.includes('\0'))throw Error('History tree contains an unsafe path');
      const candidatePath=frame.prefix?`${frame.prefix}/${entry.name}`:entry.name;
      if(entry.type==='tree')pending.push({hash:entry.hash,prefix:candidatePath});
      else if(isHistoryFile(entry)){
        if(++files>10000)return {kind:'bounded' as const,reason:'Exact rename inspection exceeded 10000 files; older lineage is incomplete'};
        if(entry.hash===source.hash&&entry.mode===source.mode&&entry.type===source.type)candidates.push({path:candidatePath,entry});
      }
    }
  }
  if(candidates.length>1)return {kind:'ambiguous' as const,reason:'Several paths contain the same unchanged object; rename lineage is ambiguous'};
  const candidate=candidates[0];
  if(!candidate||await repositoryEntryAtCommit(repo,from,candidate.path,cache))return {kind:'none' as const};
  return {kind:'unique' as const,...candidate};
}
export interface FileHistoryPage {
  readonly commit:string;
  readonly path:string;
  readonly headPath:string|null;
  readonly commits:readonly (CommitInfo&{readonly pathExists:boolean;readonly path:string;readonly renamedFrom?:string;readonly renamedTo?:string})[];
  /** Pagination counts examined first-parent commits. Each pinned page reconstructs earlier rename decisions rather than trusting a mutable cursor. */
  readonly nextOffset:number|null;
  readonly scanned:number;
  readonly comparison:'first-parent';
  readonly followsRenames:true;
  readonly renameTracking:'unique-exact-content';
  readonly complete:boolean;
  readonly reason:string|null;
}
/** Immutable first-parent file history. Modified renames and copies are not inferred. Request-local object caches never outlive the authority-rechecked request. */
export async function listFileHistory(repo:RepositoryReader,head:CommitInfo,path:string,limit:number,offset:number):Promise<FileHistoryPage>{
  if(!cleanPath(path).length||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>=1000)throw Error('Invalid file history request or 1000-ancestor history bound exceeded');
  const cache:HistoryTreeCache=new Map(),visited:CommitInfo[]=[],seen=new Set<string>(),commits:Array<CommitInfo&{pathExists:boolean;path:string;renamedFrom?:string;renamedTo?:string}>=[];
  const presentAtHead=Boolean(await repositoryEntryAtCommit(repo,head,path,cache));
  let current:CommitInfo|null=head,currentPath=path,index=0,reason:string|null=null,headPath=presentAtHead?path:null;
  const stop=Math.min(offset+limit,1000);
  while(current&&index<stop){
    if(seen.has(current.hash))throw Error('History ancestry contains a cycle');seen.add(current.hash);visited.push(current);
    const parentHash:string|null=current.parents[0]??null,parent:CommitInfo|null=parentHash?await resolveCommit(repo,parentHash):null;
    if(parentHash&&(!parent||parent.hash!==parentHash))throw Error('History parent is unavailable; no complete page was returned');
    const entry=await repositoryEntryAtCommit(repo,current,currentPath,cache),previous=parent?await repositoryEntryAtCommit(repo,parent,currentPath,cache):null;
    let rowPath=currentPath,rowExists=entry!==null,olderPath=currentPath,renamedFrom:string|undefined,renamedTo:string|undefined;
    if(parent&&entry&&!previous){
      const moved=await findUniqueExactMovedFile(repo,current,parent,currentPath,cache);
      if(moved.kind==='unique'){renamedFrom=moved.path;renamedTo=currentPath;olderPath=moved.path;}
      else if(moved.kind==='ambiguous'||moved.kind==='bounded')reason=moved.reason;
    }else if(parent&&!entry&&previous){
      const moved=await findUniqueExactMovedFile(repo,parent,current,currentPath,cache);
      if(moved.kind==='unique'){
        renamedFrom=currentPath;renamedTo=moved.path;rowPath=moved.path;rowExists=true;
        if(headPath===null){
          let latestPath:string|null=moved.path,from=current;
          for(const next of visited.slice(0,-1).reverse()){
            if(latestPath===null)break;
            if(!await repositoryEntryAtCommit(repo,next,latestPath,cache)){
              const forward=await findUniqueExactMovedFile(repo,from,next,latestPath,cache);
              if(forward.kind==='unique')latestPath=forward.path;
              else{if(forward.kind==='ambiguous'||forward.kind==='bounded')reason=forward.reason;latestPath=null;break;}
            }
            from=next;
          }
          headPath=latestPath;
        }
      }else if(moved.kind==='ambiguous'||moved.kind==='bounded')reason=moved.reason;
    }
    const key=(value:ImmutableFileEntry|null)=>value?`${value.type}:${value.mode}:${value.hash}`:null;
    if(index>=offset&&(renamedFrom!==undefined||key(entry)!==key(previous)))commits.push({...current,path:rowPath,pathExists:rowExists,...(renamedFrom!==undefined?{renamedFrom,renamedTo}:{})});
    currentPath=olderPath;index++;current=parent;
    if(reason)break;
  }
  if(current&&index===1000&&reason===null)reason='The 1000-ancestor history bound was reached; older lineage is incomplete';
  if(!presentAtHead&&headPath!==null&&headPath!==path&&reason===null){
    // An old issue permalink may name the pre-rename path. Rewalk the resolved
    // head path so its later edits/renames are included, reusing only this request's immutable tree cache.
    const sameRequest:RepositoryReader={log:options=>repo.log(options),readCommit:hash=>repo.readCommit(hash),readTree:hash=>historyTree(repo,hash,cache),readBlob:hash=>repo.readBlob(hash)};
    return {...await listFileHistory(sameRequest,head,headPath,limit,offset),path};
  }
  return {commit:head.hash,path,headPath,commits,scanned:Math.max(0,index-offset),nextOffset:current&&!reason?index:null,comparison:'first-parent',followsRenames:true,renameTracking:'unique-exact-content',complete:current===null&&reason===null,reason};
}
