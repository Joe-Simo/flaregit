import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {ThreadNotifications} from '../src/server/thread-notifications';
function fixture(){const db=new Database(':memory:');const storage={sql:{exec(query:string,...bindings:Array<string|number>){if(query.includes(';')){db.exec(query);return{toArray:()=>[],one:()=>({})};}const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(action:()=>T){return db.transaction(action)();}} as unknown as DurableObjectStorage;db.exec('CREATE TABLE comments(id INTEGER PRIMARY KEY,subject TEXT)');return{db,storage,ledger:new ThreadNotifications(storage)};}
test('thread subscriptions persist and commit notifications atomically with their source',()=>{
 const f=fixture(),incarnation=crypto.randomUUID(),subject='issue:12';try{
  expect(f.ledger.read(incarnation,subject,'reader').mode).toBe('unsubscribed');
  f.ledger.update(incarnation,subject,'reader',{mode:'subscribed',expectedVersion:0},()=>{});
  expect(()=>f.storage.transactionSync(()=>{f.db.exec("INSERT INTO comments VALUES(1,'issue:12')");f.ledger.stage(incarnation,subject,1,'writer');throw Error('Source transaction rejected');})).toThrow();
  expect(f.ledger.pending()).toEqual([]);expect(f.db.query('SELECT * FROM comments').all()).toEqual([]);
  f.storage.transactionSync(()=>{f.db.exec("INSERT INTO comments VALUES(1,'issue:12')");f.ledger.stage(incarnation,subject,1,'writer');});
  const restarted=new ThreadNotifications(f.storage),event=restarted.pending()[0]!;expect(restarted.available(event)).toBe(true);
  restarted.stage(incarnation,subject,1,'writer');expect(restarted.pending()).toHaveLength(1);
  restarted.update(incarnation,subject,'reader',{mode:'muted',expectedVersion:1},()=>{});expect(restarted.available(event)).toBe(false);
  restarted.update(incarnation,subject,'reader',{mode:'subscribed',expectedVersion:2},()=>{});expect(restarted.available(event)).toBe(false);
  expect(restarted.read(crypto.randomUUID(),subject,'reader').mode).toBe('unsubscribed');
 }finally{f.db.close();}
});
test('deleted comments, other threads and self-authored comments cannot produce a delivery',()=>{
 const f=fixture(),incarnation=crypto.randomUUID();try{
  f.ledger.update(incarnation,'change:task-one','writer',{mode:'subscribed',expectedVersion:0},()=>{});
  f.db.exec("INSERT INTO comments VALUES(1,'change:task-one')");f.ledger.stage(incarnation,'change:task-one',1,'writer');expect(f.ledger.pending()).toEqual([]);
  f.ledger.update(incarnation,'change:task-one','reader',{mode:'subscribed',expectedVersion:0},()=>{});f.ledger.stage(incarnation,'change:task-one',1,'writer');const event=f.ledger.pending()[0]!;
  f.db.exec('DELETE FROM comments WHERE id=1');expect(f.ledger.available(event)).toBe(false);f.ledger.acknowledge(event);expect(f.ledger.hasPending()).toBe(false);
  expect(()=>f.ledger.update(incarnation,'change:task-one','reader',{mode:'muted',expectedVersion:0},()=>{})).toThrow('changed');
  expect(()=>f.ledger.update(incarnation,'change:task-one','reader',{mode:'muted',expectedVersion:1},()=>{throw Error('Access revoked');})).toThrow('revoked');expect(f.ledger.read(incarnation,'change:task-one','reader').version).toBe(1);
 }finally{f.db.close();}
});
