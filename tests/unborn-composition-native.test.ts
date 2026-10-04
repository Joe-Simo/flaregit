import {test,expect} from "bun:test";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gitOrThrow,PLATFORM_IDENTITY} from "../src/core/pipeline/git";
import {confirmCompositionBranch} from "../src/server/composition-branch";
import {publicationInHistory} from "../src/server/publication";
import type {UnbornAcceptedTarget} from "../src/core/accepted-target";
test("native unborn composition preserves independent roots and create-only stale loser",async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-unborn-compose-"));
 const exec=async(command:string)=>{const child=Bun.spawn(["sh","-c",command],{stdout:"pipe",stderr:"pipe"});const [stdout,exitCode]=await Promise.all([new Response(child.stdout).text(),child.exited]);return{stdout,exitCode,success:exitCode===0};};
 try{const canonical=join(root,"canonical.git"),a=join(root,"a"),b=join(root,"b");gitOrThrow(root,["init","--bare",canonical]);
 for(const [directory,file] of [[a,"a.txt"],[b,"b.txt"]]){await mkdir(directory!);gitOrThrow(directory!,["init","-b","contribution"]);await Bun.write(join(directory!,file!),file!);gitOrThrow(directory!,["add","."]);gitOrThrow(directory!,[...PLATFORM_IDENTITY,"commit","-m","Actual contributor root"]);}
 const first=gitOrThrow(a,["rev-parse","HEAD"]),second=gitOrThrow(b,["rev-parse","HEAD"]);
 const target:UnbornAcceptedTarget={kind:"unborn",projectId:"p-test",incarnation:crypto.randomUUID(),canonicalRepoName:"canonical",ref:"refs/heads/trunk",branch:"trunk",acceptedCommit:null,acceptedVersion:0,requirements:[],policyVersion:0,policy:{}};
 expect(await confirmCompositionBranch({branch:"trunk",expectedBase:null,acceptedTarget:target,remote:canonical,token:"fixture",directory:a,exec,beforeCommand:async()=>{}})).toBe("trunk");
 gitOrThrow(a,["fetch",b,`${second}:refs/flaregit/tasks/second`]);gitOrThrow(a,[...PLATFORM_IDENTITY,"merge","--allow-unrelated-histories","--no-ff","-m","Compose independent contributors","refs/flaregit/tasks/second"]);const candidate=gitOrThrow(a,["rev-parse","HEAD"]);
 expect(gitOrThrow(a,["rev-list","--max-parents=0",candidate]).split("\n").sort()).toEqual([first,second].sort());expect(await publicationInHistory(exec,a,canonical,"fixture","trunk",candidate,true)).toBe(false);
 gitOrThrow(a,["push","--force-with-lease=refs/heads/trunk:",canonical,`${candidate}:refs/heads/trunk`]);expect(await publicationInHistory(exec,a,canonical,"fixture","trunk",candidate,true)).toBe(true);
 const loser=await exec(`git -C '${b}' push --force-with-lease=refs/heads/trunk: '${canonical}' '${second}:refs/heads/trunk'`);expect(loser.success).toBe(false);expect(gitOrThrow(canonical,["rev-parse","refs/heads/trunk"],{gitDir:true})).toBe(candidate);expect(gitOrThrow(b,["rev-parse","HEAD"])).toBe(second);
 await expect(confirmCompositionBranch({branch:"trunk",expectedBase:null,acceptedTarget:target,remote:canonical,token:"fixture",directory:a,exec,beforeCommand:async()=>{}})).rejects.toThrow("frozen accepted base");
 }finally{await rm(root,{recursive:true,force:true});}
});
test("a multi-commit orphan contribution includes root files in its null-base diff",async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-unborn-diff-"));
 try{gitOrThrow(root,["init","-b","contribution"]);await Bun.write(join(root,"first-root-file.txt"),"root\n");gitOrThrow(root,["add","."]);gitOrThrow(root,[...PLATFORM_IDENTITY,"commit","-m","Human root"]);await Bun.write(join(root,"second-commit-file.txt"),"next\n");gitOrThrow(root,["add","."]);gitOrThrow(root,[...PLATFORM_IDENTITY,"commit","-m","Human next checkpoint"]);const head=gitOrThrow(root,["rev-parse","HEAD"]);expect(gitOrThrow(root,["ls-tree","-r","--name-only",head]).split("\n")).toEqual(["first-root-file.txt","second-commit-file.txt"]);expect(gitOrThrow(root,["diff","--name-only","HEAD^",head])).toBe("second-commit-file.txt");expect(gitOrThrow(root,["rev-list","--max-parents=0",head]).split("\n")).toHaveLength(1);}finally{await rm(root,{recursive:true,force:true});}
});
test("overlapping independent first contributors retain both heads after a visible Git conflict",async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-unborn-conflict-"));
 try{const heads:string[]=[];for(const [name,text] of [["a","Human decision A\n"],["b","Human decision B\n"]]){const dir=join(root,name!);await mkdir(dir);gitOrThrow(dir,["init","-b","contribution"]);await Bun.write(join(dir,"shared.txt"),text!);gitOrThrow(dir,["add","."]);gitOrThrow(dir,[...PLATFORM_IDENTITY,"commit","-m",name!]);heads.push(gitOrThrow(dir,["rev-parse","HEAD"]));}gitOrThrow(join(root,"a"),["fetch",join(root,"b"),`${heads[1]}:refs/flaregit/tasks/b`]);const process=Bun.spawn(["git","-C",join(root,"a"),...PLATFORM_IDENTITY,"merge","--allow-unrelated-histories","--no-ff","-m","Review both decisions","refs/flaregit/tasks/b"],{stdout:"pipe",stderr:"pipe"});expect(await process.exited).not.toBe(0);expect(gitOrThrow(join(root,"a"),["diff","--name-only","--diff-filter=U"])).toBe("shared.txt");expect(gitOrThrow(join(root,"a"),["rev-parse","HEAD"])).toBe(heads[0]!);expect(gitOrThrow(join(root,"b"),["rev-parse","HEAD"])).toBe(heads[1]!);gitOrThrow(join(root,"a"),["merge","--abort"]);expect(await Bun.file(join(root,"a","shared.txt")).text()).toBe("Human decision A\n");}finally{await rm(root,{recursive:true,force:true});}
});
