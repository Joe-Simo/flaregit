import {expect,test} from 'bun:test';
import {projectInbox} from '../src/server/inbox-privacy';
import type {InboxRow} from '../src/server/durable-object';
const row = (id:number, project:string, state:InboxRow['state']='unread'):InboxRow => ({id,project_id:project,project_name:`Private ${project}`,kind:'direct',type:'review.requested',title:`Secret ${project}`,created_at:'2026-10-08T00:00:00Z',state});
test('inbox titles and unread counts require current confirmed repository access',async()=>{
  const rows=[row(3,'revoked'),row(2,'allowed'),row(1,'unknown')];
  const result=await projectInbox(rows,'direct',async id=>{if(id==='unknown')throw Error('authority unavailable');return id==='allowed';});
  expect(result.items.map(item=>item.project_id)).toEqual(['allowed']);
  expect(result.unread).toEqual({direct:1,activity:0});
  expect(JSON.stringify(result)).not.toContain('Secret revoked');
  expect(JSON.stringify(result)).not.toContain('Private unknown');
});
test('authorization filtering precedes paging and applies to archived and snoozed history',async()=>{
  const rows=[...Array.from({length:110},(_,i)=>row(i+10,'revoked')),row(2,'allowed'),row(1,'allowed','archived'),row(0,'allowed','snoozed')];
  expect((await projectInbox(rows,'direct',async id=>id==='allowed')).items.map(item=>item.id)).toEqual([2]);
  expect((await projectInbox(rows,'archived',async id=>id==='allowed')).items.map(item=>item.id)).toEqual([1]);
  expect((await projectInbox(rows,'snoozed',async id=>id==='allowed')).items.map(item=>item.id)).toEqual([0]);
});

test('pending repository lookups cannot preserve an earlier permission after the release check',async()=>{
  let readable=true;
  const rows=[row(2,'revoked'),row(1,'allowed')];
  const projection=await projectInbox(rows,'direct',async id=>id==='allowed'||readable,async()=>{readable=false;});
  expect(projection.items.map(item=>item.project_id)).toEqual(['allowed']);
  expect(projection.unread.direct).toBe(1);
  await expect(projectInbox(rows,'direct',async()=>true,async()=>{throw Error('Session revoked');})).rejects.toThrow('Session revoked');
});

test('public discussion authority releases only the exact event and replaces stored private prose',async()=>{
  const topic='discussion_11111111-1111-1111-1111-111111111111',entry='discussion_22222222-2222-2222-2222-222222222222';
  const publicRow={...row(3,'public'),kind:'activity' as const,type:`discussion.reply.public.${topic}.${entry}`};
  const legacy={...publicRow,id:2,type:`discussion.reply.public.${topic}`};
  const result=await projectInbox([publicRow,legacy,row(1,'public')],'activity',async()=>false,async()=>{},async item=>({...item,project_name:'Current public name',title:'New reply in a subscribed discussion'}));
  expect(result.items).toEqual([{...publicRow,project_name:'Current public name',title:'New reply in a subscribed discussion'}]);
  expect(result.unread).toEqual({direct:0,activity:1});
  expect(JSON.stringify(result)).not.toContain('Secret');
});

test('public notification projection rechecks removal and does not swallow final session revocation',async()=>{
  const source={...row(1,'public'),type:'discussion.reply.public.discussion_11111111-1111-1111-1111-111111111111.discussion_22222222-2222-2222-2222-222222222222'};
  let calls=0;
  expect((await projectInbox([source],'direct',async()=>false,async()=>{},async item=>++calls===1?item:null)).items).toEqual([]);
  let principal=0;
  await expect(projectInbox([source],'direct',async()=>false,async()=>{if(++principal>1)throw Error('Revoked');},async item=>item)).rejects.toThrow('Revoked');
});

test('later source projection withdrawal hides an earlier event at release',async()=>{
 const type='discussion.reply.public.discussion_11111111-1111-1111-1111-111111111111.discussion_22222222-2222-2222-2222-222222222222';
 const first={...row(2,'first'),type,kind:'activity' as const},second={...row(1,'second'),type,kind:'activity' as const};
 let firstAvailable=true;
 const projection=await projectInbox([first,second],'activity',async()=>false,async()=>{},async item=>{
  if(item.id===second.id)firstAvailable=false;
  if(item.id===first.id&&!firstAvailable)return null;
  return {...item,project_name:'Current public name',title:'Public reply'};
 });
 expect(projection.items.map(item=>item.id)).toEqual([second.id]);expect(projection.unread).toEqual({direct:0,activity:1});
});

test('final source release uses current sanitized prose and catches principal revocation during that lookup',async()=>{
 const source={...row(1,'public'),type:'discussion.reply.public.discussion_11111111-1111-1111-1111-111111111111.discussion_22222222-2222-2222-2222-222222222222',kind:'activity' as const};
 let calls=0;
 const projection=await projectInbox([source],'activity',async()=>false,async()=>{},async item=>({...item,project_name:++calls===3?'Current public name':'Earlier public name',title:'Public reply'}));
 expect(projection.items[0]?.project_name).toBe('Current public name');expect(JSON.stringify(projection)).not.toContain('Earlier public name');
 let authorized=true;calls=0;
 await expect(projectInbox([source],'activity',async()=>false,async()=>{if(!authorized)throw Error('Principal revoked during release');},async item=>{if(++calls===3)authorized=false;return item;})).rejects.toThrow('Principal revoked during release');
});
test('legacy unbound issue/comment prose is generic while exact issue sources are revalidated',async()=>{
 const legacy={...row(3,'allowed'),kind:'activity' as const,type:'issue.opened',title:'Deleted private title'},comment={...legacy,id:2,type:'comment.added',title:'Deleted private path.ts'},bound={...legacy,id:1,issueSource:{number:12,incarnation:'11111111-1111-4111-8111-111111111111'}};
 let active=true,calls=0;const projection=await projectInbox([legacy,comment,bound],'activity',async()=>true,async()=>{},async item=>{calls++;if(calls===2)active=false;return active?item:null;});
 expect(projection.items.map(item=>item.title)).toEqual(['Issue activity','Comment added']);expect(JSON.stringify(projection)).not.toContain('Deleted private');
});
