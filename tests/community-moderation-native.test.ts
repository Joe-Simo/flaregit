import { expect,test } from 'bun:test';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { workerdChild } from './support/workerd-child';
import type { CommunityEntry } from '../src/server/platform-community';
import type { CommunityModerationReport } from '../src/server/community-moderation';
test('canonical forum report, independent moderation, private appeal and reversal persist in SQLite',async()=>{
 if(await workerdChild('tests/community-moderation-native.test.ts'))return;
 const build=await Bun.build({entrypoints:['tests/support/platform-community-worker.ts'],target:'browser',external:['cloudflare:workers']});if(!build.success)throw Error(String(build.logs));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'forum',modules:true,script:await build.outputs[0]!.text(),compatibilityDate:'2026-10-02',durableObjects:{TEST:{className:'ForumFixture',useSQLite:true}}}]}));
 const call=async(path:string,input?:unknown)=>(await mf.getWorker('forum')).fetch(`http://fixture${path}`,input?{method:'POST',body:JSON.stringify(input)}:undefined);
 try{
  const entry=await(await call('/create',{category:'feedback',title:'Original title',body:'Original body retained for appeal',confirmed:true,idempotencyKey:'moderation-original'})).json() as CommunityEntry;
  expect((await call(`/report?id=${entry.id}`,{reason:'spam',note:'private note'})).status).toBe(409);
  const report=await(await call(`/report?id=${entry.id}&actor=reporter`,{reason:'spam',note:'private note'})).json() as {id:string};
  expect(await(await call('/inbox?actor=unrelated')).json()).toEqual([]);
  expect((await call(`/resolve?id=${report.id}&actor=reporter&moderator=true`,{action:'hide',reason:'Reviewed',expectedVersion:1})).status).toBe(409);
  expect((await call(`/resolve?id=${report.id}&actor=first`,{action:'hide',reason:'Reviewed',expectedVersion:1})).status).toBe(409);
  expect((await call(`/resolve?id=${report.id}&actor=first&moderator=true`,{action:'hide',reason:'Reviewed',expectedVersion:1})).status).toBe(200);
  expect(await(await call('/list')).text()).not.toContain('Original body');
  expect(await(await call(`/topic?id=${entry.id}`)).text()).not.toContain('Original body');
  const authorInbox=await(await call('/inbox')).text();expect(authorInbox).not.toContain('reporter');expect(authorInbox).not.toContain('private note');
  expect((await call(`/edit?id=${entry.id}`,{body:'Evade moderation',expectedVersion:2,confirmed:true})).status).toBe(409);
  expect((await call(`/appeal?id=${report.id}&actor=unrelated`,{reason:'Reconsider'})).status).toBe(409);
  expect((await call(`/appeal?id=${report.id}`,{reason:'This is legitimate feedback'})).status).toBe(200);
  expect((await call(`/decide?id=${report.id}&actor=first&moderator=true`,{decision:'overturned',reason:'Reconsidered',expectedVersion:3})).status).toBe(409);
  expect((await call(`/decide?id=${report.id}&actor=second&moderator=true`,{decision:'overturned',reason:'Legitimate feedback',expectedVersion:2})).status).toBe(409);
  expect((await call(`/decide?id=${report.id}&actor=second&moderator=true`,{decision:'overturned',reason:'Legitimate feedback',expectedVersion:3})).status).toBe(200);
  expect(await(await call(`/topic?id=${entry.id}`)).text()).toContain('Original body retained for appeal');
  const rows=await(await call('/inbox?actor=second&moderator=true')).json() as CommunityModerationReport[];expect(rows[0]?.appeal?.status).toBe('overturned');expect(rows[0]?.action).toBe('hide');
  expect((await call('/audit?actor=unrelated')).status).toBe(409);expect((await(await call('/audit?actor=second&moderator=true')).json() as unknown[]).length).toBe(2);
 }finally{await mf.dispose();}
},30000);
