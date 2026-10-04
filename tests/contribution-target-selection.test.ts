import {expect,test} from "bun:test";
import {contributionCreationIntent,contributionExpectation,parseContributionTargets,type ContributionTarget} from "../src/web/contribution-target-selection";
const target:ContributionTarget={ref:"refs/heads/release",branch:"release",acceptedCommit:"a".repeat(40),acceptedVersion:3,policyVersion:2};
test("explicit contribution target echoes only exact ready-root assertions, never caller policy or requirements",()=>{
 expect(parseContributionTargets({targets:[target],truncated:false}).targets).toEqual([target]);expect(contributionExpectation(target)).toEqual({ref:target.ref,acceptedCommit:target.acceptedCommit,acceptedVersion:3,policyVersion:2});expect(()=>parseContributionTargets({targets:[{...target,branch:"main"}],truncated:false})).toThrow();expect(()=>parseContributionTargets({targets:[{...target,status:"pending_unverified"}],truncated:false})).toThrow();
});
test("unknown creation ACK reuses exact request UUID and frozen target even after current root advances",()=>{
 const form="stable-human-choice",input={goal:"Purpose",dependsOn:"parent",issue:null,target,signatureOverride:form};const first=contributionCreationIntent(null,input,()=>"task-original");const current={...target,acceptedCommit:"b".repeat(40),acceptedVersion:4,policyVersion:3};const retry=contributionCreationIntent(first,{...input,target:current},()=>{throw Error("Must not create a replacement identity");});expect(retry).toBe(first);expect(retry.payload.expectedTarget).toEqual(contributionExpectation(target));expect(retry.taskId).toBe("task-original");
});
test("legacy primary omission remains unchanged and explicit user selection creates separate intent",()=>{
 const input={goal:"Purpose",dependsOn:null,issue:null,target:null};const legacy=contributionCreationIntent(null,input,()=>"legacy-task");expect(legacy.payload).toEqual({taskId:"legacy-task",goal:"Purpose"});const selected=contributionCreationIntent(legacy,{...input,target},()=>"selected-task");expect(selected.taskId).toBe("selected-task");expect(selected.payload.expectedTarget).toEqual(contributionExpectation(target));expect(legacy.payload.expectedTarget).toBeUndefined();
});
