import {expect,test} from "bun:test";
import {taskCreationInputSchema,taskCreationPayload} from "../src/server/task-creation";
test("stacked creation preserves long saved dependency identities without changing replay payload",()=>{
 const dependsOn="agent-a-discount-197cc1b2-588c-4a7c-bd8a-731e21894ec1";
 const input={goal:"Continue the saved change",dependsOn,issue:null};
 expect(taskCreationInputSchema.parse(input)).toEqual(input);
 expect(JSON.parse(taskCreationPayload(input))).toEqual(input);
 expect(taskCreationInputSchema.safeParse({...input,dependsOn:"a".repeat(101)}).success).toBe(true);
 for(const id of ["ab","a".repeat(102),"-bad","bad_name","bad/name","bad..name"])expect(taskCreationInputSchema.safeParse({...input,dependsOn:id}).success).toBe(false);
});

test("explicit accepted creation tuple is strict and preserves legacy payload bytes",()=>{const legacy={goal:"Work",dependsOn:null,issue:null},expectedTarget={ref:"refs/heads/release",acceptedCommit:"a".repeat(40),acceptedVersion:0,policyVersion:1};expect(taskCreationPayload(legacy)).toBe(JSON.stringify(legacy));expect(JSON.parse(taskCreationPayload({...legacy,expectedTarget}))).toEqual({...legacy,expectedTarget});for(const invalid of [{...expectedTarget,policy:{}},{...expectedTarget,requirements:[]},{...expectedTarget,ref:"release"},{...expectedTarget,acceptedCommit:"0".repeat(40)},{...expectedTarget,acceptedVersion:-1}])expect(taskCreationInputSchema.safeParse({...legacy,expectedTarget:invalid}).success).toBe(false);});
