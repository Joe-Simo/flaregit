import {Database} from 'bun:sqlite';
import {test,expect} from 'bun:test';
import {DurableWikiStore} from '../src/server/wiki-store';

function storage(db:Database){return {sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(fn:()=>T){return db.transaction(fn)();}} as unknown as DurableObjectStorage;}

test('wiki survives database reopen and refuses stale saves and reverts without changing history',async()=>{
  const path=`/tmp/wiki-${crypto.randomUUID()}.sqlite`;
  let db=new Database(path);
  try{
    let wiki=new DurableWikiStore(storage(db));
    expect(wiki.save('Home',{author:'actor',body:'first',expectedRevision:null})).toMatchObject({ok:true,value:{id:1}});
    expect(wiki.save('home',{author:'actor',body:'second',expectedRevision:1})).toMatchObject({ok:true,value:{id:2}});
    db.close();db=new Database(path);wiki=new DurableWikiStore(storage(db));
    expect(wiki.read('home')).toMatchObject({ok:true,value:{id:2,body:'second'}});
    expect(wiki.revert('home',1,'actor',1)).toMatchObject({ok:false,code:'conflict'});
    expect(wiki.revert('home',1,'actor',2)).toMatchObject({ok:true,value:{id:3,body:'first',parentRevision:2}});
    expect(wiki.history('home',{limit:2})).toMatchObject({ok:true,value:{revisions:[{id:3},{id:2}],nextBefore:2}});
    expect(wiki.read('home',2)).toMatchObject({ok:true,value:{body:'second'}});
    db.query('INSERT INTO wiki_revisions VALUES(?,?,?,?,?,?)').run('capacity',1,'actor','x'.repeat(5_000_000),new Date().toISOString(),null);
    expect(wiki.save('home',{author:'actor',body:'blocked',expectedRevision:3})).toMatchObject({ok:false,code:'capacity'});
    expect(wiki.read('home')).toMatchObject({ok:true,value:{id:3,body:'first'}});
    const history=wiki.history('home');expect(history.ok&&'body' in history.value.revisions[0]!).toBe(false);
    expect(wiki.read('other')).toMatchObject({ok:false,code:'not-found'});
    expect(wiki.save('../home',{author:'actor',body:'bad',expectedRevision:null})).toMatchObject({ok:false,code:'invalid-slug'});
  }finally{db.close();await Bun.file(path).delete();}
});
