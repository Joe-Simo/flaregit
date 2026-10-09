import {test,expect} from 'bun:test';
import {preservedCandidateSuccessors} from '../src/web/candidate-lineage';
import {summarizeIntegration} from '../src/web/integration-summary';
import type {CandidateGeneration,FlareGitProjectState} from '../src/core/types';
const original:CandidateGeneration={id:'original',attemptNumber:1,participatingTaskIds:['one'],participatingCommits:{one:'a'.repeat(40)},expectedAcceptedBase:'b'.repeat(40),frozenPolicyVersion:1,frozenVerificationPolicy:{},frozenRequirements:[],repairAttempts:[],status:'composing',workflowInstanceId:'old-workflow',createdAt:'2026-10-03',updatedAt:'2026-10-03'};
const successor:CandidateGeneration={...original,id:'successor',predecessorCandidateId:'original',legacyRerunId:'12345678-1234-1234-1234-123456789abc',preservationProtocolVersion:1,workflowInstanceId:'new-workflow',status:'awaiting_review'};
test('recorded successor preserves original immutable status but excludes it from live summary',()=>{
 const candidates={original:structuredClone(original),successor:structuredClone(successor)};const before=JSON.stringify(candidates);
 expect(preservedCandidateSuccessors(candidates).get('original')?.id).toBe('successor');
 const state:FlareGitProjectState={projectId:'synthetic',projectName:'Synthetic',canonicalRepoName:'synthetic',acceptedState:{currentCommit:'b'.repeat(40),acceptedAt:'2026-10-03',buildDigest:'synthetic',activeRequirements:[],history:[]},tasks:{},candidates,evidence:{},decisions:{},journal:[],policyVersion:1,verificationPolicy:{}};
 expect(summarizeIntegration(state).message).toBe('Combined preview waiting for your review');
 expect(summarizeIntegration({...state,candidates:{original:candidates.original,successor:{...successor,status:'failed',failureBlocker:'Checks failed'}}}).message).toBe('Integration failed');
 expect(JSON.stringify(candidates)).toBe(before);expect(candidates.original.status).toBe('composing');
});
test('missing or ambiguous provenance cannot hide a live original',()=>{
 expect(preservedCandidateSuccessors({original,successor:{...successor,legacyRerunId:undefined}}).size).toBe(0);
 expect(preservedCandidateSuccessors({original,successor:{...successor,participatingCommits:{one:'c'.repeat(40)}}}).size).toBe(0);
 expect(preservedCandidateSuccessors({original,successor:{...successor,preservationProtocolVersion:undefined}}).size).toBe(0);
 expect(preservedCandidateSuccessors({original:{...original,status:'accepted'},successor}).size).toBe(0);
 expect(preservedCandidateSuccessors({original,successor,another:{...successor,id:'another'}}).size).toBe(0);
});

test('missing frozen hashes or original workflow cannot imply preservation',()=>{
 expect(preservedCandidateSuccessors({original:{...original,participatingCommits:{}},successor:{...successor,participatingCommits:{}}}).size).toBe(0);
 expect(preservedCandidateSuccessors({original:{...original,participatingCommits:{one:'invalid'}},successor:{...successor,participatingCommits:{one:'invalid'}}}).size).toBe(0);
 expect(preservedCandidateSuccessors({original:{...original,workflowInstanceId:undefined},successor}).size).toBe(0);
 expect(preservedCandidateSuccessors({original,successor:{...successor,workflowInstanceId:original.workflowInstanceId}}).size).toBe(0);
});
test('arbitrary-length cyclic provenance cannot hide live attempts',()=>{
 for(const length of [2,3,5]){
  const records:Record<string,CandidateGeneration>={};for(let index=0;index<length;index++){const id=`node-${index}`;records[id]={...successor,id,predecessorCandidateId:`node-${(index+length-1)%length}`,workflowInstanceId:`workflow-${index}`,status:'composing'};}
  expect(preservedCandidateSuccessors(records).size).toBe(0);
 }
 const middle={...successor},leaf={...successor,id:'leaf',predecessorCandidateId:'successor',workflowInstanceId:'leaf-workflow'};
 const relation=preservedCandidateSuccessors({original,successor:middle,leaf});expect(relation.get('original')?.id).toBe('successor');expect(relation.get('successor')?.id).toBe('leaf');
});
