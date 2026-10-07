import {expect,test} from 'bun:test';
import {acceptanceStateSchema,requireReceiptLanding} from '../src/cli/acceptance';

function fixture(){
 const commit='b'.repeat(40),receipt={integration:'integration-owned',tasks:['alpha','beta'],base:'a'.repeat(40)};
 const state=acceptanceStateSchema.parse({acceptedState:{kind:'committed',currentCommit:commit},tasks:{},candidates:{exact:{status:'accepted',candidateCommit:commit,expectedAcceptedBase:receipt.base,workflowInstanceId:receipt.integration,participatingTaskIds:['beta','alpha'],evidenceId:'proof-owned',repairAttempts:[],review:{approved:true,commit,at:'2026-10-07'}}},evidence:{'proof-owned':{status:'passed',candidateCommit:commit}},decisions:{}});
 return{state,receipt,commit};
}
test('native verification binds exact accepted candidate to saved integration, task set and passed evidence',()=>{
 const {state,receipt,commit}=fixture();
 expect(requireReceiptLanding(state,receipt)).toEqual({accepted:commit,candidateId:'exact',integration:receipt.integration,evidenceId:'proof-owned'});
});
test('unrelated accepted history cannot satisfy a saved exercise even with identical accepted commit and review',()=>{
 const {state,receipt}=fixture();state.candidates.exact!.workflowInstanceId='another-integration';
 expect(()=>requireReceiptLanding(state,receipt)).toThrow('unrelated accepted history');
});
test('missing, duplicate, extra and foreign contribution identities cannot be claimed as the exercise',()=>{
 for(const taskIds of [undefined,['alpha'],['alpha','alpha'],['alpha','foreign'],['alpha','beta','extra']]){
  const {state,receipt}=fixture();state.candidates.exact!.participatingTaskIds=taskIds;
  expect(()=>requireReceiptLanding(state,receipt)).toThrow();
 }
 const {state,receipt}=fixture();expect(()=>requireReceiptLanding(state,{...receipt,tasks:['alpha','alpha']})).toThrow();expect(()=>requireReceiptLanding(state,{...receipt,integration:undefined})).toThrow();
});
test('absent or failed protected evidence refuses clone proof instead of trusting reviewed status',()=>{
 for(const status of ['failed','unknown','running']){const {state,receipt}=fixture();state.evidence['proof-owned']!.status=status;expect(()=>requireReceiptLanding(state,receipt)).toThrow('passed exact candidate evidence');}
 const {state,receipt}=fixture();delete state.evidence['proof-owned'];expect(()=>requireReceiptLanding(state,receipt)).toThrow();
});
test('ambiguous candidate identities and mismatched review commit are refused',()=>{
 const {state,receipt}=fixture();state.candidates.duplicate=structuredClone(state.candidates.exact!);expect(()=>requireReceiptLanding(state,receipt)).toThrow('unique');delete state.candidates.duplicate;state.candidates.exact!.review!.commit='c'.repeat(40);expect(()=>requireReceiptLanding(state,receipt)).toThrow();
});

test('passed evidence for another commit cannot verify the exact accepted candidate',()=>{
 const {state,receipt}=fixture();state.evidence['proof-owned']!.candidateCommit='c'.repeat(40);expect(()=>requireReceiptLanding(state,receipt)).toThrow('passed exact candidate evidence');delete state.evidence['proof-owned']!.candidateCommit;expect(()=>requireReceiptLanding(state,receipt)).toThrow();
});
