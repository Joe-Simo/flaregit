import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitOrThrow } from "../src/core/pipeline/git";
import { createUnbornWorkspace, type UnbornRepositoryBaseline } from "../src/core/pipeline/unborn";
import { publishUnbornRepository, type UnbornPublicationJournal } from "../src/server/unborn-publication";

test("native first-root write loses acknowledgment then recovers exact history through read-only replay", async()=>{
  const work=fs.mkdtempSync(path.join(os.tmpdir(),"flaregit-unborn-publish-"));
  try{
    const canonical=path.join(work,"canonical.git"),workspace=path.join(work,"workspace");
    gitOrThrow(work,["init","--bare","--quiet","-b","main",canonical]);
    const baseline:UnbornRepositoryBaseline={kind:"unborn",canonicalRepoName:"synthetic",providerRepoId:"synthetic-provider",repositoryIncarnation:crypto.randomUUID(),defaultRef:"refs/heads/main",expectedHead:null};
    createUnbornWorkspace(canonical,workspace,baseline,"task/first");fs.writeFileSync(path.join(workspace,"README.md"),"Actual root contribution\n");
    gitOrThrow(workspace,["add","README.md"]);gitOrThrow(workspace,["-c","user.name=Contributor","-c","user.email=contributor@example.test","commit","--quiet","-m","First root"]);
    const commit=gitOrThrow(workspace,["rev-parse","HEAD"]).trim(),tree=gitOrThrow(workspace,["rev-parse","HEAD^{tree}"]).trim();
    const intent={baseline,candidateId:"first-candidate",operationId:crypto.randomUUID(),commit,tree};
    const decision={candidateId:intent.candidateId,commit,tree,actorId:"human-owner",decision:"approved" as const},verification={candidateId:intent.candidateId,commit,tree,passed:true};
    let dispatchPossible=false,pushes=0,confirmed=false;
    const journal:UnbornPublicationJournal={authorize:async()=>{},prepare:async()=>{},beforePush:async()=>{if(dispatchPossible)return false;dispatchPossible=true;return true;},confirm:async()=>{confirmed=true;}};
    const executor={async exec(argv:string[]){const result=spawnSync(argv[0]!,argv.slice(1),{encoding:"utf8"});if(argv.includes("push")){pushes++;expect(dispatchPossible).toBe(true);expect(result.status).toBe(0);throw new Error("Synthetic lost acknowledgment");}return{success:result.status===0,stdout:result.stdout};}};
    expect(await publishUnbornRepository(executor,workspace,canonical,"synthetic-local-token",intent,decision,verification,journal)).toEqual({status:"published",commit});
    expect(await publishUnbornRepository(executor,workspace,canonical,"synthetic-local-token",intent,decision,verification,journal)).toEqual({status:"published",commit});
    expect(pushes).toBe(1);expect(confirmed).toBe(true);
    expect(gitOrThrow(canonical,["rev-parse","refs/heads/main"],{gitDir:true}).trim()).toBe(commit);
    expect(gitOrThrow(canonical,["show","-s","--format=%an|%P",commit],{gitDir:true}).trim()).toBe("Contributor|");
    await expect(publishUnbornRepository(executor,workspace,canonical,"synthetic-local-token",intent,{...decision,decision:"rejected"},verification,journal)).rejects.toThrow("human");
    expect(pushes).toBe(1);
  }finally{fs.rmSync(work,{recursive:true,force:true});}
});
