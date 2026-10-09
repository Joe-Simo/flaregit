import {RepositoryDiscussions} from '../src/server/repository-discussions';
import {expect,test,spyOn} from 'bun:test';
import {Database} from 'bun:sqlite';
import {MetadataArchives} from '../src/server/metadata-archive';
import {METADATA_ARCHIVE_TABLES} from '../src/core/metadata-archive';
import {checkedEnvelope} from '../src/web/metadata-archive-envelope';

test('browser archive reader accepts every table in a real durable-store export and rejects unrecognized tables',async()=>{
  const db=new Database(':memory:');
  const storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=query.split(';').filter(part=>part.trim()).length>1?(db.exec(query),[]):db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};
  try{
    for(const table of METADATA_ARCHIVE_TABLES)db.exec(table==='issues'?'CREATE TABLE issues(number INTEGER PRIMARY KEY,title TEXT,body TEXT,state TEXT,author TEXT,created_at TEXT,updated_at TEXT,closed_by TEXT)':`CREATE TABLE "${table}"(id INTEGER PRIMARY KEY)`);
    const archives=new MetadataArchives(storage as unknown as DurableObjectStorage);
    const exported=await archives.export({projectId:'actual-export',incarnation:'test-incarnation',head:'a'.repeat(40)});
    expect(exported.archive.tables).toHaveLength(METADATA_ARCHIVE_TABLES.length-1);
    const downloaded=JSON.parse(JSON.stringify(exported));
    expect(await checkedEnvelope(downloaded)).toEqual(exported);
    const unknown=structuredClone(downloaded);unknown.archive.tables[0].name='members';
    await expect(checkedEnvelope(unknown)).rejects.toThrow();
    const corrupted=structuredClone(downloaded);corrupted.archive.source.projectId='changed-source';
    await expect(checkedEnvelope(corrupted)).rejects.toThrow('checksum');
  }finally{db.close();}
});


test('archive preserves actual pinned question and answer metadata without exporting subscription authority',async()=>{
  const db=new Database(':memory:');
  const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=query.split(';').filter(part=>part.trim()).length>1?(db.exec(query),[]):db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};
  try{
    const durable=storage as unknown as DurableObjectStorage;
    const discussions=new RepositoryDiscussions(durable,false);
    const actor={userId:'owner',accountKey:'a'.repeat(12),displayName:'Owner',viaToken:false};
    const topic=discussions.create(actor,{category:'question',title:'Setup',body:'How do we build?',idempotencyKey:'question-12345',confirmed:true});
    const reply=discussions.create(actor,{body:'Run the approved build.',idempotencyKey:'reply-1234567',confirmed:true},topic.id);
    discussions.control(actor,topic.id,{expectedVersion:1,pinned:true,answerId:reply.id},true);
    const exported=await new MetadataArchives(durable).export({projectId:'discussion-export',incarnation:'fixture',head:'a'.repeat(40)});
    const envelope=await checkedEnvelope(JSON.parse(JSON.stringify(exported)));
    const entries=envelope.archive.tables.find(table=>table.name==='repository_private_discussion_entries')!.rows;
    expect(entries.some(row=>typeof row.doc==='string'&&JSON.parse(row.doc).pinned===true&&JSON.parse(row.doc).answerId===reply.id)).toBe(true);
    expect(envelope.archive.tables.some(table=>String(table.name).includes('subscription')||String(table.name).includes('outbox'))).toBe(false);
    const moderation=discussions.moderation();
    const report=moderation.report(topic.id,'reporter',{reason:'spam',note:'Private report context'});
    moderation.resolve(report.id,'first-moderator',true,{action:'hide',reason:'Reviewed report',expectedVersion:1});
    const suppressed=await new MetadataArchives(durable).export({projectId:'discussion-export',incarnation:'fixture',head:'a'.repeat(40)});
    expect(await checkedEnvelope(JSON.parse(JSON.stringify(suppressed)))).toEqual(suppressed);
    const documents=suppressed.archive.tables.find(table=>table.name==='repository_private_discussion_entries')!.rows.map(row=>JSON.parse(String(row.doc)) as {removed:boolean;body:string;title:string;moderationState:string});
    expect(documents).toHaveLength(2);expect(documents.every(doc=>doc.removed&&doc.moderationState==='hidden'&&doc.body==='')).toBe(true);
    expect(suppressed.archive.tables.find(table=>table.name==='repository_private_discussion_entries')!.rows.every(row=>row.author_id==='historical-unknown')).toBe(true);
    expect(JSON.stringify(suppressed)).not.toContain('How do we build?');expect(JSON.stringify(suppressed)).not.toContain('Run the approved build.');expect(JSON.stringify(suppressed)).not.toContain('Private report context');
    // Portable snapshots remain restricted; reversal uses the original canonical
    // records and independent local audit, never the redacted export.
    moderation.appeal(report.id,actor.userId,{reason:'Legitimate setup question'});
    moderation.decide(report.id,'second-moderator',true,{decision:'overturned',reason:'Independent review',expectedVersion:3});
    const restored=discussions.topic(topic.id)!;expect(restored.topic.body).toBe('How do we build?');expect(restored.topic.author).toBe('Owner');expect(restored.replies[0]?.body).toBe('Run the approved build.');

  }finally{db.close();}
});


test('discussion suppression during archive hashing refuses stale bodies in both namespaces',async()=>{
 for(const publicOnly of [false,true]){
  const db=new Database(':memory:');
  const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=query.split(';').filter(part=>part.trim()).length>1?(db.exec(query),[]):db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};
  const durable=storage as unknown as DurableObjectStorage,discussions=new RepositoryDiscussions(durable,publicOnly),archives=new MetadataArchives(durable),actor={userId:'native-sensitive-author',accountKey:'a'.repeat(12),displayName:'Native Author'};
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const pause=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;}),originalDigest=crypto.subtle.digest.bind(crypto.subtle);
  const hash=spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,data)=>{entered();await pause;return originalDigest(algorithm,data);});
  try{
   const topic=discussions.create(actor,{category:'question',title:'Sensitive original topic',body:'Sensitive original body',idempotencyKey:'archive-race-topic',confirmed:true});
   discussions.create(actor,{body:'Sensitive descendant body',idempotencyKey:'archive-race-reply',confirmed:true},topic.id);
   const moderation=discussions.moderation(),report=moderation.report(topic.id,'reporter',{reason:'spam',note:'Private report note'});
   const outcome=archives.export({projectId:'discussion-race',incarnation:'fixture',head:'a'.repeat(40)}).then(()=>({released:true as const}),error=>({released:false as const,error}));
   await started;
   moderation.resolve(report.id,'moderator',true,{action:'hide',reason:'Reviewed while hashing',expectedVersion:1});
   release();
   const result=await outcome;expect(result.released).toBe(false);if(!result.released)expect(String(result.error)).toContain('Discussion visibility changed');
   hash.mockRestore();
   const current=await archives.export({projectId:'discussion-race',incarnation:'fixture',head:'a'.repeat(40)}),serialized=JSON.stringify(current);
   expect(serialized).not.toContain('Sensitive original body');expect(serialized).not.toContain('Sensitive descendant body');expect(serialized).not.toContain('native-sensitive-author');
   const rows=current.archive.tables.find(table=>table.name===`repository_${publicOnly?'public':'private'}_discussion_entries`)!.rows;
   expect(rows.every(row=>row.author_id==='historical-unknown'&&JSON.parse(String(row.doc)).removed===true)).toBe(true);
  }finally{release();hash.mockRestore();db.close();}
 }
});

test('archive history refuses an oversized canonical inventory instead of silently truncating it',()=>{
 const db=new Database(':memory:');
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=query.split(';').filter(part=>part.trim()).length>1?(db.exec(query),[]):db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};
 try{
  const archives=new MetadataArchives(storage as unknown as DurableObjectStorage),insert=db.query('INSERT INTO metadata_archive_history VALUES(?,?,?)');
  db.transaction(()=>{for(let index=0;index<10001;index++)insert.run('fixture',String(index),'{}');})();
  expect(()=>archives.history()).toThrow('bounded capacity');
  expect(()=>archives.releaseSnapshot()).toThrow('bounded capacity');
 }finally{db.close();}
});
