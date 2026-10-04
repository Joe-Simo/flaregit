import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {workerdChild} from "./support/workerd-child";

test("actual Worker owner reconciliation is session-only, redacted, read-only and fenced during provider reads",async()=>{
 if(await workerdChild("tests/storage-reconciliation-http.test.ts"))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"reconciliation",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-reconciliation-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/storage-reconciliation-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"reconciliation-api",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{TEST:{className:"ReconciliationFixture",useSQLite:true}},r2Buckets:{BUCKET:"reconciliation-fixture"}}]}));
 const direct=await mf.unsafeGetDirectURL("reconciliation-api");
 const call=(path:string,token?:string)=>fetch(new URL(path,direct),{headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{})}});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route="/api/p/p123456789abc/storage-reconciliation",metadata="/api/p/p123456789abc";
 const snapshot=async()=>await(await call("/fixture/snapshot")).json();
 try{
  const fixture=await(await call("/fixture/bootstrap")).json() as {token:string;incarnation:string;key:string;keyAccount:string};
  const [owner,member,outsider]=await Promise.all([session("owner"),session("member"),session("outsider")]);
  expect((await call(route)).status).toBe(401);expect((await call(route,member)).status).toBe(403);expect((await call(route,outsider)).status).toBe(404);expect((await call(route,fixture.token)).status).toBe(403);
  const before=await snapshot(),response=await call(route,owner);expect(response.status).toBe(200);
  const report=await response.json() as {holdsPreserved:boolean;absenceConfirmsCancellation:boolean;observations:{status:string;metadataPresent:boolean}[];plans:{unfinishedCount:number}[];cursor:string|null;plansNextCursor:string|null;complete:boolean};
  expect(report.holdsPreserved).toBe(true);expect(report.absenceConfirmsCancellation).toBe(false);expect(report.observations[0]?.status).toBe("present");expect(report.observations[0]?.metadataPresent).toBe(true);expect(report.plans[0]?.unfinishedCount).toBe(1);
  for(const secret of [fixture.token,fixture.key,fixture.incarnation,fixture.keyAccount,"private-body","secret-metadata","owner","builds/"])expect(JSON.stringify(report)).not.toContain(secret);
  expect(report.observations).toHaveLength(32);expect(report.complete).toBe(false);expect(report.cursor).toBeTruthy();expect(report.plansNextCursor).toBeTruthy();
  const objectsNext=await(await call(`${route}?cursor=${encodeURIComponent(report.cursor!)}`,owner)).json() as {observations:unknown[];cursor:string|null};expect(objectsNext.observations).toHaveLength(15);expect(objectsNext.cursor).toBeNull();
  const plansNext=await(await call(`${route}?plansCursor=${encodeURIComponent(report.plansNextCursor!)}`,owner)).json() as {plans:unknown[];plansNextCursor:string|null};expect(plansNext.plans).toHaveLength(1);expect(plansNext.plansNextCursor).toBeNull();
  expect(await snapshot()).toEqual(before);
  for(const query of ["cursor=a&cursor=b","plansCursor=a&plansCursor=b"])expect((await call(`${route}?${query}`,owner)).status).toBe(400);
  expect((await call(`${route}?cursor=${"a".repeat(1001)}`,owner)).status).toBe(400);
  expect(await snapshot()).toEqual(before);
  for(const mode of ["head","list"]){await call(`/fixture/race?mode=${mode}`);const raced=await call(route,owner);expect([403,404,409]).toContain(raced.status);const text=await raced.text();expect(text).not.toContain("observations");expect(text).not.toContain(fixture.key);await call("/fixture/mutate?mode=restore");await call("/fixture/race?mode=off");}
  await call("/fixture/mutate?mode=repo-delete");expect((await call(route,fixture.token)).status).toBe(403);expect((await call(metadata,owner)).status).toBe(409);const fenced=await snapshot();expect((await call(route,owner)).status).toBe(200);expect(await snapshot()).toEqual(fenced);
  await call("/fixture/mutate?mode=account-delete");expect((await call(metadata,owner)).status).toBe(403);expect((await call(route,fixture.token)).status).toBe(403);const deleting=await snapshot();expect((await call(route,owner)).status).toBe(200);expect(await snapshot()).toEqual(deleting);
  await call("/fixture/mutate?mode=legacy");const legacyBefore=await snapshot();const legacy=await call(route,owner);expect(legacy.status).toBe(409);expect(await legacy.text()).toMatch(/incarnation|legacy|unavailable/i);expect(await snapshot()).toEqual(legacyBefore);
  expect(await(await call("/fixture/provider-writes")).json() as string[]).toEqual([]);
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
