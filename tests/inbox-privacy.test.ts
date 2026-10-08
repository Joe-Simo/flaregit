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
