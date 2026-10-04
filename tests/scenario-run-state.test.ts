import {test,expect} from 'bun:test';
import {checkedScenarioDiscovery,checkedScenarioDispatch,checkedScenarioStatus,scenarioFinished,scenarioPreparationBanner} from '../src/web/scenario-run-state';
const id='scn-p123456789abc-197cc1b2-588c-4a7c-bd8a-731e21894ec1';
test('scenario receipts preserve exact registered identities and incomplete discovery',()=>{
 expect(checkedScenarioDispatch({instanceId:id})).toBe(id);
 expect(checkedScenarioDiscovery({runs:[{instanceId:id,kind:'scenario',status:'unknown'}],nextCursor:'12',source:'repository-ledger',providerVerified:false})).toEqual({runs:[{instanceId:id}],nextCursor:'12'});
 expect(()=>checkedScenarioDiscovery({runs:[{instanceId:id},{instanceId:id}],nextCursor:null,source:'repository-ledger',providerVerified:false})).toThrow();
 expect(()=>checkedScenarioDispatch({instanceId:'guessed'})).toThrow();
 expect(()=>checkedScenarioDiscovery({runs:[],nextCursor:null,source:'provider',providerVerified:true})).toThrow();
});
test('unknown and paused scenario statuses do not permit duplicate dispatch',()=>{
 for(const status of [null,'unknown','running','queued','waiting','paused','waitingForPause'] as const)expect(scenarioFinished(status)).toBe(false);
 for(const status of ['complete','errored','terminated'] as const)expect(scenarioFinished(status)).toBe(true);
 const observation={instanceId:id,kind:'scenario',status:'running',action:'status',changed:false};expect(checkedScenarioStatus(observation,id)).toBe('running');
 expect(()=>checkedScenarioStatus({...observation,instanceId:'other'},id)).toThrow();
 expect(()=>checkedScenarioStatus({...observation,action:'resume'},id)).toThrow();
});

test('discovery cursors reject ambiguity, cycles and repeated identities across pages',()=>{
 const page=(nextCursor:string|null)=>({runs:[{instanceId:id}],nextCursor,source:'repository-ledger',providerVerified:false});
 for(const cursor of ['', '0', '-1', '1.5', '01', '9007199254740992'])expect(()=>checkedScenarioDiscovery(page(cursor))).toThrow();
 expect(()=>checkedScenarioDiscovery(page('12'),'12')).toThrow();expect(()=>checkedScenarioDiscovery(page('13'),'12')).toThrow();
 expect(checkedScenarioDiscovery(page('11'),'12').nextCursor).toBe('11');
 expect(()=>checkedScenarioDiscovery(page(null),'12',new Set([id]))).toThrow();
});

test('preparation claims require observed provider running or queued status',()=>{
 const run={act:'act1',instanceId:id};
 for(const status of [null,'unknown','paused','waiting','waitingForPause'] as const)expect(scenarioPreparationBanner(run,status)?.stage).toBe('blocked');
 expect(scenarioPreparationBanner({act:'act1',instanceId:null},null)?.message).toBe('Scenario status needs checking');
 expect(scenarioPreparationBanner(run,'running')?.stage).toBe('working');expect(scenarioPreparationBanner(run,'queued')?.stage).toBe('working');
 expect(scenarioPreparationBanner(run,'complete')).toBeNull();expect(scenarioPreparationBanner(null,null)).toBeNull();
});
