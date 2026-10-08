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
