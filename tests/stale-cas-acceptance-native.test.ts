import {test,expect} from "bun:test";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gitOrThrow,PLATFORM_IDENTITY} from "../src/core/pipeline/git";
import {publishAcceptedCandidate} from "../src/core/pipeline/accept";
import type {CandidateGeneration,VerificationEvidence,PublicationJournalEntry} from "../src/core/types";

// Real local Git object/ref/CAS evidence; not a hosted Artifacts acceptance claim.
for(const timing of ["before-review-publication","after-prepared-journal"] as const)test(`native acceptance refuses stale base ${timing} while preserving both histories`,async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-stale-cas-")),work=join(root,"work"),canonical=join(root,"canonical.git");
 try{await mkdir(work);gitOrThrow(work,["init","-b","main"]);await Bun.write(join(work,"base.txt"),"accepted base\n");gitOrThrow(work,["add","."]);gitOrThrow(work,[...PLATFORM_IDENTITY,"commit","-m","Accepted base"]);const base=gitOrThrow(work,["rev-parse","HEAD"]);
 gitOrThrow(root,["init","--bare",canonical]);gitOrThrow(work,["push",canonical,`${base}:refs/heads/main`]);
 await Bun.write(join(work,"feature.txt"),"reviewed contribution\n");gitOrThrow(work,["add","."]);gitOrThrow(work,[...PLATFORM_IDENTITY,"commit","-m","Frozen reviewed contribution"]);const commit=gitOrThrow(work,["rev-parse","HEAD"]),tree=gitOrThrow(work,["rev-parse","HEAD^{tree}"]);gitOrThrow(work,["update-ref","refs/flaregit/candidates/frozen",commit]);
 gitOrThrow(work,["checkout","--detach",base]);await Bun.write(join(work,"advance.txt"),"other accepted contribution\n");gitOrThrow(work,["add","."]);gitOrThrow(work,[...PLATFORM_IDENTITY,"commit","-m","Another accepted contribution"]);const advanced=gitOrThrow(work,["rev-parse","HEAD"]);
 const candidate:CandidateGeneration={id:"frozen",attemptNumber:1,participatingTaskIds:["task"],participatingCommits:{task:commit},expectedAcceptedBase:base,frozenPolicyVersion:1,frozenVerificationPolicy:{},frozenRequirements:[],candidateCommit:commit,repairAttempts:[],status:"verified",createdAt:"now",updatedAt:"now"};
 const evidence:VerificationEvidence={id:"proof",candidateCommit:commit,candidateTree:tree,expectedAcceptedBase:base,requirementsVersion:1,policy:{},testBundleDigest:"fixture",toolchainDigest:"fixture",builtOutputDigest:"fixture",verifierIdentity:"synthetic-native",testResults:[],timestamp:"now",status:"passed"};
 const advance=()=>gitOrThrow(work,["push",canonical,`${advanced}:refs/heads/main`]);if(timing==="before-review-publication")advance();
 const journal:PublicationJournalEntry[]=[];const result=publishAcceptedCandidate({canonicalRepoDir:canonical,defaultBranch:"main",candidate,evidence,candidateRepoDir:work,candidateRef:"refs/flaregit/candidates/frozen",onJournal:entry=>{journal.push(entry);if(entry.state==="PREPARED")advance();}});
 expect(result.success).toBe(false);expect(result.staleBase).toBe(true);expect(result.acceptanceRecord).toBeUndefined();expect(journal.map(row=>row.state)).toEqual(timing==="after-prepared-journal"?["PREPARED","ABORTED"]:["ABORTED"]);
 expect(gitOrThrow(canonical,["rev-parse","refs/heads/main"],{gitDir:true})).toBe(advanced);expect(gitOrThrow(canonical,["rev-parse","refs/flaregit/candidates/frozen"],{gitDir:true})).toBe(commit);expect(gitOrThrow(canonical,["show",`${advanced}:advance.txt`],{gitDir:true})).toBe("other accepted contribution");expect(gitOrThrow(canonical,["show",`${commit}:feature.txt`],{gitDir:true})).toBe("reviewed contribution");expect(gitOrThrow(work,["rev-parse","refs/flaregit/candidates/frozen"])).toBe(commit);expect(candidate.expectedAcceptedBase).toBe(base);expect(candidate.status).toBe("verified");
 }finally{await rm(root,{recursive:true,force:true});}
});
