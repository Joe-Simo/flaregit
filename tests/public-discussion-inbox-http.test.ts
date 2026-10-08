import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
import type {DiscussionEntry} from '../src/server/repository-discussions';

test('public discussion inbox delivers to subscribed outsiders and revalidates only the exact public event',async()=>{
 if(await workerdChild('tests/public-discussion-inbox-http.test.ts'))return;
 const file=`/tmp/public-discussion-inbox-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/public-discussion-inbox-http-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 if(await build.exited)throw Error(await new Response(build.stderr).text());
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'discussion-inbox',modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'PublicDiscussionInboxFixture',useSQLite:true}}}]}));
 try{
  const worker=await mf.getWorker('discussion-inbox');
  const fixture=async(path:string)=>{const response=await worker.fetch('http://fixture/fixture/'+path);expect(response.status).toBe(200);return response;};
  const seeded=await (await fixture('bootstrap')).json() as {tokens:Record<string,string>;outsiderRole:string|null};expect(seeded.outsiderRole).toBeNull();
  const owner=seeded.tokens['discussion-owner']!,outsider=seeded.tokens['discussion-outsider']!,replier=seeded.tokens['discussion-replier']!;
  const call=(token:string,path:string,method='GET',body?:unknown)=>worker.fetch('http://fixture'+path,{method,headers:{Authorization:'Bearer '+token,'content-type':'application/json','CF-Connecting-IP':'198.51.100.99'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const publicPath='/api/public/p123456789abc/discussions';
  const create=async(key:string)=>{const response=await call(owner,publicPath,'POST',{category:'general',title:'Public discussion',body:'Public topic text',idempotencyKey:key,confirmed:true});expect(response.status).toBe(201);return await response.json() as DiscussionEntry;};
  const subscribe=async(topic:string,subscribed:boolean)=>{const response=await call(outsider,`${publicPath}/${topic}/subscription`,'POST',{subscribed});expect(response.status).toBe(200);};
  const reply=async(topic:string,key:string)=>{const response=await call(replier,`${publicPath}/${topic}/replies`,'POST',{body:'Public reply text',idempotencyKey:key,confirmed:true});expect(response.status).toBe(201);await fixture('drain');return await response.json() as DiscussionEntry;};
  type Inbox={items:Array<{id:number;title:string;project_name:string;type:string}>;unread:{direct:number;activity:number}};
  const inbox=async()=>{const response=await call(outsider,'/api/inbox?filter=activity');expect(response.status).toBe(200);return await response.json() as Inbox;};
  const empty=async()=>expect(await inbox()).toEqual({items:[],unread:{direct:0,activity:0}});

  const topic=await create('outside-notification-topic');await subscribe(topic.id,true);const entry=await reply(topic.id,'outside-notification-reply');
  await fixture('poison');
  const delivered=await inbox();expect(delivered.unread).toEqual({direct:0,activity:1});expect(delivered.items).toHaveLength(1);
  expect(delivered.items[0]).toMatchObject({title:'New reply in a subscribed discussion',project_name:'Current public repository',type:`discussion.reply.public.${topic.id}.${entry.id}`});
  expect(JSON.stringify(delivered)).not.toContain('Private');
  // Retry an event whose source acknowledgement was lost after inbox delivery.
  await fixture(`retry-event?topic=${topic.id}&entry=${entry.id}`);expect((await inbox()).unread.activity).toBe(1);

  const other=await create('wrong-topic-other-thread');const otherReply=await reply(other.id,'wrong-topic-other-reply');
  await fixture(`wrong-topic?topic=${topic.id}&entry=${otherReply.id}`);
  expect((await inbox()).unread.activity).toBe(1);expect(JSON.stringify(await inbox())).not.toContain('Wrong topic secret');

  await subscribe(topic.id,false);await empty();
  await subscribe(topic.id,true);expect((await inbox()).unread.activity).toBe(1);
  const removed=await call(replier,`${publicPath}/${entry.id}`,'DELETE',{expectedVersion:1});expect(removed.status).toBe(200);await empty();

  const second=await reply(topic.id,'scope-revocation-reply');expect((await inbox()).unread.activity).toBe(1);
  await fixture('scope?enabled=false');await empty();
  await fixture('scope?enabled=true');expect((await inbox()).unread.activity).toBe(1);
  await fixture('private');await empty();
  await fixture('scope?enabled=true');expect((await inbox()).items[0]?.type).toBe(`discussion.reply.public.${topic.id}.${second.id}`);

  // The first source RPC succeeds; visibility changes before the required second RPC.
  await fixture('race');await empty();
  await fixture('scope?enabled=true');expect((await inbox()).unread.activity).toBe(1);
  expect((await call(owner,`${publicPath}/${topic.id}`,'DELETE',{expectedVersion:1})).status).toBe(200);await empty();
  for(const filter of ['direct','activity','snoozed','archived']){const response=await call(outsider,'/api/inbox?filter='+filter);expect(response.status).toBe(200);expect(await response.json()).toEqual({items:[],unread:{direct:0,activity:0}});}
 }finally{await mf.dispose();}
},60000);
