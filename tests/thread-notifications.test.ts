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
test('mentions override subscriptions once, reach unsubscribed readers and remain fenced after mute/regrant',()=>{
 const f=fixture(),incarnation=crypto.randomUUID(),subject='issue:12';try{
  f.db.exec("INSERT INTO comments VALUES(1,'issue:12')");f.ledger.update(incarnation,subject,'reader',{mode:'subscribed',expectedVersion:0},()=>{});
  f.ledger.stage(incarnation,subject,1,'writer',[{userId:'reader',handle:'reader',accountKey:'reader-key',profileVersion:1,authoritySource:'synthetic-authority'},{userId:'other',handle:'other',accountKey:'other-key',profileVersion:1,authoritySource:'synthetic-authority'}]);
  expect(f.ledger.pending()).toHaveLength(2);const events=f.ledger.pending();expect(events.every(item=>item.delivery_kind==='mention')).toBe(true);
  const other=events.find(item=>item.actor_id==='other')!;expect(other.preference_version).toBe(0);expect(f.ledger.available(other)).toBe(true);
  f.ledger.update(incarnation,subject,'other',{mode:'subscribed',expectedVersion:0},()=>{});expect(f.ledger.available(other)).toBe(true);
  f.ledger.update(incarnation,subject,'other',{mode:'unsubscribed',expectedVersion:1},()=>{});expect(f.ledger.available(other)).toBe(true);
  f.ledger.update(incarnation,subject,'other',{mode:'muted',expectedVersion:2},()=>{});expect(f.ledger.available(other)).toBe(false);
  f.ledger.update(incarnation,subject,'other',{mode:'unsubscribed',expectedVersion:3},()=>{});expect(f.ledger.available(other)).toBe(false);
  expect(new ThreadNotifications(f.storage).available(other)).toBe(false);
 }finally{f.db.close();}
});
test('legacy preference migration conservatively preserves old mention withdrawal',()=>{
 const f=fixture(),incarnation=crypto.randomUUID(),subject='issue:12';try{
  f.db.exec("INSERT INTO comments VALUES(1,'issue:12')");f.ledger.update(incarnation,subject,'reader',{mode:'subscribed',expectedVersion:0},()=>{});
  f.ledger.stage(incarnation,subject,1,'writer',[{userId:'reader',handle:'reader',accountKey:'reader-key',profileVersion:1,authoritySource:'synthetic-authority'}]);const event=f.ledger.pending()[0]!;
  f.db.exec('DROP TABLE thread_preferences; CREATE TABLE thread_preferences(incarnation TEXT,subject TEXT,actor_id TEXT,mode TEXT,version INTEGER,PRIMARY KEY(incarnation,subject,actor_id))');
  f.db.query('INSERT INTO thread_preferences VALUES(?,?,?,?,?)').run(incarnation,subject,'reader','unsubscribed',3);
  const migrated=new ThreadNotifications(f.storage);expect(migrated.available(event)).toBe(false);
  migrated.update(incarnation,subject,'reader',{mode:'subscribed',expectedVersion:3},()=>{});expect(migrated.available(event)).toBe(false);
 }finally{f.db.close();}
});
