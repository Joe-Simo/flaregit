import{expect,test}from'bun:test';
import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{advertisedBranches,inspectHttpBranches}from'../src/server/branch-http-inventory';
const remote='https://9888fed381861dcc35a37b026ff176e9.artifacts.cloudflare.net/git/flaregit-default/fixture.git',ref='refs/heads/main';
const packet=(text:string)=>(new TextEncoder().encode(text).length+4).toString(16).padStart(4,'0')+text;
const advertisement=(body:string)=>new TextEncoder().encode(packet('# service=git-upload-pack\n')+'0000'+body+'0000');
test('fresh native empty and populated Git advertisements cross HTTP without container execution',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'flaregit-branch-http-'));let server:ReturnType<typeof Bun.serve>|undefined;
 const git=async(...args:string[])=>{const child=Bun.spawn(['git',...args],{cwd:directory,env:{...process.env,GIT_PROTOCOL:'version=1'},stdout:'pipe',stderr:'pipe'});const bytes=new Uint8Array(await new Response(child.stdout).arrayBuffer());if(await child.exited)throw Error('Native Git fixture failed');return bytes;};
 try{await git('init','--bare','repo.git');await git('--git-dir=repo.git','symbolic-ref','HEAD',ref);server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async()=>{const native=await git('upload-pack','--stateless-rpc','--advertise-refs','repo.git'),header=new TextEncoder().encode(packet('# service=git-upload-pack\n')+'0000'),bytes=new Uint8Array(header.length+native.length);bytes.set(header);bytes.set(native,header.length);return new Response(bytes,{headers:{'Content-Type':'application/x-git-upload-pack-advertisement'}});}});
 let calls=0;const options={remote,token:'synthetic-private-read-token',defaultRef:ref,authorize:async()=>{},fund:async()=>{},fetcher:async(_input:RequestInfo|URL,init?:RequestInit)=>{calls++;expect(init?.redirect).toBe('manual');return fetch(server!.url,{...init,headers:{'Git-Protocol':'version=1'}});}};
 expect(await inspectHttpBranches(options)).toEqual({branches:[],truncated:false});
 const tree=new TextDecoder().decode(await git('--git-dir=repo.git','mktree')).trim(),commit=new TextDecoder().decode(await git('--git-dir=repo.git','-c','user.name=Fixture','-c','user.email=fixture@example.test','commit-tree',tree,'-m','First')).trim();await git('--git-dir=repo.git','update-ref',ref,commit);await git('--git-dir=repo.git','update-ref','refs/tags/other',commit);
 expect(await inspectHttpBranches(options)).toEqual({branches:[{name:'main',ref,commit}],truncated:false});expect(calls).toBe(2);
 }finally{server?.stop(true);await rm(directory,{recursive:true,force:true});}
});
test('malformed duplicate zero and incomplete branch advertisements fail closed',()=>{
 const row=packet(`${'a'.repeat(40)} ${ref}\n`);for(const bytes of [advertisement(row+row),advertisement(packet(`${'0'.repeat(40)} ${ref}\n`)),advertisement(row).slice(0,-1),new Uint8Array(1048577)])expect(()=>advertisedBranches(bytes,ref)).toThrow();
});
test('HTTP error redirect wrong MIME oversize and withdrawn authority never claim verified refs',async()=>{
 const body=advertisement(packet(`${'a'.repeat(40)} ${ref}\n`)),options={remote,token:'synthetic-private-read-token',defaultRef:ref,authorize:async()=>{},fund:async()=>{}};
 for(const response of [new Response(null,{status:302,headers:{Location:'https://other.example'}}),new Response(body,{status:403}),new Response(body,{headers:{'Content-Type':'text/plain'}}),new Response(new Uint8Array(1048577),{headers:{'Content-Type':'application/x-git-upload-pack-advertisement'}})])await expect(inspectHttpBranches({...options,fetcher:async()=>response})).rejects.toThrow();
 let calls=0;await expect(inspectHttpBranches({...options,authorize:async()=>{throw Error('Withdrawn');},fetcher:async()=>{calls++;return new Response(body);}})).rejects.toThrow();expect(calls).toBe(0);
});
