import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('organization HTTP grants teams access without direct ownership and revokes before success', async () => {
  if (await workerdChild('tests/organization-http.test.ts')) return;
  const pair = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(pair.publicKey), kid: 'lifecycle-local', alg: 'RS256', use: 'sig'};
  const issuer = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => Response.json({keys: [jwk]})});
  const file = `/tmp/repository-lifecycle-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, 'build', 'tests/support/organization-http-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', '--outfile=' + file], {stdout: 'ignore', stderr: 'pipe'});
  if (await build.exited) throw Error(await new Response(build.stderr).text());
  const script = await Bun.file(file).text();
  await Bun.file(file).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{
    name: 'lifecycle', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'],
    bindings: {FIXTURE_ISSUER: issuer.url.origin},
    durableObjects: {REPOSITORY_CONTROLLER: {className: 'OrganizationFixture', useSQLite: true}},
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

    const outsider=await sign('outsider');
    const created=await call(owner,'/api/organizations','POST',{name:'Engineering'});expect(created.status).toBe(201);
    let organization=await created.json() as {id:string;revision:number;teams:Array<{id:string}>;invitations:Array<{id:string}>};
    const mutation=async(token:string,path:string,method:string,value:Record<string,unknown>={})=>{const reply=await call(token,'/api/organizations/'+organization.id+path,method,{...value,expectedRevision:organization.revision});expect(reply.status).toBe(200);organization=await reply.json() as typeof organization;};
    await mutation(owner,'/invitations','POST',{userId:'outsider',role:'member'});
    expect((await call(member,'/api/organizations/'+organization.id)).status).toBe(409);
    expect((await call(member,'/api/organizations/'+organization.id+'/invitations/'+organization.invitations[0]!.id+'/accept','POST',{expectedRevision:organization.revision})).status).toBe(409);
    await mutation(outsider,'/invitations/'+organization.invitations[0]!.id+'/accept','POST');
    await mutation(owner,'/teams','POST',{teamId:'engineering',name:'Engineering'});
    await mutation(owner,'/teams/engineering/members/outsider','PUT',{present:true});
    await mutation(owner,'/grants','PUT',{repositoryId:'p123456789abc',subject:{kind:'team',id:'engineering'},role:'read'});
    const page='/api/p/p123456789abc/wiki/home';
    expect((await call(outsider,'/api/p/p123456789abc/wiki')).status).toBe(200);
    expect((await call(outsider,page,'PUT',{body:'Read cannot write',expectedRevision:null})).status).toBe(403);
    await mutation(owner,'/grants','PUT',{repositoryId:'p123456789abc',subject:{kind:'team',id:'engineering'},role:'write'});
    expect((await call(outsider,page,'PUT',{body:'Team contribution',expectedRevision:null})).status).toBe(200);
    expect(await(await call(outsider,page)).json()).toMatchObject({body:'Team contribution',author:'outsider'});
    expect((await call(outsider,life,'POST',{action:'archive'})).status).toBe(403);
    await worker.fetch('http://fixture/fixture/synchronization?fail=true');
    const uncertain=await call(owner,'/api/organizations/'+organization.id+'/teams/engineering/members/outsider','PUT',{present:false,expectedRevision:organization.revision});
    expect(uncertain.status).toBe(409);expect(await uncertain.text()).toContain('fanout incomplete');
    // Canonical source changed already, so a stale cached inherited grant never authorizes new reads.
    expect((await call(outsider,page)).status).toBe(404);
    organization=await(await call(owner,'/api/organizations/'+organization.id)).json() as typeof organization;
    await worker.fetch('http://fixture/fixture/synchronization?fail=false');
    await mutation(owner,'/reconcile','POST');

    expect((await call(outsider,page)).status).toBe(404);
    expect((await call(outsider,page,'PUT',{body:'Revoked',expectedRevision:1})).status).toBe(404);
    expect((await call(owner,page)).status).toBe(200);
    expect((await call(member,page,'PUT',{body:'Direct membership remains',expectedRevision:1})).status).toBe(200);
    const doc=await(await call(owner,'/api/organizations/'+organization.id)).json() as {revision:number};expect(doc.revision).toBe(organization.revision);
  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
