import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {RepositoryReviewLedger,type CandidateReviewScope} from '../src/server/repository-review-ledger';
function fixture(){const db=new Database(':memory:');const storage={sql:{exec(query:string,...bindings:Array<string|number>){if(query.includes(';')){db.exec(query);return{toArray:()=>[],one:()=>({})};}const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};const ledger=new RepositoryReviewLedger(storage as unknown as DurableObjectStorage);const scope:CandidateReviewScope={candidateId:'candidate-one',commit:'a'.repeat(40),tree:'b'.repeat(40),base:'c'.repeat(40),verificationPolicyVersion:1,reviewPolicyVersion:1,authorIds:['author']};ledger.configurePolicy({eventId:'policy-one',ownerId:'owner',expectedVersion:0,policy:{requiredApprovals:2,allowAuthorApproval:false}},()=>{});ledger.freeze(scope,()=>{});return{db,ledger,scope};}
const grant=(ledger:RepositoryReviewLedger,userId:string)=>ledger.setGrant({eventId:`grant-${userId}`,ownerId:'owner',userId,expectedVersion:0,enabled:true},()=>{});
test('delegated reviews only record evidence, retain exact identity and require independent current reviewers',()=>{
 const {db,ledger,scope}=fixture();try{
 for(const user of ['alice','bob','author'])grant(ledger,user);
 const input={eventId:'review-alice',scope,reviewerId:'alice',grantVersion:1,decision:'approve' as const,note:'Checked the behavioral diff'};
 const saved=ledger.record(input,()=>{},1000);expect(ledger.record(input,()=>{},2000)).toEqual(saved);
 expect(ledger.gate(scope,()=>true).passed).toBe(false);
 expect(()=>ledger.record({...input,eventId:'review-author',reviewerId:'author'},()=>{})).toThrow('author');
 expect(()=>ledger.record({...input,eventId:'review-new-sha',scope:{...scope,commit:'d'.repeat(40)}},()=>{})).toThrow('Exact');
 expect(()=>ledger.record({...input,note:'Changed replay'},()=>{})).toThrow('changed');
 ledger.record({...input,eventId:'review-bob',reviewerId:'bob'},()=>{},1001);expect(ledger.gate(scope,()=>true)).toMatchObject({passed:true,approvedBy:['alice','bob']});
 expect(ledger.gate(scope,user=>user!=='bob').passed).toBe(false);
 const tables=db.query<{name:string},[]>("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);expect(tables.every(name=>name.includes('review')||name.includes('approval'))).toBe(true);expect(tables).not.toContain('project');
 }finally{db.close();}
});
test('grant revocation and new grants invalidate old approvals while immutable event history remains',()=>{
 const {db,ledger,scope}=fixture();try{
 grant(ledger,'alice');grant(ledger,'bob');for(const user of ['alice','bob'])ledger.record({eventId:`review-${user}`,scope,reviewerId:user,grantVersion:1,decision:'approve'},()=>{},1000);
 ledger.setGrant({eventId:'revoke-bob',ownerId:'owner',userId:'bob',expectedVersion:1,enabled:false},()=>{});expect(ledger.gate(scope,()=>true).passed).toBe(false);
 // Replaying an old administration receipt cannot restore the old grant.
 grant(ledger,'bob');expect(ledger.grant('bob')).toMatchObject({version:2,enabled:false});
 ledger.setGrant({eventId:'regrant-bob',ownerId:'owner',userId:'bob',expectedVersion:2,enabled:true},()=>{});expect(ledger.gate(scope,()=>true).passed).toBe(false);
 ledger.record({eventId:'fresh-bob',scope,reviewerId:'bob',grantVersion:3,decision:'approve'},()=>{},1001);expect(ledger.gate(scope,()=>true).passed).toBe(true);expect(ledger.history(scope.candidateId).reviews).toHaveLength(3);
 ledger.record({eventId:'changes-alice',scope,reviewerId:'alice',grantVersion:1,decision:'request_changes'},()=>{},1002);expect(ledger.gate(scope,()=>true).blockingReviewers).toEqual(['alice']);
 ledger.record({eventId:'withdraw-alice',scope,reviewerId:'alice',grantVersion:1,decision:'withdraw'},()=>{},1003);expect(ledger.gate(scope,()=>true)).toMatchObject({passed:false,blockingReviewers:[]});expect(ledger.history(scope.candidateId,2).truncated).toBe(true);
 }finally{db.close();}
});
test('fresh policy and authority failures preserve prior scope and reviews without weakening the gate',()=>{
 const {db,ledger,scope}=fixture();try{
 expect(()=>ledger.setGrant({eventId:'denied-grant',ownerId:'forged',userId:'alice',expectedVersion:0,enabled:true},()=>{throw Error('Not owner');})).toThrow('Not owner');expect(ledger.grant('alice')).toBeNull();
 grant(ledger,'alice');expect(()=>ledger.record({eventId:'denied-review',scope,reviewerId:'alice',grantVersion:1,decision:'approve'},()=>{throw Error('Withdrawn');})).toThrow('Withdrawn');expect(ledger.history(scope.candidateId).reviews).toEqual([]);
 ledger.configurePolicy({eventId:'policy-two',ownerId:'owner',expectedVersion:1,policy:{requiredApprovals:3,allowAuthorApproval:false}},()=>{});
 expect(()=>ledger.gate(scope,()=>true)).toThrow('fresh candidate');expect(ledger.frozen(scope.candidateId)?.scope).toEqual(scope);
 expect(()=>ledger.freeze({...scope,commit:'d'.repeat(40),reviewPolicyVersion:2},()=>{})).toThrow('changed');
 }finally{db.close();}
});
test('genuine unborn review keeps null base bound to exact target and human candidate evidence',()=>{const {db,ledger,scope}=fixture();try{const unborn:CandidateReviewScope={...scope,candidateId:'candidate-first',base:null,unbornTarget:{kind:'unborn',projectId:'project',incarnation:crypto.randomUUID(),canonicalRepoName:'canonical',ref:'refs/heads/main',branch:'main',acceptedCommit:null,acceptedVersion:0,requirements:[],policyVersion:1,policy:{checks:'verified'}}};expect(()=>ledger.freeze({...scope,candidateId:'candidate-null',base:null},()=>{})).toThrow('explicit unborn');expect(()=>ledger.freeze({...unborn,unbornTarget:{...unborn.unbornTarget!,policyVersion:2}},()=>{})).toThrow('explicit unborn');expect(()=>ledger.freeze({...unborn,base:scope.base},()=>{})).toThrow('explicit unborn');ledger.freeze(unborn,()=>{});grant(ledger,'alice');const input={eventId:'first-review-alice',scope:unborn,reviewerId:'alice',grantVersion:1,decision:'approve' as const};expect(()=>ledger.record(input,()=>{throw Error('Human authority changed');})).toThrow('Human authority');const receipt=ledger.record(input,()=>{},1000);expect(receipt.scope.base).toBeNull();expect(receipt.scope.unbornTarget).toEqual(unborn.unbornTarget);expect(ledger.record(input,()=>{},2000)).toEqual(receipt);for(const changed of [{...unborn,commit:'d'.repeat(40)},{...unborn,tree:'e'.repeat(40)},{...unborn,unbornTarget:{...unborn.unbornTarget!,ref:'refs/heads/release',branch:'release'}},{...unborn,unbornTarget:{...unborn.unbornTarget!,incarnation:crypto.randomUUID()}}])expect(()=>ledger.record({...input,scope:changed},()=>{})).toThrow('Exact frozen');expect(ledger.history(unborn.candidateId).reviews).toHaveLength(1);}finally{db.close();}});
