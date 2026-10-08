import {Database} from 'bun:sqlite';
import {test,expect} from 'bun:test';
import {PlanningStore,planningMutationSchema,validatePlanningArchive,} from '../src/server/planning-store';
function storage(db:Database){return {sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(fn:()=>T){return db.transaction(fn)();}} as unknown as DurableObjectStorage;}
test('planning persists real issue references, applies automation atomically and detects competing edits',async()=>{
  const path=`/tmp/planning-${crypto.randomUUID()}.sqlite`;let db=new Database(path);
  try{
    db.exec('CREATE TABLE issues(number INTEGER PRIMARY KEY,title TEXT,state TEXT)');db.query('INSERT INTO issues VALUES(?,?,?)').run(1,'Actual issue','open');
    let store=new PlanningStore(storage(db));
    const act=(input:Record<string,unknown>,owner=true)=>store.mutate(planningMutationSchema.parse({...input,expectedVersion:store.snapshot().version}),owner);
    expect(store.snapshot()).toMatchObject({version:0,issues:[{number:1,title:'Actual issue'}]});
    expect(()=>act({operation:'addItem',issueNumber:99})).toThrow('not accessible');
    expect(()=>act({operation:'configure',statuses:['Todo','Done'],fieldTypes:{priority:'number'}},false)).toThrow('owner');
    act({operation:'configure',statuses:['Todo','Done'],fieldTypes:{priority:'number'}});
    act({operation:'addItem',issueNumber:1},false);
    act({operation:'setAutomation',rules:[{when:{toStatus:'Done'},then:{setField:'priority',value:10}}]});
    act({operation:'updateItem',issueNumber:1,expectedItemVersion:1,status:'Done'},false);
    expect(store.snapshot().plan.project.items[0]).toMatchObject({version:2,status:'Done',fields:{priority:10}});
    const before=store.snapshot();expect(()=>store.mutate({operation:'addItem',issueNumber:1,expectedVersion:0},true)).toThrow('plan changed');
    expect(()=>act({operation:'bulkStatus',issueNumbers:[1,99],status:'Todo',expectedVersions:[2,1]})).toThrow();expect(store.snapshot()).toEqual(before);
    act({operation:'createIteration',iteration:{id:'sprint',title:'Sprint',start:'2026-10-01',end:'2026-10-08'}});
    act({operation:'assignIteration',issueNumber:1,iterationId:'sprint'});
    act({operation:'saveView',view:{name:'Sprint',layout:'timeline',filter:{iteration:'sprint'},sortBy:'priority',direction:'desc'}});
    expect(validatePlanningArchive({version:store.snapshot().version,plan:store.snapshot().plan,views:store.snapshot().views},[1])).toMatchObject({plan:{project:{items:[{issueNumber:1}]}}});
    expect(()=>validatePlanningArchive({version:store.snapshot().version,plan:store.snapshot().plan,views:store.snapshot().views},[])).toThrow('invalid issue');
    const saved=store.snapshot();db.close();db=new Database(path);store=new PlanningStore(storage(db));expect(store.snapshot()).toEqual(saved);
    expect(store.export()).toMatchObject({items:[{issueNumber:1,status:'Done',fields:{priority:10}}],assignments:[{issueNumber:1,iterationId:'sprint'}]});
    expect(()=>act({operation:'configure',statuses:['Todo'],fieldTypes:{priority:'number'}})).toThrow('still used');
    db.query('UPDATE issues SET title=? WHERE number=1').run('Renamed live issue');expect(store.snapshot().issues[0]?.title).toBe('Renamed live issue');
  }finally{db.close();await Bun.file(path).delete();}
});

test('accepted planning freezes owner status and rules, applies once, and does not activate ignored history',()=>{
 const db=new Database(':memory:');try{
  db.exec('CREATE TABLE issues(number INTEGER PRIMARY KEY,title TEXT,state TEXT)');db.query('INSERT INTO issues VALUES(?,?,?)').run(1,'Issue','open');const store=new PlanningStore(storage(db)),act=(input:Record<string,unknown>,owner=true)=>store.mutate(planningMutationSchema.parse({...input,expectedVersion:store.snapshot().version}),owner);
  expect(store.recordAccepted('journal-old',1,'a'.repeat(40)).phase).toBe('ignored');
  act({operation:'configure',statuses:['Todo','Done'],fieldTypes:{priority:'number'}});act({operation:'addItem',issueNumber:1});act({operation:'setAutomation',rules:[{when:{toStatus:'Done'},then:{setField:'priority',value:10}}]});
  expect(()=>act({operation:'setAcceptedStatus',acceptedIssueStatus:'Done'},false)).toThrow('owner');act({operation:'setAcceptedStatus',acceptedIssueStatus:'Done'});
  expect(store.recordAccepted('journal-old',1,'a'.repeat(40)).phase).toBe('ignored');expect(store.snapshot().plan.project.items[0]!.status).toBe('Todo');
  const receipt=store.recordAccepted('journal-new',1,'b'.repeat(40)),saved=store.snapshot();expect(receipt.phase).toBe('applied');expect(saved.plan.project.items[0]).toMatchObject({status:'Done',fields:{priority:10},version:2});expect(store.recordAccepted('journal-new',1,'b'.repeat(40))).toEqual(receipt);expect(store.snapshot()).toEqual(saved);expect(()=>store.recordAccepted('journal-new',1,'c'.repeat(40))).toThrow('cannot change');
  expect(validatePlanningArchive({version:saved.version,plan:saved.plan,views:saved.views,acceptedIssueStatus:saved.acceptedIssueStatus},[1]).acceptedIssueStatus).toBe('Done');
  expect(()=>act({operation:'configure',statuses:['Todo'],fieldTypes:{priority:'number'}})).toThrow('accepted issue status');
 }finally{db.close();}
});
test('blocked accepted planning retry requires owner and current versions while preserving frozen policy',()=>{
 const db=new Database(':memory:');try{
  db.exec('CREATE TABLE issues(number INTEGER PRIMARY KEY,title TEXT,state TEXT)');db.query('INSERT INTO issues VALUES(?,?,?)').run(1,'Issue','open');const store=new PlanningStore(storage(db)),act=(input:Record<string,unknown>,owner=true)=>store.mutate(planningMutationSchema.parse({...input,expectedVersion:store.snapshot().version}),owner);
  act({operation:'configure',statuses:['Todo','Done'],fieldTypes:{priority:'number'}});act({operation:'setAutomation',rules:[{when:{toStatus:'Done'},then:{setField:'priority',value:10}}]});act({operation:'setAcceptedStatus',acceptedIssueStatus:'Done'});
  expect(store.recordAccepted('journal-blocked',1,'a'.repeat(40)).phase).toBe('blocked');act({operation:'setAcceptedStatus',acceptedIssueStatus:null});act({operation:'setAutomation',rules:[]});act({operation:'addItem',issueNumber:1});
  expect(()=>act({operation:'retryAccepted',journalId:'journal-blocked',issueNumber:1,expectedItemVersion:1},false)).toThrow('owner');expect(()=>act({operation:'retryAccepted',journalId:'journal-blocked',issueNumber:1,expectedItemVersion:2})).toThrow('item changed');
  act({operation:'retryAccepted',journalId:'journal-blocked',issueNumber:1,expectedItemVersion:1});expect(store.snapshot().plan.project.items[0]).toMatchObject({status:'Done',fields:{priority:10}});expect(store.snapshot().plan.rules).toEqual([]);expect(store.snapshot().acceptedFollowups[0]!.phase).toBe('applied');const saved=store.snapshot();act({operation:'retryAccepted',journalId:'journal-blocked',issueNumber:1,expectedItemVersion:2});expect(store.snapshot()).toEqual(saved);
 }finally{db.close();}
});
