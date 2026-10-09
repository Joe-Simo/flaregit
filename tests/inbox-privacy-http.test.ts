import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('inbox HTTP hides private stored titles and counts immediately after membership revocation', async () => {
  if (await workerdChild('tests/inbox-privacy-http.test.ts')) return;
  const pair = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(pair.publicKey), kid: 'lifecycle-local', alg: 'RS256', use: 'sig'};
  const issuer = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => Response.json({keys: [jwk]})});
  const file = `/tmp/repository-lifecycle-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, 'build', 'tests/support/inbox-privacy-http-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', '--outfile=' + file], {stdout: 'ignore', stderr: 'pipe'});
  if (await build.exited) throw Error(await new Response(build.stderr).text());
  const script = await Bun.file(file).text();
  await Bun.file(file).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{
    name: 'lifecycle', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'],
    bindings: {FIXTURE_ISSUER: issuer.url.origin},
    durableObjects: {REPOSITORY_CONTROLLER: {className: 'InboxPrivacyFixture', useSQLite: true}},
  }]}));
  try {
    const worker = await mf.getWorker('lifecycle');
    const sign = (subject: string) => new SignJWT({azp: 'https://fixture.example'}).setProtectedHeader({alg: 'RS256', kid: jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const member = await sign('member');
    const call = (token: string | null, path: string, method = 'GET', value?: unknown) => worker.fetch('http://fixture' + path, {
      method,
      headers: {'CF-Connecting-IP': '198.51.100.99', ...(token ? {Authorization: 'Bearer ' + token} : {}), 'content-type': 'application/json'},
      ...(value === undefined ? {} : {body: JSON.stringify(value)}),
    });

    const seed=await worker.fetch('http://fixture/fixture/seed');expect(seed.status).toBe(200);const {readToken}=await seed.json() as {readToken:string};

    const before=await call(member,'/api/inbox');
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({items:[{title:'Private issue title'}],unread:{direct:1,activity:0}});
    const preferencePath='/api/inbox/preferences/p123456789abc';
    expect((await call(readToken,preferencePath)).status).toBe(403);
    expect((await call(readToken,preferencePath,'POST',{mode:'muted',expectedVersion:0})).status).toBe(403);
    expect(await (await call(member,preferencePath)).json()).toEqual({projectId:'p123456789abc',mode:'watching',version:0});
    expect((await call(member,preferencePath,'POST',{mode:'muted',expectedVersion:0})).status).toBe(200);
    await worker.fetch('http://fixture/fixture/deliver');
    expect(await (await call(member,'/api/inbox')).json()).toMatchObject({items:[{title:'Private issue title'}],unread:{direct:1,activity:0}});
    expect((await call(member,preferencePath,'POST',{mode:'watching',expectedVersion:0})).status).toBe(409);
    expect((await call(member,preferencePath,'POST',{mode:'unsubscribed',expectedVersion:1})).status).toBe(200);
    await worker.fetch('http://fixture/fixture/deliver');
    expect(await (await call(member,'/api/inbox')).json()).toMatchObject({unread:{direct:2,activity:0}});
    expect((await worker.fetch('http://fixture/fixture/revoke')).status).toBe(200);
    expect((await call(member,preferencePath)).status).toBe(403);
    expect((await call(member,preferencePath,'POST',{mode:'watching',expectedVersion:2})).status).toBe(403);
    for(const filter of ['direct','activity','archived','snoozed']){
      const after=await call(member,'/api/inbox?filter='+filter);
      expect(after.status).toBe(200);
      expect(await after.json()).toEqual({items:[],unread:{direct:0,activity:0}});
    }
  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
