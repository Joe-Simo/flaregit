import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('planning HTTP links real issues with persisted views, iterations, automation, export and archive guards', async () => {
  if (await workerdChild('tests/planning-http.test.ts')) return;
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

    const planning='/api/p/p123456789abc/planning';
    expect((await call(null,planning)).status).not.toBe(200);
    expect(await (await call(member,planning)).json()).toMatchObject({version:0,plan:{project:{items:[]}}});
    const create=await call(member,'/api/p/p123456789abc/issues','POST',{title:'Real planning issue',body:'Actual record'});
    expect(create.status).toBe(201);
    const created=await create.json() as {number:number};
    const issueNumber=created.number;
    const mutate=(token:string,value:Record<string,unknown>)=>call(token,planning,'POST',value);
    expect((await mutate(member,{operation:'configure',expectedVersion:0,statuses:['Todo','Done'],fieldTypes:{priority:'number'}})).status).toBe(403);
    expect((await mutate(owner,{operation:'configure',expectedVersion:0,statuses:['Todo','Done'],fieldTypes:{priority:'number'}})).status).toBe(200);
    expect((await mutate(member,{operation:'addItem',expectedVersion:1,issueNumber:999})).status).toBe(400);
    expect((await mutate(member,{operation:'addItem',expectedVersion:1,issueNumber})).status).toBe(200);
    expect((await mutate(owner,{operation:'setAutomation',expectedVersion:2,rules:[{when:{toStatus:'Done'},then:{setField:'priority',value:10}}]})).status).toBe(200);
    expect((await mutate(member,{operation:'updateItem',expectedVersion:3,issueNumber,expectedItemVersion:1,status:'Done'})).status).toBe(200);
    expect((await mutate(member,{operation:'updateItem',expectedVersion:3,issueNumber,expectedItemVersion:1,status:'Todo'})).status).toBe(409);
    expect((await mutate(member,{operation:'createIteration',expectedVersion:4,iteration:{id:'sprint',title:'Sprint',start:'2026-10-01',end:'2026-10-08'}})).status).toBe(200);
    expect((await mutate(member,{operation:'assignIteration',expectedVersion:5,issueNumber,iterationId:'sprint'})).status).toBe(200);
    expect((await mutate(member,{operation:'saveView',expectedVersion:6,view:{name:'Sprint',layout:'timeline',filter:{iteration:'sprint'},sortBy:'priority',direction:'desc'}})).status).toBe(200);
    const saved=await (await call(member,planning)).json();
    expect(saved).toMatchObject({version:7,plan:{project:{items:[{issueNumber,status:'Done',fields:{priority:10},version:2}]},assignments:[{issueNumber,iterationId:'sprint'}]},issues:[{number:issueNumber,title:'Real planning issue'}],progress:{Todo:0,Done:1}});
    expect(await (await call(member,planning+'/export')).json()).toMatchObject({items:[{issueNumber,status:'Done',fields:{priority:10}}]});
    expect((await call(owner,life,'POST',{action:'archive'})).status).toBe(200);
    expect((await mutate(member,{operation:'bulkStatus',expectedVersion:7,issueNumbers:[issueNumber],expectedVersions:[2],status:'Todo'})).status).toBe(409);
    expect(await (await call(member,planning)).json()).toEqual(saved);
    expect((await call(owner,life,'POST',{action:'unarchive'})).status).toBe(200);
    expect((await mutate(member,{operation:'bulkStatus',expectedVersion:7,issueNumbers:[issueNumber],expectedVersions:[2],status:'Todo'})).status).toBe(200);
    expect((await mutate(member,{operation:'addItem',expectedVersion:8,issueNumber,author:'spoof'})).status).toBe(400);
  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
