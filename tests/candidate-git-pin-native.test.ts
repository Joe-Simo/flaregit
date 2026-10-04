import {test,expect} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gitOrThrow,PLATFORM_IDENTITY} from "../src/core/pipeline/git";
import {retainCandidateGitPin} from "../src/server/candidate-git-pin";
test("candidate preservation uses create-only Git plus exact readback after a lost push acknowledgement",async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-candidate-pin-")),remote=join(root,"canonical.git"),url=`https://${"a".repeat(32)}.artifacts.cloudflare.net/canonical.git`;
 try{gitOrThrow(root,["init","-b","contribution"]);gitOrThrow(root,["init","--bare",remote]);await Bun.write(join(root,"file.txt"),"Reviewed actual contribution\n");gitOrThrow(root,["add","file.txt"]);gitOrThrow(root,[...PLATFORM_IDENTITY,"commit","-m","Actual candidate"]);const commit=gitOrThrow(root,["rev-parse","HEAD"]);let pushes=0;const exec=async(command:string,env?:Record<string,string>)=>{const child=Bun.spawn(["sh","-c",command.replaceAll(url,remote)],{stdout:"pipe",stderr:"pipe",env:{...process.env,...env}});const[stdout,exitCode]=await Promise.all([new Response(child.stdout).text(),child.exited]);if(command.includes(" push ")){pushes++;return{stdout,success:false};}return{stdout,success:exitCode===0};};const input={candidateId:"candidate-one",commit,directory:root,remote:url,token:"fixture-only",exec,beforeCommand:async()=>{}};
 expect(await retainCandidateGitPin(input)).toEqual({ref:"refs/flaregit/candidates/candidate-one",observedCommit:commit});expect(pushes).toBe(1);expect(await retainCandidateGitPin(input)).toEqual({ref:"refs/flaregit/candidates/candidate-one",observedCommit:commit});expect(pushes).toBe(1);
 await Bun.write(join(root,"file.txt"),"Another actual object\n");gitOrThrow(root,["add","file.txt"]);gitOrThrow(root,[...PLATFORM_IDENTITY,"commit","-m","Different contribution"]);const other=gitOrThrow(root,["rev-parse","HEAD"]);await expect(retainCandidateGitPin({...input,commit:other})).rejects.toThrow("differs");expect(pushes).toBe(1);expect(gitOrThrow(remote,["rev-parse","refs/flaregit/candidates/candidate-one"],{gitDir:true})).toBe(commit);
 await expect(retainCandidateGitPin({...input,exec:async()=>({success:true,stdout:`${commit}\trefs/flaregit/candidates/candidate-one\n${commit}\trefs/flaregit/candidates/candidate-one\n`})})).rejects.toThrow("differs");
 let reads=0;await expect(retainCandidateGitPin({...input,candidateId:"missing",exec:async()=>{reads++;return{success:reads!==2,stdout:""};}})).rejects.toThrow("review remains pending");expect(reads).toBe(3);
 }finally{await rm(root,{recursive:true,force:true});}
});
