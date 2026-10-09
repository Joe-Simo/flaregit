import type {RepositoryReader} from './browse';
import {LfsStorageError} from './lfs-store';
import type {LfsObjectRef} from '../core/git-lfs';
export interface PublicLfsProof {acceptedCommit:string;incarnation:string;publicationVersion:number;objects:LfsObjectRef[]}
export interface PublicLfsInspectionLimits {maxCommits?:number;maxTrees?:number;maxEntries?:number;deadlineMs?:number}
const HASH=/^[a-f0-9]{40}$/;
const POINTER_VERSION='version https://git-lfs.github.com/spec/v1';
/** Inspect only the frozen approved commit and its actual parent graph, including
 * merge parents. The caller separately fences publication before/after inspection
 * and every object stream. Private task heads and caller-selected roots never enter it. */
export async function acceptedLfsPointers(reader:RepositoryReader,commit:string,wanted:readonly (string|LfsObjectRef)[],limits:PublicLfsInspectionLimits={}):Promise<LfsObjectRef[]>{
 if(!HASH.test(commit)||wanted.length>100||wanted.some(value=>!/^[a-f0-9]{64}$/.test(typeof value==='string'?value:value.oid)||typeof value!=='string'&&(!Number.isSafeInteger(value.size)||value.size<0)))throw new LfsStorageError('Invalid accepted LFS inspection scope',400);
 const caps={maxCommits:limits.maxCommits??1000,maxTrees:limits.maxTrees??512,maxEntries:limits.maxEntries??4096,deadlineMs:limits.deadlineMs??120000};
 if(!Object.values(caps).every(value=>Number.isSafeInteger(value)&&value>0)||caps.maxCommits>1000||caps.maxTrees>512||caps.maxEntries>4096||caps.deadlineMs>120000)throw new LfsStorageError('Invalid accepted LFS inspection bounds',400);
 const deadline=Date.now()+caps.deadlineMs,checkTime=()=>{if(Date.now()>=deadline)throw new LfsStorageError('Accepted LFS history inspection reached its deadline; proof is incomplete',503);};
 const expected=new Map<string,number|undefined>(wanted.map(value=>typeof value==='string'?[value,undefined] as const:[value.oid,value.size] as const));
 const remaining=new Set(expected.keys()),found=new Map<string,LfsObjectRef>(),commits=[commit],seenCommits=new Set<string>(),seenTrees=new Set<string>();
 const treeCache=new Map<string,ArtifactsTreeEntry[]>(),blobCache=new Map<string,LfsObjectRef|null>();let inspected=0;
 while(commits.length&&remaining.size){
  checkTime();const current=commits.pop()!;if(seenCommits.has(current))continue;seenCommits.add(current);
  if(seenCommits.size>caps.maxCommits)throw new LfsStorageError('Accepted LFS ancestor inspection reached its commit bound; proof is incomplete',413);
  const approved=await reader.readCommit(current);checkTime();
  if(!approved||approved.hash!==current||!HASH.test(approved.treeHash)||!Array.isArray(approved.parents)||approved.parents.length>1000||approved.parents.some(parent=>!HASH.test(parent)))throw new LfsStorageError('Accepted ancestor inspection is incomplete',503);
  // Each parent is obtained from the immutable canonical commit itself.
  for(const parent of [...approved.parents].reverse())if(!seenCommits.has(parent))commits.push(parent);
  if(commits.length>caps.maxCommits)throw new LfsStorageError('Accepted LFS ancestor frontier reached its bound; proof is incomplete',413);
  const pending=[approved.treeHash];
  while(pending.length&&remaining.size){
   checkTime();const tree=pending.pop()!;if(seenTrees.has(tree))continue;seenTrees.add(tree);
   if(seenTrees.size>caps.maxTrees)throw new LfsStorageError('Accepted LFS traversal reached its tree bound; proof is incomplete',413);
   let entries=treeCache.get(tree);if(!entries){const observed=await reader.readTree(tree);checkTime();if(!observed)throw new LfsStorageError('Accepted tree inspection is incomplete',503);entries=observed;treeCache.set(tree,entries);}
   if(entries.length>caps.maxEntries-inspected)throw new LfsStorageError('Accepted LFS traversal reached its entry bound; proof is incomplete',413);
   for(const entry of entries){
    checkTime();inspected++;if(!HASH.test(entry.hash))throw new LfsStorageError('Accepted tree has an invalid object identity',503);
    if(entry.type==='tree'&&(entry.mode==='40000'||entry.mode==='040000')){pending.push(entry.hash);continue;}
    if(!((entry.type==='blob'&&entry.mode==='100644')||(entry.type==='exec'&&entry.mode==='100755')))continue;
    let pointer=blobCache.get(entry.hash);
    if(pointer===undefined){const blob=await reader.readBlob(entry.hash);checkTime();if(!blob)throw new LfsStorageError('Accepted blob inspection is incomplete',503);
     if(blob.size>1024){const prefix=new TextDecoder().decode(await blob.slice(0,128).arrayBuffer());checkTime();if(prefix.startsWith(POINTER_VERSION))throw new LfsStorageError('Accepted LFS pointer exceeds the supported pointer bound; proof is incomplete',413);pointer=null;}
     else{const text=(await blob.text()).replace(/\r\n/g,'\n');checkTime();const parsed=/^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize ([0-9]+)\n?$/.exec(text);
      if(!parsed){if(text.startsWith(POINTER_VERSION))throw new LfsStorageError('Accepted LFS pointer uses unsupported fields or encoding; proof is incomplete',415);pointer=null;}
      else{const size=Number(parsed[2]);if(!Number.isSafeInteger(size))throw new LfsStorageError('Accepted LFS pointer size is invalid',503);pointer={oid:parsed[1]!,size};}
     }
     blobCache.set(entry.hash,pointer);
    }
    if(pointer&&remaining.has(pointer.oid)&&(expected.get(pointer.oid)===undefined||expected.get(pointer.oid)===pointer.size)){found.set(pointer.oid,pointer);remaining.delete(pointer.oid);if(!remaining.size)break;}
   }
  }
 }
 checkTime();return [...found.values()];
}
