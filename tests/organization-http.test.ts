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
    await mutation(owner,'/teams','POST',{teamId:'contributors',name:'Contributors'});
    await mutation(owner,'/teams/contributors/members/outsider','PUT',{present:true});
    await mutation(owner,'/teams/engineering/children/contributors','PUT',{present:true});
    const cycle=await call(owner,'/api/organizations/'+organization.id+'/teams/contributors/children/engineering','PUT',{present:true,expectedRevision:organization.revision});expect(cycle.status).toBe(409);

    await mutation(owner,'/grants','PUT',{repositoryId:'p123456789abc',subject:{kind:'team',id:'engineering'},role:'read'});
    const issueReply=await call(owner,'/api/p/p123456789abc/issues','POST',{title:'Inherited attachment authority',body:'Synthetic attachment metadata only',idempotencyKey:crypto.randomUUID()});expect(issueReply.status).toBe(201);
    const issue=await issueReply.json() as {number:number},attachmentPath=`/api/p/p123456789abc/issues/${issue.number}/attachments`,attachment={id:crypto.randomUUID(),name:'team.txt',sha256:'a'.repeat(64),size:1};
    expect(await(await call(outsider,attachmentPath)).json()).toMatchObject({attachments:[],canUpload:false});
    expect((await call(outsider,attachmentPath,'POST',attachment)).status).toBe(403);
    const issuePath=`/api/p/p123456789abc/issues/${issue.number}`;
    expect(await(await call(outsider,issuePath)).json()).toMatchObject({canStateWrite:false,stateRevision:0});
    expect((await call(outsider,issuePath,'PATCH',{state:'closed',expectedRevision:0,requestId:crypto.randomUUID()})).status).toBe(403);
    const page='/api/p/p123456789abc/wiki/home';
    expect((await call(outsider,'/api/p/p123456789abc/wiki')).status).toBe(200);
    expect((await call(outsider,page,'PUT',{body:'Read cannot write',expectedRevision:null})).status).toBe(403);
    expect((await worker.fetch('http://fixture/fixture/contribution')).status).toBe(403);
    expect((await call(outsider,'/api/p/p123456789abc/clone','POST',{})).status).toBe(200);

    await mutation(owner,'/grants','PUT',{repositoryId:'p123456789abc',subject:{kind:'team',id:'engineering'},role:'write'});
    expect((await call(outsider,attachmentPath,'POST',attachment)).status).toBe(201);
    expect(await(await call(outsider,issuePath)).json()).toMatchObject({canStateWrite:true,stateRevision:0});
    const stateRequest={state:'closed',expectedRevision:0,requestId:crypto.randomUUID()};
    expect(await(await call(outsider,issuePath,'PATCH',stateRequest)).json()).toMatchObject({issue:{state:'closed',stateRevision:1},replayed:false});
    expect(await(await call(outsider,issuePath,'PATCH',stateRequest)).json()).toMatchObject({issue:{state:'closed',stateRevision:1},replayed:true});
    expect(await(await call(outsider,attachmentPath)).json()).toMatchObject({canUpload:true,attachments:[{id:attachment.id,phase:'pending',canRemove:true}]});
    expect((await call(outsider,`${attachmentPath}/retention`,'POST',{})).status).toBe(403);
    expect((await call(outsider,page,'PUT',{body:'Team contribution',expectedRevision:null})).status).toBe(200);
    expect(await(await call(outsider,page)).json()).toMatchObject({body:'Team contribution',author:'outsider'});
    expect((await worker.fetch('http://fixture/fixture/contribution')).status).toBe(200);
    const replay=await call(outsider,'/api/p/p123456789abc/tasks','POST',{taskId:'team-contribution',goal:'Team contribution'});expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({replayed:true,task:'team-contribution',branch:'task/team-contribution'});
    expect((await call(outsider,'/api/p/p123456789abc/tasks/team-contribution/token','POST',{})).status).toBe(200);
    const forkPermission='/api/p/p123456789abc/tasks/team-contribution/fork-permission';
    expect(await(await call(outsider,forkPermission)).json()).toMatchObject({enabled:false,revision:0,canConfigure:true,creatorId:'outsider'});
    expect((await call(owner,'/api/p/p123456789abc/tasks/team-contribution/token','POST',{})).status).toBe(403);
    expect((await call(owner,forkPermission,'PUT',{enabled:true,expectedRevision:0})).status).toBe(409);
    expect((await call(outsider,forkPermission,'PUT',{enabled:true,expectedRevision:0})).status).toBe(200);
    const maintainerTokenReply=await call(owner,'/api/p/p123456789abc/tasks/team-contribution/token','POST',{});expect(maintainerTokenReply.status).toBe(200);const maintainerToken=await maintainerTokenReply.json() as {token:string};
    const verify=async(secret:string,write:boolean)=>await(await worker.fetch('http://fixture/fixture/verify-capability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,write})})).json();
    expect(await verify(maintainerToken.token,true)).toEqual({valid:true});
    expect((await call(outsider,forkPermission,'PUT',{enabled:false,expectedRevision:1})).status).toBe(200);
    expect(await verify(maintainerToken.token,true)).toEqual({valid:false});
    expect(await verify(maintainerToken.token,false)).toEqual({valid:true});
    expect((await call(outsider,'/api/p/p123456789abc/tasks/team-contribution/token','POST',{})).status).toBe(200);
    expect((await call(outsider,forkPermission,'PUT',{enabled:true,expectedRevision:2})).status).toBe(200);
    expect(await verify(maintainerToken.token,true)).toEqual({valid:false});
    expect((await call(outsider,forkPermission,'PUT',{enabled:false,expectedRevision:3})).status).toBe(200);
    expect((await worker.fetch('http://fixture/fixture/cancel-contribution')).status).toBe(200);
    expect((await call(owner,'/api/p/p123456789abc/tasks/cancel-contribution/token','POST',{})).status).toBe(403);
    expect((await call(owner,'/api/p/p123456789abc/tasks/cancel-contribution/cancel','POST',{})).status).toBe(200);
    expect((await worker.fetch('http://fixture/fixture/handoff')).status).toBe(200);
    expect((await call(owner,'/api/p/p123456789abc/tasks/team-contribution/token','POST',{})).status).toBe(403);
    expect(await(await call(outsider,forkPermission)).json()).toMatchObject({enabled:false,canConfigure:true});
    const gateway=await(await worker.fetch('http://fixture/fixture/gateway')).json() as {id:string;scope:{organizationSource:{id:string;revision:number}}};expect(gateway.scope.organizationSource).toMatchObject({id:organization.id,revision:organization.revision});
    const members=await(await worker.fetch('http://fixture/fixture/members')).json() as Array<{user_id:string}>;expect(members.some(member=>member.user_id==='outsider')).toBe(false);

    expect((await call(outsider,life,'POST',{action:'archive'})).status).toBe(403);
    await worker.fetch('http://fixture/fixture/synchronization?fail=true');
    const uncertain=await call(owner,'/api/organizations/'+organization.id+'/teams/engineering/children/contributors','PUT',{present:false,expectedRevision:organization.revision});
    expect(uncertain.status).toBe(409);expect(await uncertain.text()).toContain('fanout incomplete');
    // Canonical source changed already, so a stale cached inherited grant never authorizes new reads.
    expect((await call(outsider,page)).status).toBe(404);
    expect((await call(outsider,attachmentPath)).status).toBe(404);
    expect((await call(outsider,issuePath)).status).toBe(404);
    expect((await call(outsider,issuePath,'PATCH',stateRequest)).status).toBe(404);
    expect((await call(outsider,`${attachmentPath}/${attachment.id}`,'DELETE')).status).toBe(404);
    expect(await(await worker.fetch('http://fixture/fixture/gateway-dispatch?id='+gateway.id)).json()).toEqual({allowed:false});
    expect((await call(outsider,'/api/p/p123456789abc/tasks/team-contribution/token','POST',{})).status).toBe(404);
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
