import { expect, test } from "bun:test";
import { GIT_INTEGRITY_POLICY, isGitIntegrityPolicy, settingsFor } from "../src/core/command-policy";
import { assertAgentWrites } from "../src/agents/prompt";
test("ordinary Git policy permits README and source without inventing application commands",()=>{
 const settings=settingsFor({...GIT_INTEGRITY_POLICY});
 expect(settingsFor({kind:"git-integrity",protectedPaths:["notes/"]}).protectedPaths).toEqual([".flaregit/","notes/"]);
 expect(settings.fixture).toBe("git-integrity");expect(settings.checkCommand).toBeUndefined();
 expect(()=>assertAgentWrites({allowedScope:settings.allowedScope},["README.md","package.json","src/main.ts"],settings.protectedPaths)).not.toThrow();
 expect(()=>assertAgentWrites({allowedScope:settings.allowedScope},[".flaregit/policy.json"],settings.protectedPaths)).toThrow();
 expect(()=>assertAgentWrites({allowedScope:settings.allowedScope},[".github/workflows/review.yml"],settings.protectedPaths)).not.toThrow();
});
test("legacy ticket and configured customer command behavior remain unchanged",()=>{
 expect(settingsFor({})).toMatchObject({fixture:"ticket-booking",allowedScope:["src/"]});
 expect(settingsFor({kind:"command",test:"bun test"})).toMatchObject({fixture:"custom",checkCommand:"bun test"});
});
test("invalid explicit policies cannot fall back to demo verification",()=>{
 for(const policy of [{kind:"git-integrity",allowedScope:[]},{kind:"git-integrity",allowedScope:["../"]},{kind:"git-integrity",landing:"automatic"},{kind:"git-integrity",protectedPaths:["/private"]}]){
  expect(isGitIntegrityPolicy(policy)).toBe(false);expect(()=>settingsFor(policy)).toThrow("policy is invalid");
 }
});
