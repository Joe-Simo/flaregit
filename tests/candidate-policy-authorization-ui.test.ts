import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidateReview } from "../src/web/components/CandidateReview";
import type { CandidateGeneration, VerificationEvidence } from "../src/core/types";
const projectId="p123456789abc",commit="a".repeat(40),tree="b".repeat(40),base="c".repeat(40);
const candidate:CandidateGeneration={id:"policy-candidate",attemptNumber:1,participatingTaskIds:[],participatingCommits:{},expectedAcceptedBase:base,frozenPolicyVersion:1,frozenVerificationPolicy:{},frozenRequirements:[],candidateCommit:commit,repairAttempts:[],status:"verified",preservationProtocolVersion:1,createdAt:"2026-10-04",updatedAt:"2026-10-04",policyAuthorization:{id:"11111111-1111-4111-8111-111111111111",kind:"verified-auto-accept",identity:{projectId,incarnation:"22222222-2222-4222-8222-222222222222",canonicalRepoName:"canonical",candidateId:"policy-candidate",commit,tree,targetRef:"refs/heads/main",expectedBase:base,acceptedTargetVersion:1,verificationPolicyVersion:1,verificationPolicyDigest:"d".repeat(64),requirementsDigest:"e".repeat(64),acceptancePolicyVersion:1},policyVersion:1,serviceWorkflowId:"protected-fixture",authorizedAt:1,approvedRequirementIds:["approved-requirement"],coveredRequirementIds:["approved-requirement"],proofReceipts:{native:"native",source:"source",build:"build",browser:"browser"},proofDigests:{native:"f".repeat(64),source:"f".repeat(64),build:"f".repeat(64),browser:"f".repeat(64)}}};
const evidence:VerificationEvidence={id:"evidence",candidateCommit:commit,candidateTree:tree,expectedAcceptedBase:base,requirementsVersion:1,policy:{},testBundleDigest:"d".repeat(64),toolchainDigest:"d".repeat(64),builtOutputDigest:"d".repeat(64),verifierIdentity:"protected-fixture",testResults:[],timestamp:"2026-10-04",status:"passed"};
const render=(value=candidate,proof:VerificationEvidence|null=evidence)=>renderToStaticMarkup(createElement(CandidateReview,{projectId,candidate:value,evidence:proof??undefined,isOwner:true,onDone:()=>{}}));
test("verified policy authorization never fabricates a human approval or confirmed publication",()=>{
 const html=render();expect(html).toContain("Maintainer policy authorization recorded");expect(html).toContain("publication and readback are confirmed");expect(html).not.toContain("Waiting for your review");expect(html).not.toContain("Approved by");expect(html).not.toContain("Accepted under maintainer policy");
});
test("accepted policy history is distinct from manual review",()=>{
 const html=render({...candidate,status:"accepted"});expect(html).toContain("Accepted under maintainer policy");expect(html).not.toContain("Waiting for your review");expect(html).not.toContain("Approved by");
});
test("stale or mismatched policy receipts never display policy success",()=>{
 const authority=candidate.policyAuthorization;if(!authority)throw Error("Fixture policy authority required");
 for(const changed of [{projectId:"pabcdef123456"},{candidateId:"other-candidate"},{commit:"d".repeat(40)},{tree:"e".repeat(40)}])expect(render({...candidate,policyAuthorization:{...authority,identity:{...authority.identity,...changed}}})).not.toContain('aria-label="Maintainer policy authorization"');
 expect(render({...candidate,status:"stale"})).not.toContain('aria-label="Maintainer policy authorization"');
 expect(render(candidate,null)).not.toContain('aria-label="Maintainer policy authorization"');
});
test("real saved human approval retains its author and exact-commit recovery",()=>{
 const html=render({...candidate,review:{approved:true,by:"Real fixture reviewer",at:"2026-10-04",commit,note:"Reviewed exact diff"}});
 expect(html).toContain("Approved by Real fixture reviewer");expect(html).toContain("approval saved");expect(html).not.toContain('aria-label="Maintainer policy authorization"');
});
