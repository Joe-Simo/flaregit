import {expect,test} from 'bun:test';
import {combinableSelection,combineSelectionBlocker,integrationIntentFor} from '../src/web/integration-selection';
import {prepareIntegrationIntent} from '../src/web/integration-intent-recovery';
import type {FlareGitProjectState,Task} from '../src/core/types';

const hash=(digit:string)=>digit.repeat(40);
function state():FlareGitProjectState{
 const task=(id:string,commit:string,createdAt:string,status:Task['status']='ready'):Task=>({id,goal:id,contributor:{id:'synthetic-author',type:'human',name:'Synthetic author'},baseCommit:hash('a'),currentCommit:commit,allowedScope:[],status,requirements:[],workspace:{repoName:'synthetic',remote:'https://example.invalid',branch:id},checkpoints:[],createdAt,updatedAt:createdAt});
 return {projectId:'p123456789abc',projectName:'Synthetic selection test',canonicalRepoName:'synthetic',acceptedState:{currentCommit:hash('a'),acceptedAt:'2026-10-05T12:00:00Z',buildDigest:'synthetic',activeRequirements:[],history:[]},
  tasks:{alpha:task('alpha',hash('b'),'2026-10-05T12:00:00Z'),beta:task('beta',hash('c'),'2026-10-05T13:00:00Z'),refundable:task('refundable',hash('d'),'2026-10-05T14:00:00Z'),drafting:task('drafting',hash('e'),'2026-10-05T15:00:00Z','working')},
  candidates:{},evidence:{},decisions:{},journal:[],policyVersion:3,verificationPolicy:{}};
}

test('the list-level request body contains exactly the selected ids in a stable order',()=>{
 const current=state();
 const ids=combinableSelection(current,['beta','alpha']);
 expect(combineSelectionBlocker(ids)).toBeNull();
 const body=JSON.parse(JSON.stringify(integrationIntentFor(current,ids,[]).request)) as {taskIds:string[];expected:{contributions:{taskId:string}[]}};
 expect(body.taskIds).toEqual(['alpha','beta']);
 expect(body.expected.contributions.map(input=>input.taskId)).toEqual(['alpha','beta']);
 expect(body.taskIds).not.toContain('refundable');
});

test('selection order does not change the request and duplicates or non-combinable ids are dropped',()=>{
 const current=state();
 expect(combinableSelection(current,['alpha','beta'])).toEqual(combinableSelection(current,['beta','alpha','beta','drafting','missing']));
});

test('an empty selection is blocked with a reason',()=>{
 expect(combineSelectionBlocker(combinableSelection(state(),['drafting']))).toBe('Select at least one ready or blocked change to combine.');
 expect(combineSelectionBlocker(['a','b','c','d','e','f','g','h','i'])).toContain('at most 8');
});

test('a saved original is reused only for the identical id set',()=>{
 const current=state(),saved=prepareIntegrationIntent(current,['alpha','beta'],'11111111-1111-4111-8111-111111111111');
 expect(integrationIntentFor(current,combinableSelection(current,['beta','alpha']),[saved])).toBe(saved);
 expect(integrationIntentFor(current,['alpha'],[saved]).request.taskIds).toEqual(['alpha']);
});
