import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {accountKeyFor} from '../src/server/projects';
import {workerdChild} from './support/workerd-child';

test('operational backup HTTP requires operator-owner authority and exports only encrypted bounded snapshots', async () => {
  if (await workerdChild('tests/operational-backup-http.test.ts')) return;
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
    bindings: {FIXTURE_ISSUER: issuer.url.origin, OPERATIONAL_BACKUP_KEY:'synthetic-backup-key-with-at-least-32-bytes', OPERATOR_ACCOUNTS:await accountKeyFor('owner')},
    durableObjects: {REPOSITORY_CONTROLLER: {className: 'RepositoryLifecycleFixture', useSQLite: true}},
  }]}));
  try {
    const worker = await mf.getWorker('lifecycle');
    const sign = (subject: string) => new SignJWT({azp: 'https://fixture.example'}).setProtectedHeader({alg: 'RS256', kid: jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const owner = await sign('owner');
    const member = await sign('member');
    const call = (token: string | null, path: string, method = 'GET', value?: unknown) => worker.fetch('http://fixture' + path, {
      method,
      headers: {'CF-Connecting-IP': '198.51.100.99', ...(token ? {Authorization: 'Bearer ' + token} : {}), 'content-type': 'application/json'},
      ...(value === undefined ? {} : {body: JSON.stringify(value)}),
    });

    expect((await worker.fetch('http://fixture/fixture/seed')).status).toBe(200);

    const path='/api/p/p123456789abc/operations/backups';
    expect((await call(member,path)).status).toBe(404);
    expect((await call(null,path)).status).not.toBe(200);
    const captured=await call(owner,path,'POST',{action:'capture'});
    expect(captured.status).toBe(200);
    const receipt=await captured.json() as {id:string;sha256:string};
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    const exported=await call(owner,`${path}/${receipt.id}/export`);
    expect(exported.status).toBe(200);
    const envelope=await exported.json() as {encryptedBackup:{version:number;iv:string;ciphertext:string}};
    expect(typeof envelope.encryptedBackup.ciphertext).toBe('string');
    expect(JSON.stringify(envelope)).not.toContain('Lifecycle fixture');
    expect((await call(owner,`${path}/${receipt.id}/hold`,'POST',{held:true})).status).toBe(200);
    const catalog=await (await call(owner,path)).json() as {backups:Array<{id:string;held:number}>};
    expect(catalog.backups).toContainEqual(expect.objectContaining({id:receipt.id,held:1}));
    expect((await call(owner,`${path}/${receipt.id}/delete-expired`,'POST',{action:'delete-expired'})).status).toBe(409);
    expect((await call(owner,`${path}/${receipt.id}/restore`,'POST',{action:'restore-isolated'})).status).toBe(409);
    expect((await call(owner,`${path}/${receipt.id}/export`)).status).toBe(200);
  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
