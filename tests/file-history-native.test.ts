import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listFileHistory,type RepositoryReader} from '../src/server/browse';
import {blamePinnedFile} from '../src/server/pinned-code-inspection';
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'flaregit-rename-history-'));
  const git=(...args:string[])=>{const result=Bun.spawnSync(['git','-C',directory,...args],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'/dev/null'}});if(result.exitCode)throw Error(result.stderr.toString());return result.stdout.toString().trim();};
  git('init','-q','-b','main');git('config','user.name','History author');git('config','user.email','history@example.test');
  const metadata=(hash:string)=>{const [actual,treeHash,parents,message,authoredAt,committedAt]=git('show','-s','--format=%H%n%T%n%P%n%s%n%at%n%ct',hash).split('\n'),author={name:'History author',email:'history@example.test'};return {hash:actual!,treeHash:treeHash!,parents:parents?parents.split(' '):[],message:message!,author,committer:author,authoredAt:Number(authoredAt),committedAt:Number(committedAt)};};
  const repo:RepositoryReader={async log(){throw Error('File history must walk pinned first-parent objects, never mutable log ordering');},async readCommit(hash){return metadata(hash);},async readTree(hash){return git('ls-tree','-z',hash).split('\0').filter(Boolean).map(row=>{const [details,name]=row.split('\t'),[mode,type,hash]=details!.split(' ');return {name:name!,mode:mode!,type:type==='tree'?'tree' as const:'blob' as const,hash:hash!};});},async readBlob(hash){const result=Bun.spawnSync(['git','-C',directory,'cat-file','blob',hash]);if(result.exitCode)throw Error(result.stderr.toString());return new Blob([new Uint8Array(result.stdout)]);}};
  return {directory,git,metadata,repo,close:()=>rm(directory,{recursive:true,force:true})};
}
test('real pinned history follows two exact renames across an edit, pages old paths, and resolves an old issue path at the latest head',async()=>{
  const f=await fixture();
  try{
    await Bun.write(join(f.directory,'old.ts'),'original\n');f.git('add','.');f.git('commit','-qm','create');const root=f.git('rev-parse','HEAD');
    f.git('mv','old.ts','middle.ts');f.git('commit','-qm','first rename');const firstRename=f.git('rev-parse','HEAD');
    await Bun.write(join(f.directory,'middle.ts'),'changed\n');f.git('add','.');f.git('commit','-qm','edit');
    f.git('mv','middle.ts','latest.ts');f.git('commit','-qm','second rename');
    await Bun.write(join(f.directory,'unrelated.md'),'unrelated\n');f.git('add','.');f.git('commit','-qm','unrelated');const head=f.metadata('HEAD');
    const full=await listFileHistory(f.repo,head,'latest.ts',10,0);
    expect(full.commits.map(row=>[row.message,row.path])).toEqual([['second rename','latest.ts'],['edit','middle.ts'],['first rename','middle.ts'],['create','old.ts']]);
    expect(full.commits.filter(row=>row.renamedFrom).map(row=>[row.renamedFrom,row.renamedTo])).toEqual([['middle.ts','latest.ts'],['old.ts','middle.ts']]);
    expect(full.complete).toBe(true);expect(full.reason).toBeNull();
    const first=await listFileHistory(f.repo,head,'latest.ts',2,0),next=await listFileHistory(f.repo,head,'latest.ts',2,first.nextOffset!);
    expect(first.commits.map(row=>row.message)).toEqual(['second rename']);expect(first.nextOffset).toBe(2);
    expect(next.commits.map(row=>row.path)).toEqual(['middle.ts','middle.ts']);expect(next.nextOffset).toBe(4);
    const last=await listFileHistory(f.repo,head,'latest.ts',2,next.nextOffset!);expect(last.commits[0]?.path).toBe('old.ts');expect(last.complete).toBe(true);
    const oldIssue=await listFileHistory(f.repo,head,'old.ts',10,0);expect(oldIssue.path).toBe('old.ts');expect(oldIssue.headPath).toBe('latest.ts');expect(oldIssue.commits).toEqual(full.commits);
    const pinnedOld=await listFileHistory(f.repo,f.metadata(root),'old.ts',10,0);expect(pinnedOld.headPath).toBe('old.ts');expect(pinnedOld.commits).toHaveLength(1);
    const oldBlob=await f.repo.readBlob(f.git('rev-parse',`${root}:old.ts`));expect(await oldBlob?.text()).toBe('original\n');
    const firstMove=await listFileHistory(f.repo,f.metadata(firstRename),'middle.ts',10,0);expect(firstMove.commits[1]?.path).toBe('old.ts');
  }finally{await f.close();}
},30000);
test('duplicate identical parent files disclose ambiguous lineage and the shared blame resolver refuses attribution',async()=>{
  const f=await fixture();
  try{
    await Bun.write(join(f.directory,'old.ts'),'same\n');await Bun.write(join(f.directory,'duplicate.ts'),'same\n');f.git('add','.');f.git('commit','-qm','two identical files');
    f.git('mv','old.ts','moved.ts');f.git('commit','-qm','ambiguous move');const head=f.metadata('HEAD');
    const page=await listFileHistory(f.repo,head,'moved.ts',10,0);
    expect(page.complete).toBe(false);expect(page.nextOffset).toBeNull();expect(page.reason).toContain('ambiguous');expect(page.commits).toHaveLength(1);expect(page.commits[0]?.renamedFrom).toBeUndefined();
    await expect(blamePinnedFile(f.repo,head,'moved.ts')).rejects.toThrow('ambiguous');
  }finally{await f.close();}
},30000);
test('content-changing moves are not invented as exact renames',async()=>{
  const f=await fixture();
  try{
    await Bun.write(join(f.directory,'old.ts'),'before\n');f.git('add','.');f.git('commit','-qm','create');f.git('mv','old.ts','modified.ts');await Bun.write(join(f.directory,'modified.ts'),'after\n');f.git('add','.');f.git('commit','-qm','modified move');
    const page=await listFileHistory(f.repo,f.metadata('HEAD'),'modified.ts',10,0);
    expect(page.renameTracking).toBe('unique-exact-content');expect(page.commits.map(row=>row.message)).toEqual(['modified move']);expect(page.commits[0]?.renamedFrom).toBeUndefined();
    const old=await listFileHistory(f.repo,f.metadata('HEAD'),'old.ts',10,0);expect(old.headPath).toBeNull();
  }finally{await f.close();}
},30000);
