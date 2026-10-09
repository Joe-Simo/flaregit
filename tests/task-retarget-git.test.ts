import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectTaskRetarget} from '../src/server/task-retarget-git';
import {q} from '../src/server/shell';
test('native retarget inspection proves contained accepted base and leaves divergent target and fork history unchanged',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flaregit-retarget-')),work=join(root,'work'),fork=join(root,'fork.git'),remote=`https://${'a'.repeat(32)}.artifacts.cloudflare.net/repository.git`,commands:string[]=[];
 const git=async(command:string)=>{const child=Bun.spawn(['sh','-c',command],{stdout:'pipe',stderr:'pipe',env:{...process.env,GIT_AUTHOR_NAME:'Original author',GIT_AUTHOR_EMAIL:'author@example.invalid',GIT_COMMITTER_NAME:'Original author',GIT_COMMITTER_EMAIL:'author@example.invalid'}});const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code)throw Error(stderr);return stdout.trim();};
 try{
  await git(`git init -q -b main ${q(work)} && git init -q --bare ${q(fork)}`);await Bun.write(join(work,'base'),'A');await git(`git -C ${q(work)} add . && git -C ${q(work)} commit -qm Initial`);const originalBase=await git(`git -C ${q(work)} rev-parse HEAD`);
  await Bun.write(join(work,'contained'),'B');await git(`git -C ${q(work)} add . && git -C ${q(work)} commit -qm Accepted`);const target=await git(`git -C ${q(work)} rev-parse HEAD`);
  await Bun.write(join(work,'authored'),'C');await git(`git -C ${q(work)} add . && git -C ${q(work)} commit -qm Contribution && git -C ${q(work)} push -q ${q(fork)} HEAD:refs/heads/task/change`);const head=await git(`git -C ${q(work)} rev-parse HEAD`);
  await git(`git -C ${q(work)} checkout -q --detach ${originalBase}`);await Bun.write(join(work,'diverged'),'D');await git(`git -C ${q(work)} add . && git -C ${q(work)} commit -qm Diverged && git -C ${q(work)} push -q ${q(fork)} HEAD:refs/heads/diverged`);const divergent=await git(`git -C ${q(work)} rev-parse HEAD`);
  const executor={beforeCommand:async()=>{},exec:async(command:string)=>{commands.push(command);const child=Bun.spawn(['sh','-c',command.replaceAll(q(remote),q(fork))],{stdout:'pipe',stderr:'pipe'});const [stdout,code]=await Promise.all([new Response(child.stdout).text(),child.exited]);return {success:code===0,stdout};}};
  expect(await inspectTaskRetarget(executor,{remote,token:'synthetic-read-scope',branch:'task/change',head,base:target,directory:join(root,'inspection-a')})).toEqual({head,base:target,ancestryVerified:true});
  expect(await inspectTaskRetarget(executor,{remote,token:'synthetic-read-scope',branch:'task/change',head,base:divergent,directory:join(root,'inspection-b')})).toBe('target_not_ancestor');
  expect(await git(`git --git-dir ${q(fork)} rev-parse refs/heads/task/change`)).toBe(head);expect(commands.some(command=>command.includes(' push ')||command.includes(' rebase '))).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
