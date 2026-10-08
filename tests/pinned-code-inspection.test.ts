import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {searchPinnedCode,blamePinnedFile} from '../src/server/pinned-code-inspection';
import {parseSignedRepositoryBrowseRequest} from '../src/server/public-repositories';
import type {RepositoryReader} from '../src/server/browse';
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'flaregit-code-inspection-'));
 const git=(...args:string[])=>{const r=Bun.spawnSync(['git','-C',directory,...args],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});if(r.exitCode)throw Error(r.stderr.toString());return r.stdout.toString().trim();};
 git('init','-q');git('config','user.name','Pinned author');git('config','user.email','author@example.test');
 await Bun.write(join(directory,'first.ts'),'shared\noriginal\n');git('add','.');git('commit','-qm','create');const root=git('rev-parse','HEAD');
 git('mv','first.ts','renamed.ts');git('commit','-qm','rename');const renamed=git('rev-parse','HEAD');
 await Bun.write(join(directory,'renamed.ts'),'shared\nchanged\n');await Bun.write(join(directory,'many.ts'),Array.from({length:70},(_,i)=>`shared ${i}`).join('\n'));git('add','.');git('commit','-qm','edit');
 const metadata=(hash:string)=>{const [actual,treeHash,parents,message,authoredAt,committedAt]=git('show','-s','--format=%H%n%T%n%P%n%s%n%at%n%ct',hash).split('\n'),author={name:'Pinned author',email:'author@example.test'};return {hash:actual!,treeHash:treeHash!,parents:parents?parents.split(' '):[],message:message!,author,committer:author,committedAt:Number(committedAt),authoredAt:Number(authoredAt)};};
 const repo:RepositoryReader={async log(){throw Error('Pinned inspections do not need mutable-ref log');},async readCommit(hash){return metadata(hash);},async readTree(hash){return git('ls-tree','-z',hash).split('\0').filter(Boolean).map(row=>{const [details,name]=row.split('\t'),[mode,type,hash]=details!.split(' ');return {mode:mode!,type:type==='tree'?'tree' as const:'blob' as const,hash:hash!,name:name!};});},async readBlob(hash){const r=Bun.spawnSync(['git','-C',directory,'cat-file','blob',hash]);if(r.exitCode)throw Error(r.stderr.toString());return new Blob([new Uint8Array(r.stdout)]);}};
 return {directory,repo,head:metadata('HEAD'),root,renamed,git,metadata};
}
test('pinned search reads real Git bytes and scopes paging to exact principal/revision/query',async()=>{const f=await fixture();try{
 const first=await searchPinnedCode(f.repo,f.head,{query:'SHARED',scope:'repo-incarnation:member-1',role:'member'});expect(first.matches).toHaveLength(50);expect(first.nextCursor).not.toBeNull();expect(first.indexComplete).toBe(true);expect(first.complete).toBe(false);
 const second=await searchPinnedCode(f.repo,f.head,{query:'shared',scope:'repo-incarnation:member-1',role:'member',cursor:first.nextCursor!});expect(second.matches).toHaveLength(21);expect(second.complete).toBe(true);
 for(const input of [{scope:'repo-incarnation:member-2',query:'shared'},{scope:'repo-incarnation:member-1',query:'changed'}])await expect(searchPinnedCode(f.repo,f.head,{...input,role:'member',cursor:first.nextCursor!})).rejects.toThrow('cursor does not match');
 const original=f.repo.readBlob;f.repo.readBlob=async()=>new Blob(['tampered']);await expect(searchPinnedCode(f.repo,f.head,{query:'shared',scope:'repo',role:'member'})).rejects.toThrow('hash does not match');f.repo.readBlob=original;
 }finally{rmSync(f.directory,{recursive:true,force:true});}},30000);
test('blame follows a unique exact rename across pinned Git parents and preserves source attribution',async()=>{const f=await fixture();try{
 const result=await blamePinnedFile(f.repo,f.head,'renamed.ts');expect(result.lines.map(line=>[line.text,line.sha])).toEqual([['shared',f.root],['changed',f.head.hash]]);expect(result.renames).toEqual([{commit:f.renamed,from:'first.ts',to:'renamed.ts'}]);expect(result).toMatchObject({complete:true,comparison:'first-parent',scannedCommits:3});
 expect(result.lines[0]).toMatchObject({author:'Pinned author',timestamp:new Date(Number(f.git('show','-s','--format=%ct',f.root))*1000).toISOString()});
 f.repo.readCommit=async()=>null;await expect(blamePinnedFile(f.repo,f.head,'renamed.ts')).rejects.toThrow('parent is unavailable');
 }finally{rmSync(f.directory,{recursive:true,force:true});}},30000);
test('search/blame requests require pinned commits and reject duplicate or extra scope fields before provider access',()=>{
 const hash='a'.repeat(40);expect(parseSignedRepositoryBrowseRequest('/code-search',new URLSearchParams({ref:hash,q:'literal'}))).toMatchObject({kind:'search',ref:hash});
 for(const query of [`ref=main&q=x`,`ref=${hash}&q=x&q=y`,`ref=${hash}&q=x&task=secret`])expect(()=>parseSignedRepositoryBrowseRequest('/code-search',new URLSearchParams(query))).toThrow();
 expect(()=>parseSignedRepositoryBrowseRequest('/blame',new URLSearchParams({ref:hash,path:'../hidden'}))).toThrow();
});
