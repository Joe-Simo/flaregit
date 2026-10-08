import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {IssueFeatureStore,type IssueFeatureWrite} from '../src/server/issue-feature-store';
function storage(db:Database){return {sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(fn:()=>T){return db.transaction(fn)();}} as unknown as DurableObjectStorage;}
test('issue planning survives reopen; failed bulk/cycle/delete/CAS never modify persisted state',async()=>{
 const path=`/tmp/issue-features-${crypto.randomUUID()}.sqlite`;let db=new Database(path);
 try{
 db.exec("CREATE TABLE issues(number INTEGER PRIMARY KEY,state TEXT); INSERT INTO issues VALUES(1,'open'),(2,'closed')");let store=new IssueFeatureStore(storage(db));
 const update=(action:IssueFeatureWrite['action'])=>store.update({expectedRevision:store.read().revision,action},['member'],true);
 expect(update({kind:'bulk-label',numbers:[1,2],label:'ready'}).ok).toBe(true);
 const before=store.read();expect(update({kind:'bulk-assign',numbers:[1,999],assignee:'member'}).ok).toBe(false);expect(store.read()).toEqual(before);
 expect(update({kind:'milestone-create',title:'First'}).ok).toBe(true);expect(update({kind:'milestone-assign',number:1,milestone:1}).ok).toBe(true);
 expect(update({kind:'milestone-delete',id:1}).ok).toBe(false);
 expect(update({kind:'milestone-create',title:'Second'}).ok).toBe(true);expect(update({kind:'milestone-delete',id:1,reassignTo:2}).ok).toBe(true);
 expect(update({kind:'relation-add',relation:'duplicate-of',from:1,to:2}).ok).toBe(true);expect(update({kind:'relation-add',relation:'duplicate-of',from:2,to:1}).ok).toBe(false);
 const current=store.read();db.close();db=new Database(path);store=new IssueFeatureStore(storage(db));expect(store.read()).toEqual(current);
 expect(store.update({expectedRevision:0,action:{kind:'label-remove',number:1,label:'ready'}},['member'],true)).toMatchObject({ok:false,status:409});
 expect(store.view().progress).toEqual([{id:2,open:1,closed:0}]);
 expect(update({kind:'milestone-create',title:'Third'}).ok).toBe(true);expect(store.read().milestones.at(-1)?.id).toBe(3);
 }finally{db.close();await Bun.file(path).delete();}
});
