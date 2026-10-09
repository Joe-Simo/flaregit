import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {TaskRetargets,type TaskRetargetIdentity} from '../src/server/task-retarget';
import type {TaskTargetGenerationIntent} from '../src/server/task-target-generations';
test('bounded retarget history always includes the exact older live holder before recent prepared requests',()=>{
 const db=new Database(':memory:'),storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}} as unknown as DurableObjectStorage,ledger=new TaskRetargets(storage),incarnation=crypto.randomUUID();
 const original={projectId:'project',incarnation,canonicalRepoName:'canonical',ref:'refs/heads/main',branch:'main',acceptedCommit:'a'.repeat(40),acceptedVersion:0,requirements:[],policyVersion:1,policy:{}};
 const identity=(requestId:string):TaskRetargetIdentity=>{const intent:TaskTargetGenerationIntent={eventId:requestId,expectedGeneration:0,projectId:'project',incarnation,canonicalRepoName:'canonical',ownerId:'owner',actor:{userId:'owner',displayName:'Owner',viaToken:false},source:{taskId:'task',goal:'Preserve original work',contributorId:'creator',workspaceRepoName:'fork',branch:'task/change',baseCommit:original.acceptedCommit,currentCommit:'b'.repeat(40),requirements:[],snapshotDigest:'c'.repeat(64),originalAcceptedTarget:original},target:{...original,ref:'refs/heads/release',branch:'release'},change:{kind:'retarget',receiptId:requestId}};return{requestId,intent,providerRepoId:'provider',remote:`https://${'a'.repeat(32)}.artifacts.cloudflare.net/fork`};};
 try{
  const held=crypto.randomUUID();ledger.prepare(identity(held),()=>{});const executionId=ledger.lock('task',held);const recent:string[]=[];for(let index=0;index<25;index++){const id=crypto.randomUUID();recent.push(id);ledger.prepare(identity(id),()=>{});}
  const page=ledger.list('task');expect(page).toHaveLength(21);expect(page[0]!.requestId).toBe(held);expect(page.slice(1).map(record=>record.requestId)).toEqual(recent.slice(-20).reverse());expect(page.slice(0,20).some(record=>record.requestId===held)).toBe(true);
  ledger.unlock('task',held,executionId);expect(ledger.list('task')[0]!.requestId).toBe(recent.at(-1)!);
 }finally{db.close();}
});
