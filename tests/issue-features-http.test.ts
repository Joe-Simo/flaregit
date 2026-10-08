import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('issue planning HTTP enforces member privacy, owner milestone/template authority, atomic bulk and cycle rejection', async () => {
  if (await workerdChild('tests/issue-features-http.test.ts')) return;
  const pair = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(pair.publicKey), kid: 'lifecycle-local', alg: 'RS256', use: 'sig'};
  const issuer = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => Response.json({keys: [jwk]})});
  const file = `/tmp/repository-lifecycle-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, 'build', 'tests/support/repository-lifecycle-http-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', '--outfile=' + file], {stdout: 'ignore', stderr: 'pipe'});
  if (await build.exited) throw Error(await new Response(build.stderr).text());
  const script = await Bun.file(file).text();
  await Bun.file(file).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{
    name: 'lifecycle', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'],
    bindings: {FIXTURE_ISSUER: issuer.url.origin},
    durableObjects: {REPOSITORY_CONTROLLER: {className: 'RepositoryLifecycleFixture', useSQLite: true}},
  }]}));
  try {
    const worker = await mf.getWorker('lifecycle');
    const sign = (subject: string) => new SignJWT({azp: 'https://fixture.example'}).setProtectedHeader({alg: 'RS256', kid: jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const owner = await sign('owner');
    const member = await sign('member');
    const life = '/api/p/p123456789abc/lifecycle';
    const call = (token: string | null, path: string, method = 'GET', value?: unknown) => worker.fetch('http://fixture' + path, {
      method,
      headers: {'CF-Connecting-IP': '198.51.100.99', ...(token ? {Authorization: 'Bearer ' + token} : {}), 'content-type': 'application/json'},
      ...(value === undefined ? {} : {body: JSON.stringify(value)}),
    });

    expect((await worker.fetch('http://fixture/fixture/seed')).status).toBe(200);

    const features='/api/p/p123456789abc/issue-features';
    const outsider=await sign('outsider');
    expect((await call(outsider,features)).status).toBe(404);
    expect((await call(null,features)).status).not.toBe(200);
    for(const title of ['First issue','Second issue'])expect((await call(member,'/api/p/p123456789abc/issues','POST',{title,body:'private description',idempotencyKey:crypto.randomUUID()})).status).toBe(201);
    const mint=async(scope:'read'|'write'|'full')=>{const response=await call(owner,'/api/tokens','POST',{label:'Synthetic issue scope',scope,repo:'p123456789abc'});expect(response.status).toBe(201);return (await response.json() as {token:string}).token;};
    const readToken=await mint('read'),writeToken=await mint('write');
    expect((await call(readToken,features,'PATCH',{expectedRevision:0,action:{kind:'bulk-label',numbers:[1],label:'blocked'}})).status).toBe(403);
    expect((await call(writeToken,features,'PATCH',{expectedRevision:0,action:{kind:'milestone-create',title:'Unauthorized'}})).status).toBe(403);
    expect((await call(writeToken,features,'PATCH',{expectedRevision:0,action:{kind:'templates',templates:[]}})).status).toBe(403);
    expect(await (await call(writeToken,features)).json()).toMatchObject({canManage:false});
    let revision=0;
    const update=async(action:unknown,token=member)=>{const response=await call(token,features,'PATCH',{expectedRevision:revision,action});if(response.ok)revision=(await response.clone().json() as {revision:number}).revision;return response;};
    expect((await update({kind:'bulk-label',numbers:[1,2],label:'priority'})).status).toBe(200);
    expect((await update({kind:'bulk-assign',numbers:[1,2],assignee:'outsider'})).status).toBe(400);
    expect((await update({kind:'bulk-assign',numbers:[1,2],assignee:'member'})).status).toBe(200);
    expect((await update({kind:'bulk-label',numbers:[1,99],label:'partial'})).status).toBe(400);
    expect((await call(owner,features,'PATCH',{expectedRevision:0,action:{kind:'bulk-label',numbers:[1],label:'stale'}})).status).toBe(409);
    expect((await update({kind:'milestone-create',title:'Release'})).status).toBe(403);
    expect((await update({kind:'milestone-create',title:'Release',dueDate:'2026-02-30'},owner)).status).toBe(400);
    expect((await update({kind:'milestone-create',title:'Release'},owner)).status).toBe(200);
    expect((await update({kind:'milestone-assign',number:1,milestone:1},owner)).status).toBe(200);
    expect((await update({kind:'milestone-delete',id:1},owner)).status).toBe(400);
    expect((await update({kind:'milestone-create',title:'Next'},owner)).status).toBe(200);
    expect((await update({kind:'milestone-delete',id:1,reassignTo:2},owner)).status).toBe(200);
    expect((await update({kind:'relation-add',relation:'sub-issue-of',from:1,to:2})).status).toBe(200);
    expect((await update({kind:'relation-add',relation:'sub-issue-of',from:2,to:1})).status).toBe(400);
    expect((await update({kind:'templates',templates:[{name:'Bug',fields:[{id:'Steps',type:'text',required:true},{id:'Confirmed',type:'checkbox',required:true}]}]},owner)).status).toBe(200);
    const preview='/api/p/p123456789abc/issue-template-preview';
    expect((await call(member,preview,'POST',{name:'Bug',values:{Confirmed:true}})).status).toBe(400);
    const rendered=await call(member,preview,'POST',{name:'Bug',values:{Steps:'Reproduce',Confirmed:true}});
    expect(await rendered.json()).toMatchObject({ok:true,body:'## Steps\nReproduce\n\n## Confirmed\ntrue'});
    const templateKey=crypto.randomUUID(),templateInput={title:'Bug report',name:'Bug',values:{Steps:'Reproduce',Confirmed:true},idempotencyKey:templateKey,expectedRevision:revision};
    const createTemplate='/api/p/p123456789abc/issues/from-template';
    expect((await call(member,createTemplate,'POST',{...templateInput,values:{Confirmed:true}})).status).toBe(409);
    const createdTemplate=await call(member,createTemplate,'POST',templateInput);expect(createdTemplate.status).toBe(201);expect(await createdTemplate.json()).toMatchObject({number:3,body:'## Steps\nReproduce\n\n## Confirmed\ntrue'});
    expect((await update({kind:'templates',templates:[]},owner)).status).toBe(200);
    const replay=await call(member,createTemplate,'POST',templateInput);expect(replay.status).toBe(201);expect(await replay.json()).toMatchObject({number:3});
    expect((await call(member,createTemplate,'POST',{...templateInput,title:'Changed'})).status).toBe(409);
    const current=await (await call(member,features)).json() as {triage:Record<string,{labels:string[];assignees:string[];milestone?:number}>;progress:unknown[]};
    expect(current.triage['1']).toMatchObject({labels:['priority'],assignees:['member'],milestone:2});
    expect(current.progress).toEqual([{id:2,open:1,closed:0}]);
    const savedViews='/api/p/p123456789abc/issue-filters',query='/api/p/p123456789abc/issues/query';
    const personal=await (await call(member,savedViews)).json() as {scope:string;filters:unknown[]};
    expect(personal.filters).toEqual([]);expect(personal.scope).toMatch(/^[a-f0-9]{64}$/);
    const viewId=crypto.randomUUID(),save={action:'save',id:viewId,expectedScope:personal.scope,expectedVersion:0,name:'Private member triage',filter:{state:'open',q:'private description',label:'priority',milestone:2,sort:'number-asc'}};
    expect((await call(member,savedViews,'POST',save)).status).toBe(200);
    expect(await (await call(member,savedViews,'POST',save)).json()).toMatchObject({id:viewId,version:1});
    expect(await (await call(owner,savedViews)).json()).toMatchObject({filters:[]});
    expect((await call(owner,savedViews,'POST',save)).status).toBe(409);
    const filtered=await call(member,query+'?state=open&q=private%20description&label=priority&milestone=2&sort=number-asc');
    expect(filtered.status).toBe(200);const selected=await filtered.json() as {issues:Array<{number:number}>;total:number;complete:boolean};expect(selected.issues.map(issue=>issue.number)).toEqual([1]);expect(selected.total).toBe(1);expect(selected.complete).toBe(true);expect(selected).not.toHaveProperty('sourceFingerprint');
    expect((await call(member,query+'?q=a&q=b')).status).toBe(400);expect((await call(member,query+'?sort=unsupported')).status).toBe(400);
    const hidden=await call(outsider,savedViews);expect(hidden.status).toBe(404);expect(await hidden.text()).not.toContain(save.name);
    const deleted={action:'delete',id:viewId,expectedScope:personal.scope,expectedVersion:1};expect((await call(member,savedViews,'POST',deleted)).status).toBe(200);expect((await call(member,savedViews,'POST',deleted)).status).toBe(200);expect((await call(member,savedViews,'POST',save)).status).toBe(410);
    expect((await call(member,savedViews,'POST',{...save,id:crypto.randomUUID()})).status).toBe(200);
    expect((await call(owner,life,'POST',{action:'archive'})).status).toBe(200);
    expect((await update({kind:'bulk-label',numbers:[1],label:'blocked'})).status).toBe(409);
    expect((await call(member,features)).status).toBe(200);
    await worker.fetch('http://fixture/fixture/revoke-member');
    const revokedViews=await call(member,savedViews);expect([403,404]).toContain(revokedViews.status);expect(await revokedViews.text()).not.toContain(save.name);
    const revokedWrite=await call(member,savedViews,'POST',save);expect([403,404]).toContain(revokedWrite.status);expect(await revokedWrite.text()).not.toContain(save.name);

  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
