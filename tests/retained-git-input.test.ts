import {test,expect} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {retainGitInput,retainedGitInputRef} from "../src/server/retained-git-input";
import {q} from "../src/server/shell";
const remote="https://"+"a".repeat(32)+".artifacts.cloudflare.net/repository.git";
const incarnation="12345678-1234-1234-1234-123456789abc";
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),"flaregit-retained-input-")),work=join(dir,"work"),bare=join(dir,"canonical.git");
 const git=async(command:string)=>{const p=Bun.spawn(["sh","-c",command],{stdout:"pipe",stderr:"pipe"});const [stdout,stderr,exit]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(exit)throw new Error(stderr);return stdout.trim();};
 await git(`git init -q ${q(work)} && git init -q --bare ${q(bare)} && git -C ${q(work)} config user.name Test && git -C ${q(work)} config user.email test@example.invalid`);
 await Bun.write(join(work,"file"),"base");await git(`git -C ${q(work)} add . && git -C ${q(work)} commit -qm base`);const base=await git(`git -C ${q(work)} rev-parse HEAD`);
 await Bun.write(join(work,"file"),"input");await git(`git -C ${q(work)} commit -qam input`);const input=await git(`git -C ${q(work)} rev-parse HEAD`);
 const commands:string[]=[];
 const exec=async(command:string)=>{commands.push(command);const p=Bun.spawn(["sh","-c",command.replaceAll(q(remote),q(bare))],{stdout:"pipe",stderr:"pipe"});const [stdout,,exit]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {stdout,success:exit===0};};
 return {dir,work,bare,git,exec,commands,base,input,cleanup:()=>rm(dir,{recursive:true,force:true})};
}
test("canonical input pin survives squash, source force replacement and real GC",async()=>{
 const f=await fixture();try{
  const fork=join(f.dir,"fork.git");
  await f.git(`git init -q --bare ${q(fork)} && git -C ${q(f.work)} push -q ${q(fork)} HEAD:refs/heads/work`);
  let fences=0;const receipt=await retainGitInput({exec:f.exec,directory:f.work,remote,token:"server-only",incarnation,taskId:"task-one",commit:f.input,beforeCommand:async()=>{fences++;}});
  expect(fences).toBe(8);
  await f.git(`git -C ${q(f.work)} reset --soft ${f.base} && git -C ${q(f.work)} commit -qm squash && git -C ${q(f.work)} push -q ${q(f.bare)} HEAD:refs/heads/main && git -C ${q(f.work)} reset --hard ${f.base} && git -C ${q(f.bare)} reflog expire --expire=now --all && git -C ${q(f.bare)} gc --prune=now`);
  await f.git(`git -C ${q(f.work)} push -q --force ${q(fork)} ${f.base}:refs/heads/work && git -C ${q(fork)} reflog expire --expire=now --all && git -C ${q(fork)} gc --prune=now`);
  const missing=Bun.spawn(["git","-C",fork,"cat-file","-e",f.input],{stdout:"ignore",stderr:"ignore"});expect(await missing.exited).not.toBe(0);
  expect(await f.git(`git -C ${q(f.bare)} rev-parse ${q(receipt.ref)}`)).toBe(f.input);
  expect(await f.git(`git -C ${q(f.bare)} cat-file -t ${f.input}`)).toBe("commit");
  expect(await retainGitInput({exec:f.exec,directory:f.work,remote,token:"server-only",incarnation,taskId:"task-one",commit:f.input,beforeCommand:async()=>{}})).toEqual(receipt);
 }finally{await f.cleanup();}
});
test("lost push acknowledgement is settled by exact real remote proof",async()=>{
 const f=await fixture();try{let lost=false;const receipt=await retainGitInput({exec:async cmd=>{const result=await f.exec(cmd);if(cmd.includes(" push ")){lost=true;throw new Error("connection interrupted");}return result;},directory:f.work,remote,token:"secret",incarnation,taskId:"task-one",commit:f.input,beforeCommand:async()=>{}});expect(lost).toBe(true);expect(receipt.commit).toBe(f.input);expect(f.commands.some(c=>c.includes("secret"))).toBe(false);}finally{await f.cleanup();}
});
test("existing different object and unsafe identities are refused without overwrite",async()=>{
 const f=await fixture();try{const ref=retainedGitInputRef(incarnation,"task-one",f.input);await f.git(`git -C ${q(f.work)} push -q ${q(f.bare)} ${f.base}:${q(ref)}`);
 await expect(retainGitInput({exec:f.exec,directory:f.work,remote,token:"secret",incarnation,taskId:"task-one",commit:f.input,beforeCommand:async()=>{}})).rejects.toThrow("differs");expect(await f.git(`git -C ${q(f.bare)} rev-parse ${q(ref)}`)).toBe(f.base);expect(f.commands.some(c=>c.includes(" push "))).toBe(false);
 expect(()=>retainedGitInputRef(incarnation,"../main",f.input)).toThrow();await expect(retainGitInput({exec:f.exec,directory:f.work,remote:"http://evil.invalid/x",token:"secret",incarnation,taskId:"task-one",commit:f.input,beforeCommand:async()=>{}})).rejects.toThrow();
 }finally{await f.cleanup();}
});
test("authority revocation before pin creation prevents any push",async()=>{
 const f=await fixture();try{let before=0;await expect(retainGitInput({exec:f.exec,directory:f.work,remote,token:"secret",incarnation,taskId:"task-one",commit:f.input,beforeCommand:async phase=>{if(phase==="before" && ++before===3)throw new Error("Authority changed");}})).rejects.toThrow();expect(f.commands.some(c=>c.includes(" push "))).toBe(false);}finally{await f.cleanup();}
});
