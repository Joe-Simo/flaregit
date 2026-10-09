import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gitOrThrow,PLATFORM_IDENTITY} from '../src/core/pipeline/git';
import {BrowserEdits,browserEditBytes,publishBrowserEdit,type BrowserEditIdentity} from '../src/server/browser-edit';
import type {BranchGitExecutor} from '../src/server/branch-git';
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
test('real bare Git browser upload transports 256 KiB in bounded chunks and recovers an uncertain leased push',async()=>{
  const root=await mkdtemp(join(tmpdir(),'flaregit-browser-native-')),seed=join(root,'seed'),fork=join(root,'fork.git'),db=new Database(':memory:');
  const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
  try{
    await mkdir(seed);gitOrThrow(seed,['init','-b','main']);await Bun.write(join(seed,'README.md'),'Accepted source\n');gitOrThrow(seed,['add','.']);gitOrThrow(seed,[...PLATFORM_IDENTITY,'commit','-m','Accepted base']);
    const head=gitOrThrow(seed,['rev-parse','HEAD']),baseTree=gitOrThrow(seed,['rev-parse','HEAD^{tree}']);gitOrThrow(root,['init','--bare',fork]);gitOrThrow(seed,['push',fork,`${head}:refs/heads/main`]);
    const bytes=Uint8Array.from({length:256*1024},(_,index)=>index%251),payloadFile=join(root,'payload.bin');await Bun.write(payloadFile,bytes);
    const remote=`https://${'a'.repeat(32)}.artifacts.cloudflare.net/fork.git`,requestId=crypto.randomUUID(),nativeDirectory=`/workspace/browser-edit-${requestId}`,localDirectory=join(root,`browser-edit-${requestId}`);
    const identity:BrowserEditIdentity={projectId:'project',incarnation:crypto.randomUUID(),canonicalRepoName:'canonical',taskId:'browser-native-upload',workspaceRepoName:'fork',providerRepoId:'recorded-fork-provider',remote,branch:'task/browser-native-upload',actorId:'human',authorName:'Browser author',authorEmail:'human@users.flaregit.invalid',createdAt:'2026-10-08T12:00:00.000Z',input:{requestId,expectedHead:head,expectedTree:baseTree,path:'src/upload.bin',expectedBlob:null,contentBase64:btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join('')),contentSha256:hex(await crypto.subtle.digest('SHA-256',bytes)),message:'Upload reviewed binary'}};
    const ledger=new BrowserEdits(storage),record=ledger.prepare(identity,(await browserEditBytes(identity.input)).blob,()=>{}),commands:string[]=[];let pushed=false,hideReadback=true;
    const executor:BranchGitExecutor={async beforeCommand(){},async exec(command,env){
      commands.push(command);
      if(pushed&&hideReadback&&command.includes('ls-remote')){hideReadback=false;return {success:false,stdout:''};}
      const mapped=command.replaceAll(remote,fork).replaceAll(nativeDirectory,localDirectory);
      const child=Bun.spawn(['sh','-c',mapped],{env:{...process.env,...env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_1:'core.hooksPath',GIT_CONFIG_VALUE_1:'/dev/null',GIT_CONFIG_KEY_2:'http.followRedirects',GIT_CONFIG_VALUE_2:'false'},stdout:'pipe',stderr:'pipe'});
      const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      if(command.includes(' push ')){expect(code).toBe(0);pushed=true;return {success:false,stdout:''};}
      if(code!==0)throw Error(`Fixture Git command failed: ${stderr}`);
      return {success:true,stdout};
    }};
    const save=async(commit:string,tree:string)=>{ledger.update(identity,value=>{value.commit=commit;value.tree=tree;},()=>{});},dispatch=async()=>{ledger.update(identity,value=>{value.phase='push_unknown';},()=>{});};
    await expect(publishBrowserEdit(executor,record,'credential-never-in-argv',save,dispatch)).rejects.toThrow('unconfirmed');
    const pending=ledger.get(requestId)!;expect(pending.phase).toBe('push_unknown');expect(pending.commit).toBeDefined();
    if(!pending.commit||!pending.tree)throw Error('Native proposal must persist its commit and tree before dispatch');
    expect(Math.max(...commands.map(command=>new TextEncoder().encode(command).length))).toBeLessThan(34*1024);
    expect(commands.filter(command=>command.includes('printf %s')).length).toBeGreaterThan(1);
    expect(commands.every(command=>!command.includes(identity.input.contentBase64)&&!command.includes('credential-never-in-argv'))).toBe(true);
    expect(gitOrThrow(fork,['rev-parse',`${pending.commit}^`],{gitDir:true})).toBe(head);
    expect(gitOrThrow(fork,['rev-parse',`${pending.commit}^{tree}`],{gitDir:true})).toBe(pending.tree);
    expect(gitOrThrow(fork,['rev-parse',`${pending.commit}:src/upload.bin`],{gitDir:true})).toBe(record.blob);
    expect(gitOrThrow(root,['hash-object',payloadFile])).toBe(record.blob);
    expect(gitOrThrow(fork,['rev-parse','refs/heads/main'],{gitDir:true})).toBe(head);
    expect(gitOrThrow(fork,['show',`${pending.commit}:README.md`],{gitDir:true})).toBe('Accepted source');
    const count=commands.length,recovered=await publishBrowserEdit(executor,pending,'credential-never-in-argv',async()=>{throw Error('Retry cannot create another proposal');},async()=>{throw Error('Retry cannot redispatch');});
    expect(recovered.confirmed).toBe(true);expect(recovered.commit).toBe(pending.commit);expect(commands.slice(count)).toHaveLength(1);expect(commands[count]).toContain('ls-remote');
    expect(gitOrThrow(fork,['rev-parse',`refs/heads/${identity.branch}`],{gitDir:true})).toBe(pending.commit);
    expect(commands.filter(command=>command.includes(' push '))).toHaveLength(1);
  }finally{db.close();await rm(root,{recursive:true,force:true});}
},30000);
