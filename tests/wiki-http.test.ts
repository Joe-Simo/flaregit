import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('wiki HTTP persists append-only revisions, conflict checks, bounded history, diffs and archive authorization', async () => {
  if (await workerdChild('tests/wiki-http.test.ts')) return;
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

    const page='/api/p/p123456789abc/wiki/home';
    expect((await call(null,page)).status).not.toBe(200);
    expect((await call(member,page)).status).toBe(404);
    const first=await call(member,page,'PUT',{body:'one\ntwo',expectedRevision:null});
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({id:1,author:'member',parentRevision:null});
    expect((await call(owner,page,'PUT',{body:'spoof',expectedRevision:1,author:'other'})).status).toBe(400);
    expect((await call(owner,page,'PUT',{body:'stale',expectedRevision:null})).status).toBe(409);
    expect((await call(owner,page,'PUT',{body:'one\nthree',expectedRevision:1})).status).toBe(200);
    expect(await (await call(member,page+'?revision=1')).json()).toMatchObject({id:1,body:'one\ntwo'});
    expect(await (await call(member,page+'/diff?from=1&to=2')).json()).toEqual({added:['three'],removed:['two'],unchanged:['one']});
    expect(await (await call(member,page+'/history?limit=1')).json()).toMatchObject({revisions:[{id:2}],nextBefore:2});
    expect(await (await call(member,page+'/history?limit=1&before=2')).json()).toMatchObject({revisions:[{id:1}],nextBefore:null});
    expect((await call(member,page+'/revert','POST',{toRevision:1,expectedRevision:1})).status).toBe(409);
    expect(await (await call(member,page+'/revert','POST',{toRevision:1,expectedRevision:2})).json()).toMatchObject({id:3,body:'one\ntwo',parentRevision:2});
    expect((await call(owner,life,'POST',{action:'archive'})).status).toBe(200);
    expect((await call(owner,page,'PUT',{body:'blocked',expectedRevision:3})).status).toBe(409);
    expect((await call(owner,page+'/revert','POST',{toRevision:2,expectedRevision:3})).status).toBe(409);
    expect(await (await call(member,page)).json()).toMatchObject({id:3,body:'one\ntwo'});
    expect((await call(owner,life,'POST',{action:'unarchive'})).status).toBe(200);
    expect((await call(owner,page,'PUT',{body:'restored',expectedRevision:3})).status).toBe(200);
    expect(await (await call(member,'/api/p/p123456789abc/wiki')).json()).toMatchObject({pages:[{slug:'home',id:4}]});
    const history=await (await call(member,page+'/history')).json() as {revisions:Array<Record<string,unknown>>};
    expect(history.revisions.every(value=>!('body' in value))).toBe(true);
    expect((await call(owner,page+'?revision=0')).status).toBe(400);
    expect((await call(owner,page+'/history?limit=201')).status).toBe(400);
    expect((await call(owner,page+'/diff?from=1')).status).toBe(400);
    expect((await call(owner,page+'/history?limit=1&limit=2')).status).toBe(400);
  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
