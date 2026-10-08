import {expect,test} from 'bun:test';
import {acceptedLfsPointers} from '../src/server/lfs-public';
import type {RepositoryReader} from '../src/server/browse';
const commit='a'.repeat(40),tree='b'.repeat(40),blob='c'.repeat(40),oid='d'.repeat(64);
const reader=(content:string):RepositoryReader=>({log:async()=>[],readCommit:async()=>({hash:commit,treeHash:tree,message:'Accepted',author:{name:'Owner',email:''},committer:{name:'Owner',email:''},parents:[],authoredAt:0,committedAt:0}),readTree:async()=>[{name:'binary.dat',hash:blob,type:'blob',mode:'100644'}],readBlob:async()=>new Blob([content])});
test('public LFS proof requires an exact approved pointer, never a guessed object URL',async()=>{
 expect(await acceptedLfsPointers(reader(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 7\n`),commit,[oid])).toEqual([{oid,size:7}]);
 expect(await acceptedLfsPointers(reader('ordinary file'),commit,[oid])).toEqual([]);
 expect(await acceptedLfsPointers(reader(`version https://git-lfs.github.com/spec/v1\noid sha256:${'e'.repeat(64)}\nsize 7\n`),commit,[oid])).toEqual([]);
});
test('public LFS proof refuses an incomplete approved tree instead of broadening visibility',async()=>{
 const source=reader('ordinary');source.readTree=async()=>null;
 await expect(acceptedLfsPointers(source,commit,[oid])).rejects.toThrow('incomplete');
});

const hash=(value:number)=>value.toString(16).padStart(40,'0');
const metadata=(value:number,treeValue:number,parents:number[]):ArtifactsCommitMetadata=>({hash:hash(value),treeHash:hash(treeValue),message:'Approved history',author:{name:'Owner',email:''},committer:{name:'Owner',email:''},parents:parents.map(hash),authoredAt:0,committedAt:0});
function historyReader(commits:ArtifactsCommitMetadata[],trees:ReadonlyMap<string,ArtifactsTreeEntry[]>,blobs:ReadonlyMap<string,string>){
 const reads:{commits:string[];blobs:string[]}={commits:[],blobs:[]},catalog=new Map(commits.map(value=>[value.hash,value]));
 const source:RepositoryReader={log:async()=>[],readCommit:async value=>{reads.commits.push(value);return catalog.get(value)??null;},readTree:async value=>trees.get(value)??null,readBlob:async value=>{reads.blobs.push(value);const text=blobs.get(value);return text===undefined?null:new Blob([text]);}};
 return{source,reads};
}
const pointerText=(value=oid)=>`version https://git-lfs.github.com/spec/v1\noid sha256:${value}\nsize 7\n`;
test('public LFS finds an executable pointer in an older reachable merge parent when the current tree is empty',async()=>{
 const {source,reads}=historyReader([metadata(1,11,[2,3]),metadata(2,12,[]),metadata(3,13,[])],new Map([[hash(11),[]],[hash(12),[]],[hash(13),[{name:'historical.dat',hash:hash(21),type:'exec',mode:'100755'}]]]),new Map([[hash(21),pointerText()]]));
 expect(await acceptedLfsPointers(source,hash(1),[oid])).toEqual([{oid,size:7}]);expect(reads.commits).toEqual([hash(1),hash(2),hash(3)]);
});
test('public LFS never inspects a private nonancestor head or follows a symlink to prove a guessed oid',async()=>{
 const {source,reads}=historyReader([metadata(1,11,[2]),metadata(2,12,[]),metadata(99,99,[])],new Map([[hash(11),[{name:'link',hash:hash(21),type:'symlink',mode:'120000'}]],[hash(12),[]],[hash(99),[{name:'private.dat',hash:hash(22),type:'blob',mode:'100644'}]]]),new Map([[hash(21),pointerText()],[hash(22),pointerText()]]));
 expect(await acceptedLfsPointers(source,hash(1),[oid])).toEqual([]);expect(reads.commits).not.toContain(hash(99));expect(reads.blobs).toEqual([]);
});
test('public historical LFS denies incomplete ancestor inspection at the configured bound',async()=>{
 const {source}=historyReader([metadata(1,11,[2]),metadata(2,11,[3]),metadata(3,13,[])],new Map([[hash(11),[]],[hash(13),[{name:'older.dat',hash:hash(21),type:'blob',mode:'100644'}]]]),new Map([[hash(21),pointerText()]]));
 await expect(acceptedLfsPointers(source,hash(1),[oid],{maxCommits:2})).rejects.toThrow('commit bound; proof is incomplete');
});
test('public historical LFS caches repeated immutable blobs and explicitly refuses unsupported pointer extensions',async()=>{
 const shared={name:'ordinary.txt',hash:hash(21),type:'blob' as const,mode:'100644'};
 const {source,reads}=historyReader([metadata(1,11,[2]),metadata(2,12,[])],new Map([[hash(11),[shared]],[hash(12),[shared]]]),new Map([[hash(21),'ordinary accepted source']]));
 expect(await acceptedLfsPointers(source,hash(1),[oid])).toEqual([]);expect(reads.blobs).toEqual([hash(21)]);
 const unsupported=reader(`version https://git-lfs.github.com/spec/v1\next-0-custom sha256:${oid}\noid sha256:${oid}\nsize 7\n`);
 await expect(acceptedLfsPointers(unsupported,commit,[oid])).rejects.toThrow('unsupported fields or encoding; proof is incomplete');
});

test('public historical LFS matches the requested object size rather than a newer inconsistent pointer',async()=>{
 const {source}=historyReader([metadata(1,11,[2]),metadata(2,12,[])],new Map([[hash(11),[{name:'newer.dat',hash:hash(21),type:'blob',mode:'100644'}]],[hash(12),[{name:'older.dat',hash:hash(22),type:'blob',mode:'100644'}]]]),new Map([[hash(21),pointerText().replace('size 7','size 8')],[hash(22),pointerText()]]));
 expect(await acceptedLfsPointers(source,hash(1),[{oid,size:7}])).toEqual([{oid,size:7}]);
});
