import {test,expect} from "bun:test";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gitOrThrow,PLATFORM_IDENTITY} from "../src/core/pipeline/git";
import {confirmCompositionBranch} from "../src/server/composition-branch";
test("composition proves saved non-main branch when remote HEAD names missing main",async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-composition-branch-")),seed=join(root,"seed"),canonical=join(root,"canonical.git"),work=join(root,"work"),branch="codex/docs-community-and-delivery";
 try{await mkdir(seed);gitOrThrow(seed,["init","-b",branch]);await Bun.write(join(seed,"README.md"),"Imported accepted history\n");gitOrThrow(seed,["add","."]);gitOrThrow(seed,[...PLATFORM_IDENTITY,"commit","-m","Imported branch"]);const commit=gitOrThrow(seed,["rev-parse","HEAD"]);gitOrThrow(root,["init","--bare",canonical]);gitOrThrow(seed,["push",canonical,`${commit}:refs/heads/${branch}`]);gitOrThrow(canonical,["symbolic-ref","HEAD","refs/heads/main"],{gitDir:true});gitOrThrow(root,["clone",canonical,work]);expect(gitOrThrow(work,["symbolic-ref","--short","HEAD"])).toBe("main");let fences=0;const options={branch,expectedBase:commit,remote:canonical,token:"synthetic",directory:work,exec:async(command:string)=>{const child=Bun.spawn(["sh","-c",command],{stdout:"pipe",stderr:"pipe"});const [stdout,code]=await Promise.all([new Response(child.stdout).text(),child.exited]);return{success:code===0,stdout};},beforeCommand:async()=>{fences++;}};expect(await confirmCompositionBranch(options)).toBe(branch);expect(fences).toBe(2);await expect(confirmCompositionBranch({...options,branch:"main"})).rejects.toThrow("frozen accepted base");await expect(confirmCompositionBranch({...options,expectedBase:"f".repeat(40)})).rejects.toThrow("frozen accepted base");await expect(confirmCompositionBranch({...options,branch:undefined})).rejects.toThrow("identity");expect(gitOrThrow(canonical,["show-ref"],{gitDir:true})).toBe(`${commit} refs/heads/${branch}`);
 }finally{await rm(root,{recursive:true,force:true});}
});
