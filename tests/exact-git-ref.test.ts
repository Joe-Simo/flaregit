import {expect,test} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {advertisedGitHead,observeExactGitHead} from "../src/server/exact-git-ref";
const ref="refs/heads/task/agent-a-discount-197cc1b2-588c-4a7c-bd8a-731e21894ec1",hash="a".repeat(40);
const pkt=(text:string)=>(new TextEncoder().encode(text).length+4).toString(16).padStart(4,"0")+text;
const ad=(body:string)=>new TextEncoder().encode(pkt("# service=git-upload-pack\n")+"0000"+body+"0000");
const remote="https://9888fed381861dcc35a37b026ff176e9.artifacts.cloudflare.net/git/flaregit-default/fixture.git";
test("exact refs never substitute short tags, malformed packets or duplicated target identities",()=>{
 expect(advertisedGitHead(ad(pkt(`${hash} ${ref}\0multi_ack\n`)),ref)).toBe(hash);
 expect(advertisedGitHead(ad(pkt(`${hash} refs/tags/${ref.slice(11)}\n`)),ref)).toBeNull();
 for(const bytes of [ad(pkt(`${hash} ${ref}\n`)+pkt(`${hash} ${ref}\n`)),new TextEncoder().encode("0001"),ad(pkt(`invalid ${ref}\n`)),ad(pkt(`${hash} ${ref}\n`)).slice(0,-1),new Uint8Array(1048577)])expect(()=>advertisedGitHead(bytes,ref)).toThrow();
});
test("read-only native Git advertisement proves an exact branch even when a same-name tag differs",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"flaregit-exact-ref-"));
 const git=async(...args:string[])=>{const child=Bun.spawn(["git",...args],{cwd:directory,env:{...process.env,GIT_PROTOCOL:"version=1"},stdout:"pipe",stderr:"pipe"});const bytes=new Uint8Array(await new Response(child.stdout).arrayBuffer());if(await child.exited!==0)throw new Error("Native fixture failed");return bytes;};
 try{await git("init","--bare","repo.git");const tree=new TextDecoder().decode(await git("--git-dir=repo.git","mktree")).trim();const child=Bun.spawn(["git","--git-dir=repo.git","-c","user.name=Fixture","-c","user.email=fixture@example.test","commit-tree",tree,"-m","Saved input"],{cwd:directory,stdout:"pipe",stderr:"pipe"});const commit=(await new Response(child.stdout).text()).trim();expect(await child.exited).toBe(0);await git("--git-dir=repo.git","update-ref",ref,commit);const other=Bun.spawn(["git","--git-dir=repo.git","-c","user.name=Fixture","-c","user.email=fixture@example.test","commit-tree",tree,"-m","Different tag"],{cwd:directory,stdout:"pipe",stderr:"pipe"});const tag=(await new Response(other.stdout).text()).trim();expect(await other.exited).toBe(0);expect(tag).not.toBe(commit);await git("--git-dir=repo.git","update-ref",ref.replace("refs/heads/","refs/tags/"),tag);
 const protectedRefs=["refs/flaregit/candidates/candidate","refs/flaregit/inputs/incarnation/task/commit","refs/flaregit/deployments/deployment"];for(const protectedRef of protectedRefs){await git("--git-dir=repo.git","update-ref",protectedRef,commit);await git("--git-dir=repo.git","update-ref",`refs/tags/${protectedRef}`,tag);}
 const native=await git("upload-pack","--stateless-rpc","--advertise-refs","repo.git");const header=new TextEncoder().encode(pkt("# service=git-upload-pack\n")+"0000"),bytes=new Uint8Array(header.length+native.length);bytes.set(header);bytes.set(native,header.length);expect(new TextDecoder().decode(native.slice(0,14))).toContain("version 1");expect(advertisedGitHead(bytes,ref)).toBe(commit);for(const protectedRef of protectedRefs)expect(advertisedGitHead(bytes,protectedRef)).toBe(commit);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test("transport suppresses redirects/errors and fences authority and funded admission",async()=>{
 let calls=0,allowed=true,funded=true;
 const options={remote,token:"fixture-secret",ref,authorize:async()=>{if(!allowed)throw Error("revoked");},fund:async()=>{if(!funded)throw Error("denied");},fetcher:async(_input:RequestInfo|URL,init?:RequestInit)=>{calls++;expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-secret");expect(init?.redirect).toBe("manual");return new Response(ad(pkt(`${hash} ${ref}\n`)),{headers:{"Content-Type":"application/x-git-upload-pack-advertisement"}});}};
 expect(await observeExactGitHead(options)).toBe(hash);funded=false;await expect(observeExactGitHead(options)).rejects.toThrow();expect(calls).toBe(1);funded=true;allowed=false;await expect(observeExactGitHead(options)).rejects.toThrow();expect(calls).toBe(1);allowed=true;
 await expect(observeExactGitHead({...options,fetcher:async()=>new Response("fixture-secret",{status:302,headers:{Location:"https://evil.test"}})})).rejects.toThrow("Git reference inspection unavailable");
 await expect(observeExactGitHead({...options,fetcher:async()=>{allowed=false;return new Response(ad(pkt(`${hash} ${ref}\n`)),{headers:{"Content-Type":"application/x-git-upload-pack-advertisement"}});}})).rejects.toThrow("Git reference inspection unavailable");
});

test("version preamble and first-ref capabilities remain strictly placed",()=>{
 expect(advertisedGitHead(ad(pkt("version 1\n")+pkt(`${hash} ${ref}\0multi_ack\n`)),ref)).toBe(hash);
 for(const body of [pkt("version 2\n"),pkt("version 1\n")+pkt("version 1\n"),pkt(`${hash} HEAD\n`)+pkt("version 1\n"),pkt("version 1\n")+pkt(`${hash} HEAD\n`)+pkt(`${hash} ${ref}\0caps\n`)])expect(()=>advertisedGitHead(ad(body),ref)).toThrow();
 for(const target of ["main","refs/tags/main","refs/remotes/origin/main","refs/flaregit/../bad"])expect(()=>advertisedGitHead(ad(pkt(`${hash} ${ref}\n`)),target)).toThrow();
});
test("expired authorization wait cannot subsequently fund or dispatch",async()=>{
 let release:()=>void=()=>{},funded=0,fetched=0;const pending=new Promise<void>(resolve=>{release=resolve;});
 await expect(observeExactGitHead({remote,token:"fixture-secret",ref,authorize:()=>pending,fund:async()=>{funded++;},fetcher:async()=>{fetched++;return new Response();}})).rejects.toThrow("Git reference inspection unavailable");
 release();await new Promise(resolve=>setTimeout(resolve,5));expect(funded).toBe(0);expect(fetched).toBe(0);
},15000);
