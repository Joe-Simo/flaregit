import {expect,test} from 'bun:test';
import {prepareIntegrationIntent,readIntegrationIntents,saveIntegrationIntent,acknowledgeIntegrationIntent,clearIntegrationIntentRecovery,type IntegrationIntentScope} from '../src/web/integration-intent-recovery';
import type {FlareGitProjectState,Task} from '../src/core/types';
const hash=(digit:string)=>digit.repeat(40),scope:IntegrationIntentScope={identity:'synthetic-owner:session-A',projectId:'p123456789abc'};
function storage(){const records=new Map<string,string>();return {getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);},removeItem:(key:string)=>{records.delete(key);},get length(){return records.size;},key:(index:number)=>[...records.keys()][index]??null};}
function state():FlareGitProjectState{const task=(id:string,commit:string):Task=>({id,goal:id,contributor:{id:'synthetic-author',type:'human',name:'Synthetic author'},baseCommit:hash('a'),currentCommit:commit,allowedScope:[],status:'ready',requirements:[],workspace:{repoName:'synthetic',remote:'https://example.invalid',branch:id},checkpoints:[],createdAt:'2026-10-05T12:00:00Z',updatedAt:'2026-10-05T12:00:00Z'});return {projectId:scope.projectId,projectName:'Synthetic intent test',canonicalRepoName:'synthetic',acceptedState:{currentCommit:hash('a'),acceptedAt:'2026-10-05T12:00:00Z',buildDigest:'synthetic',activeRequirements:[],history:[]},tasks:{alpha:task('alpha',hash('b')),beta:task('beta',hash('c'))},candidates:{},evidence:{},decisions:{},journal:[],policyVersion:3,verificationPolicy:{}};}
const key='11111111-1111-4111-8111-111111111111',secondKey='22222222-2222-4222-8222-222222222222';
test('unknown acknowledgements reload the exact original key, selected order, heads, base and policy',()=>{
 const store=storage(),current=state(),intent=prepareIntegrationIntent(current,['beta','alpha'],key);saveIntegrationIntent(store,scope,intent);saveIntegrationIntent(store,scope,{...intent,phase:'unknown'});
 current.tasks.alpha!.currentCommit=hash('e');current.acceptedState.currentCommit=hash('f');current.policyVersion=4;
 const restored=readIntegrationIntents(store,scope)[0]!;expect(restored.request).toEqual(intent.request);expect(restored.request.taskIds).toEqual(['beta','alpha']);expect(restored.request.expected.contributions.map(input=>input.commit)).toEqual([hash('c'),hash('b')]);expect(restored.request.expected.policyVersion).toBe(3);expect(restored.phase).toBe('unknown');
});
test('a new explicit selection keeps the original uncertain request and cannot reuse its key for different context',()=>{
 const store=storage(),current=state(),original=prepareIntegrationIntent(current,['alpha'],key);saveIntegrationIntent(store,scope,original);const changed=prepareIntegrationIntent(current,['beta'],secondKey);saveIntegrationIntent(store,scope,changed);expect(readIntegrationIntents(store,scope)).toHaveLength(2);expect(()=>saveIntegrationIntent(store,scope,prepareIntegrationIntent(current,['beta'],key))).toThrow('cannot be replaced');acknowledgeIntegrationIntent(store,scope,secondKey);expect(readIntegrationIntents(store,scope)).toEqual([original]);
});
test('unavailable storage refuses preparation and restoration is scoped to the captured principal and repository',()=>{
 const store=storage(),intent=prepareIntegrationIntent(state(),['alpha'],key);saveIntegrationIntent(store,scope,intent);expect(readIntegrationIntents(store,{...scope,identity:'other-session'})).toEqual([]);expect(readIntegrationIntents(store,{...scope,projectId:'p987654321abc'})).toEqual([]);
 const denied={...store,setItem:()=>{throw new Error('Synthetic storage denied');}};expect(()=>saveIntegrationIntent(denied,scope,prepareIntegrationIntent(state(),['beta'],secondKey))).toThrow();expect(readIntegrationIntents(store,scope)).toEqual([intent]);
 clearIntegrationIntentRecovery('other-session',store);expect(readIntegrationIntents(store,scope)).toEqual([]);
});
test('verified sign-out purges scoped integration recovery without deleting unrelated application storage',()=>{
 const store=storage();saveIntegrationIntent(store,scope,prepareIntegrationIntent(state(),['alpha'],key));store.setItem('unrelated-setting','keep');clearIntegrationIntentRecovery(null,store);expect(readIntegrationIntents(store,scope)).toEqual([]);expect(store.getItem('unrelated-setting')).toBe('keep');
});
test('active accepted-target generation is frozen deeply rather than replaced by a later visible target',()=>{
 const current=state(),target={projectId:scope.projectId,incarnation:'33333333-3333-4333-8333-333333333333',canonicalRepoName:'synthetic',ref:'refs/heads/main',branch:'main',acceptedCommit:hash('a'),acceptedVersion:1,requirements:[],policyVersion:3,policy:{browserCheck:true}};
 const generation={eventId:secondKey,generation:1,acceptedTarget:target,baseCommit:hash('a'),currentCommit:hash('b')};current.tasks.alpha={...current.tasks.alpha!,acceptedTarget:target,targetGeneration:generation};
 const original=prepareIntegrationIntent(current,['alpha'],key);target.policy.browserCheck=false;target.acceptedVersion=2;generation.generation=2;
 expect(original.request.expected.contributions[0]!.acceptedTarget?.policy).toEqual({browserCheck:true});expect(original.request.expected.contributions[0]!.acceptedTarget?.acceptedVersion).toBe(1);expect(original.request.expected.contributions[0]!.targetGeneration).toEqual({eventId:secondKey,generation:1});
});
