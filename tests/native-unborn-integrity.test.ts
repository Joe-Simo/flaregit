import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitOrThrow } from "../src/core/pipeline/git";
import { verifyNativeIntegrity, type NativeIntegrityInput } from "../src/core/verification/integrity";
import { publishUnbornRoot } from "../src/core/pipeline/unborn";

test("native integrity proves actual parallel initial roots without fabricating accepted history",async()=>{
  const work=fs.mkdtempSync(path.join(os.tmpdir(),"flaregit-first-integrity-"));
  try{
    const run=(args:string[])=>gitOrThrow(work,args).trim();
    run(["init","--quiet","-b","first"]);run(["config","user.name","Contributor"]);run(["config","user.email","contributor@example.test"]);
    fs.mkdirSync(path.join(work,"src"));fs.writeFileSync(path.join(work,"src/a.ts"),"throw new Error('never execute');\n");run(["add","."]);run(["commit","--quiet","-m","First root A"]);
    const a=run(["rev-parse","HEAD"]);run(["update-ref","refs/flaregit/tasks/a",a]);
    run(["checkout","--quiet","--orphan","second"]);run(["rm","-r","--force","--quiet","."]);fs.mkdirSync(path.join(work,"src"));fs.writeFileSync(path.join(work,"src/b.ts"),"throw new Error('also never execute');\n");run(["add","."]);run(["commit","--quiet","-m","First root B"]);
    const b=run(["rev-parse","HEAD"]);run(["update-ref","refs/flaregit/tasks/b",b]);run(["checkout","--quiet","first"]);run(["merge","--quiet","--no-ff","--allow-unrelated-histories",b,"-m","Compose actual contributors"]);
    const policy={kind:"git-integrity"},target={kind:"unborn" as const,projectId:"synthetic-project",incarnation:crypto.randomUUID(),canonicalRepoName:"synthetic-canonical",ref:"refs/heads/main",branch:"main",acceptedCommit:null,acceptedVersion:0 as const,policyVersion:1,policy,requirements:[] as []};
    const input:NativeIntegrityInput={repoDir:work,candidateCommit:run(["rev-parse","HEAD"]),candidateTree:run(["rev-parse","HEAD^{tree}"]),expectedBase:null,acceptedTarget:target,requirementsVersion:1,policy,protectedPaths:["tests/"],allowedScope:["src/"],contributors:[{id:"a",commit:a,baseCommit:null,ref:"refs/flaregit/tasks/a",allowedScope:["src/"]},{id:"b",commit:b,baseCommit:null,ref:"refs/flaregit/tasks/b",allowedScope:["src/"]}],landing:"merge"};
    const evidence=await verifyNativeIntegrity(input);expect(evidence.status).toBe("passed");expect(evidence.expectedAcceptedBase).toBeNull();expect(evidence.acceptedTarget?.kind).toBe("unborn");expect(evidence.testResults[0]?.items[0]?.description).toContain("not configured");
    expect((await verifyNativeIntegrity({...input,acceptedTarget:undefined})).status).toBe("failed");
    expect((await verifyNativeIntegrity({...input,contributors:input.contributors.slice(0,1)})).status).toBe("failed");
    expect((await verifyNativeIntegrity({...input,contributors:[{...input.contributors[0]!,baseCommit:a},input.contributors[1]!]})).status).toBe("failed");
    expect((await verifyNativeIntegrity({...input,protectedPaths:["src/"]})).status).toBe("failed");
    const child=Bun.spawn([process.execPath,"src/core/verification/cli.ts","--native-integrity",JSON.stringify(input)],{stdout:"pipe",stderr:"pipe"});
    const output=await new Response(child.stdout).text();expect(await child.exited).toBe(0);expect(JSON.parse(output).expectedAcceptedBase).toBeNull();expect(JSON.parse(output).status).toBe("passed");
    const canonical=path.join(work,"canonical.git");run(["init","--bare","--quiet","-b","main",canonical]);
    const candidate={candidateId:"real-initial-batch",baseline:{kind:"unborn" as const,canonicalRepoName:target.canonicalRepoName,providerRepoId:"synthetic-provider",repositoryIncarnation:target.incarnation,defaultRef:target.ref,expectedHead:null},commit:input.candidateCommit,tree:input.candidateTree,contributorCommits:[a,b]};
    expect(publishUnbornRoot(canonical,work,candidate,{candidateId:candidate.candidateId,commit:candidate.commit,tree:candidate.tree,actorId:"human-owner",decision:"approved"},{candidateId:candidate.candidateId,commit:candidate.commit,tree:candidate.tree,passed:evidence.status==="passed"})).toEqual({accepted:true,stale:false});
    expect(gitOrThrow(canonical,["rev-list","--max-parents=0","refs/heads/main"],{gitDir:true}).trim().split("\n").sort()).toEqual([a,b].sort());
  }finally{fs.rmSync(work,{recursive:true,force:true});}
});
