import {RepositoryDiscussions} from '../src/server/repository-discussions';
import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {MetadataArchives} from '../src/server/metadata-archive';
import {METADATA_ARCHIVE_TABLES} from '../src/core/metadata-archive';
import {checkedEnvelope} from '../src/web/metadata-archive-envelope';

test('browser archive reader accepts every table in a real durable-store export and rejects unrecognized tables',async()=>{
  const db=new Database(':memory:');
  const storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=query.split(';').filter(part=>part.trim()).length>1?(db.exec(query),[]):db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};
  try{
    for(const table of METADATA_ARCHIVE_TABLES)db.exec(`CREATE TABLE "${table}"(id INTEGER PRIMARY KEY)`);
    const archives=new MetadataArchives(storage as unknown as DurableObjectStorage);
    const exported=await archives.export({projectId:'actual-export',incarnation:'test-incarnation',head:'a'.repeat(40)});
    expect(exported.archive.tables).toHaveLength(13);
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
  }finally{db.close();}
});
