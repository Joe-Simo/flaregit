import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {MembershipEpochs} from '../src/server/membership-epochs';
function fixture(){const db=new Database(':memory:');db.exec('CREATE TABLE members(user_id TEXT PRIMARY KEY,role TEXT NOT NULL,label TEXT,added_at TEXT NOT NULL)');const storage={sql:{exec(query:string,...bindings:Array<string|number>){if(query.includes(';')){db.exec(query);return{toArray:()=>[]};}return{toArray:()=>db.query(query).all(...bindings)};}}} as unknown as DurableObjectStorage;return{db,storage};}
test('direct membership generations survive same-timestamp remove/regrant and raw permission updates',()=>{
 const f=fixture();try{
  f.db.exec("INSERT INTO members VALUES('reader','member',NULL,'same-millisecond')");const ledger=new MembershipEpochs(f.storage),initial=ledger.read('reader');
  f.db.exec("DELETE FROM members WHERE user_id='reader'; INSERT INTO members VALUES('reader','member',NULL,'same-millisecond')");expect(ledger.read('reader')).toBe(initial+2);
  f.db.exec("UPDATE members SET role='owner' WHERE user_id='reader'");expect(ledger.read('reader')).toBe(initial+3);
  f.db.exec("UPDATE members SET label='Changed label',added_at='same-millisecond' WHERE user_id='reader'");expect(ledger.read('reader')).toBe(initial+3);
  expect(new MembershipEpochs(f.storage).read('reader')).toBe(initial+3);
  f.db.exec("INSERT OR REPLACE INTO members VALUES('reader','member',NULL,'same-millisecond')");expect(ledger.read('reader')).toBeGreaterThan(initial+3);
 }finally{f.db.close();}
});
test('exhausted or malformed membership epochs fail closed without blocking membership deletion',()=>{
 const f=fixture();try{
  f.db.exec("INSERT INTO members VALUES('reader','member',NULL,'stamp')");const ledger=new MembershipEpochs(f.storage);
  f.db.query('UPDATE membership_epochs SET epoch=? WHERE user_id=?').run(Number.MAX_SAFE_INTEGER,'reader');expect(()=>ledger.read('reader')).toThrow('unavailable');
  f.db.exec("DELETE FROM members WHERE user_id='reader'");expect(()=>ledger.read('reader')).toThrow('unavailable');expect(f.db.query('SELECT * FROM members').all()).toEqual([]);
 }finally{f.db.close();}
});
