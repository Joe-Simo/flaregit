import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitOrThrow } from "../src/core/pipeline/git";
import { createUnbornWorkspace, inspectUnbornRepository, publishUnbornRoot, type UnbornRepositoryBaseline } from "../src/core/pipeline/unborn";

test("unborn workspaces preserve absent history; reviewed first root lands and parallel first root is stale",()=>{
  const work=fs.mkdtempSync(path.join(os.tmpdir(),"flaregit-unborn-")),canonical=path.join(work,"canonical.git");
  try{
    gitOrThrow(work,["init","--bare","--quiet","-b","trunk",canonical]);
    const baseline:UnbornRepositoryBaseline={kind:"unborn",canonicalRepoName:"synthetic-test",providerRepoId:"synthetic-provider",repositoryIncarnation:crypto.randomUUID(),defaultRef:"refs/heads/trunk",expectedHead:null};
    expect(inspectUnbornRepository(canonical,baseline)).toMatchObject({headMissing:true,refs:[],baseline:{expectedHead:null}});
    expect(()=>inspectUnbornRepository(canonical,{...baseline,defaultRef:"refs/heads/main"})).toThrow("recorded default ref");
    const roots=["alice","bob"].map(author=>{
      const workspace=path.join(work,author);createUnbornWorkspace(canonical,workspace,baseline,`task/${author}`);
      expect(gitOrThrow(workspace,["for-each-ref","--format=%(refname)"]).trim()).toBe("");
      fs.writeFileSync(path.join(workspace,"README.md"),`${author}'s actual first contribution\n`);
      gitOrThrow(workspace,["add","README.md"]);gitOrThrow(workspace,["-c",`user.name=${author}`,"-c",`user.email=${author}@example.test`,"commit","--quiet","-m",`First contribution by ${author}`]);
      const commit=gitOrThrow(workspace,["rev-parse","HEAD"]).trim(),tree=gitOrThrow(workspace,["rev-parse","HEAD^{tree}"]).trim();
      expect(gitOrThrow(workspace,["rev-list","--parents","-n","1",commit]).trim()).toBe(commit);
      const candidate={candidateId:`candidate-${author}`,baseline,commit,tree};
      return{workspace,candidate,decision:{candidateId:candidate.candidateId,commit,tree,actorId:"human-maintainer",decision:"approved" as const},verification:{candidateId:candidate.candidateId,commit,tree,passed:true}};
    });
    const first=roots[0]!,second=roots[1]!;
    expect(()=>publishUnbornRoot(canonical,first.workspace,first.candidate,{...first.decision,decision:"rejected"},first.verification)).toThrow("human approval");
    expect(()=>publishUnbornRoot(canonical,first.workspace,first.candidate,first.decision,{...first.verification,passed:false})).toThrow("human approval");
    expect(publishUnbornRoot(canonical,first.workspace,first.candidate,first.decision,first.verification)).toEqual({accepted:true,stale:false});
    expect(publishUnbornRoot(canonical,second.workspace,second.candidate,second.decision,second.verification)).toEqual({accepted:false,stale:true});
    expect(gitOrThrow(canonical,["rev-parse","refs/heads/trunk"],{gitDir:true}).trim()).toBe(first.candidate.commit);
    expect(gitOrThrow(canonical,["show","-s","--format=%an|%P",first.candidate.commit],{gitDir:true}).trim()).toBe("alice|");
    expect(()=>inspectUnbornRepository(canonical,baseline)).toThrow("not empty");
  }finally{fs.rmSync(work,{recursive:true,force:true});}
});
