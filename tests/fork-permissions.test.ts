import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {ForkPermissions,type ForkPermissionScope} from '../src/server/fork-permissions';
function fixture(){const db=new Database(':memory:');const storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(fn:()=>T){return db.transaction(fn)();}} as unknown as DurableObjectStorage;return {db,storage,ledger:new ForkPermissions(storage)};}
test('human fork consent defaults off and only exact creator may change its version',()=>{
 const f=fixture(),scope:ForkPermissionScope={projectId:'repo',incarnation:crypto.randomUUID(),taskId:'task',repoName:'fork',branch:'task/task',creatorId:'creator'};
 try{
  expect(f.ledger.read(scope)).toEqual({enabled:false,revision:0});
  expect(()=>f.ledger.update(scope,'owner',0,true,()=>{})).toThrow('creator');
  f.ledger.update(scope,'creator',0,true,()=>{});const source=f.ledger.source(scope)!;
  expect(()=>f.ledger.update(scope,'creator',0,false,()=>{})).toThrow('revision');
  f.ledger.update(scope,'creator',1,false,()=>{});expect(()=>f.ledger.assert(scope,source)).toThrow('revoked');
  f.ledger.update(scope,'creator',2,true,()=>{});expect(()=>f.ledger.assert(scope,source)).toThrow('changed');
  const restarted=new ForkPermissions(f.storage);expect(restarted.read(scope)).toEqual({enabled:true,revision:3});
  expect(()=>restarted.read({...scope,repoName:'replacement-fork'})).toThrow('scope');
 }finally{f.db.close();}
});
