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
