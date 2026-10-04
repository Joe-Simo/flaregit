import {test,expect} from 'bun:test';
import {hasOlderAcceptedBase} from '../src/web/change-base-state';
test('accepted dependency cannot hide an older base after canonical history advances',()=>{
 const old='a'.repeat(40),current='b'.repeat(40);const child={baseCommit:old,dependsOn:'parent'};
 expect(hasOlderAcceptedBase(child,current,{parent:{status:'accepted'}})).toBe(true);
 expect(hasOlderAcceptedBase({...child,baseCommit:current},current,{parent:{status:'accepted'}})).toBe(false);
 expect(hasOlderAcceptedBase({baseCommit:old},current,{})).toBe(true);
});
test('intentional pending stacks remain distinct from outdated accepted history',()=>{
 const child={baseCommit:'a'.repeat(40),dependsOn:'parent'},current='b'.repeat(40);
 for(const status of ['working','checkpointed','ready','integrating','verifying','blocked','needs_decision'] as const)expect(hasOlderAcceptedBase(child,current,{parent:{status}})).toBe(false);
 expect(hasOlderAcceptedBase(child,current,{})).toBe(false);
 expect(hasOlderAcceptedBase(child,current,{parent:{status:'cancelled'}})).toBe(true);
});
