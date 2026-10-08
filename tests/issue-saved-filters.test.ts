import {Database} from 'bun:sqlite';
import {test,expect} from 'bun:test';
import {IssueFeatureStore,issueFilterSchema,savedIssueFilterWrite} from '../src/server/issue-feature-store';
function storage(db:Database){return {sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;}
function issues(db:Database,count=65){db.exec("CREATE TABLE issues(number INTEGER PRIMARY KEY,title TEXT,body TEXT,author TEXT,state TEXT,created_at TEXT,updated_at TEXT,closed_by TEXT); CREATE TABLE comments(id INTEGER PRIMARY KEY,subject TEXT)");for(let number=1;number<=count;number++)db.query('INSERT INTO issues VALUES(?,?,?,?,?,?,?,?)').run(number,`Issue ${number}`,number===2?'Unique description token':'Shared context','Member','open','2026-10-08T12:00:00Z',`2026-10-08T12:${String(number%60).padStart(2,'0')}:00Z`,null);}
test('personal saved filters persist criteria without issue copies; CAS/replay/delete keep actor and repository scope isolated',async()=>{
 const path=`/tmp/issue-saved-filters-${crypto.randomUUID()}.sqlite`;let db=new Database(path);
 try{
  issues(db,2);let store=new IssueFeatureStore(storage(db)),id=crypto.randomUUID();const filter=issueFilterSchema.parse({state:'all',label:'ready',sort:'number-asc'}),input={action:'save' as const,id,expectedScope:'a'.repeat(64),name:'Private triage title',expectedVersion:0,filter};
  store.savedFilterUpdate('repository-incarnation-1','alice',input,()=>{});expect(store.savedFilterUpdate('repository-incarnation-1','alice',input,()=>{})).toMatchObject({version:1});
  expect(store.savedFilters('repository-incarnation-1','bob')).toEqual([]);expect(store.savedFilters('repository-incarnation-2','alice')).toEqual([]);
  db.close();db=new Database(path);store=new IssueFeatureStore(storage(db));expect(store.savedFilters('repository-incarnation-1','alice')[0]?.filter).toEqual(filter);
  const before=store.savedFilters('repository-incarnation-1','alice');expect(()=>store.savedFilterUpdate('repository-incarnation-1','alice',{...input,action:'save',name:'Changed stale title'},()=>{})).toThrow('changed');expect(store.savedFilters('repository-incarnation-1','alice')).toEqual(before);
  expect(()=>store.savedFilterUpdate('repository-incarnation-1','alice',{action:'delete',id,expectedScope:'a'.repeat(64),expectedVersion:1},()=>{throw Error('Permission revoked');})).toThrow('revoked');expect(store.savedFilters('repository-incarnation-1','alice')).toEqual(before);
  const remove=savedIssueFilterWrite.parse({action:'delete',id,expectedScope:'a'.repeat(64),expectedVersion:1});store.savedFilterUpdate('repository-incarnation-1','alice',remove,()=>{});expect(store.savedFilterUpdate('repository-incarnation-1','alice',remove,()=>{})).toMatchObject({deleted:true});expect(()=>store.savedFilterUpdate('repository-incarnation-1','alice',input,()=>{})).toThrow('cannot be recreated');
 }finally{db.close();await Bun.file(path).delete();}
});
test('issue query uses canonical labels/assignees and literal text, with complete bounded pages bound to principal/query/issue version',async()=>{
 const db=new Database(':memory:');try{
  issues(db);const store=new IssueFeatureStore(storage(db)),filter=issueFilterSchema.parse({sort:'number-asc'}),first=await store.filteredIssues('scope','alice',filter);
  expect(first.issues).toHaveLength(50);expect(first.nextCursor).not.toBeNull();expect(first.complete).toBe(false);expect(first.total).toBe(65);
  const next=await store.filteredIssues('scope','alice',filter,first.nextCursor!);expect(next.issues.map(issue=>issue.number)).toEqual(Array.from({length:15},(_,index)=>index+51));expect(next.complete).toBe(true);
  for(const [scope,actor,criteria] of [['other-scope','alice',filter],['scope','bob',filter],['scope','alice',issueFilterSchema.parse({sort:'number-desc'})]] as const)await expect(store.filteredIssues(scope,actor,criteria,first.nextCursor!)).rejects.toThrow('no longer matches');
  expect((await store.filteredIssues('scope','alice',issueFilterSchema.parse({q:'unique description token'}))).issues.map(issue=>issue.number)).toEqual([2]);
  expect((await store.filteredIssues('scope','alice',issueFilterSchema.parse({q:"' OR 1=1--"}))).issues).toEqual([]);
  expect(store.update({expectedRevision:0,action:{kind:'bulk-label',numbers:[1,2],label:'ready'}},['member'],true).ok).toBe(true);
  expect(store.update({expectedRevision:1,action:{kind:'bulk-assign',numbers:[2],assignee:'member'}},['member'],true).ok).toBe(true);
  expect((await store.filteredIssues('scope','alice',issueFilterSchema.parse({label:'ready',assignee:'member'}))).issues.map(issue=>issue.number)).toEqual([2]);
  await expect(store.filteredIssues('scope','alice',filter,first.nextCursor!)).rejects.toThrow('no longer matches');
  const current=await store.filteredIssues('scope','alice',filter);db.query("UPDATE issues SET title='Changed current title' WHERE number=1").run();await expect(store.filteredIssues('scope','alice',filter,current.nextCursor!)).rejects.toThrow('no longer matches');
 }finally{db.close();}
});
test('saved filter schemas reject actor grants and query truncation is refused',async()=>{expect(savedIssueFilterWrite.safeParse({action:'save',id:crypto.randomUUID(),name:'view',expectedVersion:0,expectedScope:'a'.repeat(64),filter:{state:'open'},actorId:'other'}).success).toBe(false);const db=new Database(':memory:');try{issues(db,10001);await expect(new IssueFeatureStore(storage(db)).filteredIssues('scope','alice',issueFilterSchema.parse({}))).rejects.toThrow('at most 10000');}finally{db.close();}});
