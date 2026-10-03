import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {workerdChild} from "./support/workerd-child";



test("native repository reads validate, fund and reauthorize before releasing bytes",async()=>{
  if(await workerdChild("tests/repository-read-http.test.ts"))return;
  const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"repository-read-fixture",alg:"RS256",use:"sig"};
  const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
  const file=`/tmp/flaregit-repository-read-${crypto.randomUUID()}.js`;
  const build=Bun.spawn([process.execPath,"build","tests/support/repository-read-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
  const[error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
  const script=await Bun.file(file).text();await Bun.file(file).delete();
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"repository-read-api",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin,CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS:"100000000",CORE_GIT_GLOBAL_MONTHLY_USD_MICROS:"100000000",REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS:"100000000",REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS:"100000000"},durableObjects:{TEST:{className:"RepositoryReadFixture",useSQLite:true},REPOSITORY_CONTROLLER:{className:"RepositoryReadFixture",useSQLite:true}}}]}));
  const directUrl=await mf.unsafeGetDirectURL("repository-read-api");
  const call=(path:string,method="GET",body?:unknown,token?:string)=>fetch(new URL(path,directUrl),{method,headers:{Connection:"close","CF-Connecting-IP":"198.51.100.25",...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
  try{
    const {token}=await(await call("/fixture/bootstrap")).json() as {token:string};
    const outsider=await session("outsider"),member=await session("member"),route="/api/p/p123456789abc";
    const counts=async()=>await(await call("/fixture/counts")).json() as {gets:number;reads:number;refs:string[];repoNames:string[];commitReads:string[];reservations:Array<{account_key:string;category:string}>};
    const config=async(query="")=>{const response=await call(`/fixture/config?${query}`);if(!response.ok)throw new Error(await response.text());};
    await config();expect((await call(`${route}/commits`)).status).toBe(401);expect((await call(`${route}/commits`,"GET",undefined,outsider)).status).toBe(404);expect((await counts()).gets).toBe(0);
    for(const query of ["limit=NaN","limit=0","limit=2&limit=3","offset=-1","unknown=1"]){
      await config();expect((await call(`${route}/commits?${query}`,"GET",undefined,token)).status).toBe(400);expect((await counts()).gets).toBe(0);
    }
    await config();expect((await call(`${route}/tree?path=..%2Fsecret`,"GET",undefined,token)).status).toBe(400);expect((await counts()).gets).toBe(0);
    await config();const contents=await call(`${route}/blob?path=readme.md`,"GET",undefined,member);expect(contents.status).toBe(200);expect(contents.headers.get("cache-control")).toContain("no-store");expect(await contents.text()).toContain("synthetic private contents");expect((await counts()).reservations).toEqual([{account_key:token.split("_")[1]!,category:"read"}]);
    await config();const published=await call("/api/public/p123456789abc/file?path=readme.md");expect(published.status).toBe(200);expect((await counts()).refs.every(ref=>ref==="a".repeat(40))).toBe(true);expect((await counts()).reservations).toEqual([{account_key:token.split("_")[1]!,category:"read"}]);
    await config("funded=false");expect((await call(`${route}/commits`,"GET",undefined,token)).status).toBe(429);expect((await counts()).gets).toBe(0);
    await config("mode=unavailable");expect((await call(`${route}/tree`,"GET",undefined,token)).status).toBe(503);
    await config("mode=metadata");expect((await call(`${route}/tree`,"GET",undefined,token)).status).toBe(413);
    await config("mode=oversize");const oversized=await call(`${route}/blob?path=readme.md`,"GET",undefined,token);expect(oversized.status).toBe(200);expect((await oversized.json() as {truncated:boolean;content:string})).toMatchObject({truncated:true,content:""});
    await config("race=membership");const denied=await call(`${route}/blob?path=readme.md`,"GET",undefined,member);expect(denied.status).toBe(503);expect(await denied.text()).not.toContain("synthetic private contents");
    await config("mode=diff5000");const fullDiff=await call(`${route}/diff?commit=${"a".repeat(40)}`,"GET",undefined,token);expect(fullDiff.status).toBe(200);expect((await fullDiff.json() as {files:unknown[]}).files).toHaveLength(5000);
    await config("mode=diff5001");expect((await call(`${route}/diff?commit=${"a".repeat(40)}`,"GET",undefined,token)).status).toBe(413);
    for(const race of ["account","repository"]){await config(`race=${race}`);const denied=await call(`${route}/blob?path=readme.md`,"GET",undefined,token);expect(denied.status).toBe(503);expect(await denied.text()).not.toContain("synthetic private contents");}
    await config("race=visibility");const hidden=await call("/api/public/p123456789abc/file?path=readme.md");expect([409,503]).toContain(hidden.status);expect(await hidden.text()).not.toContain("synthetic private contents");
    await config("race=head");const changed=await call("/api/public/p123456789abc/file?path=readme.md");expect([409,503]).toContain(changed.status);expect(await changed.text()).not.toContain("synthetic private contents");
    await config("mode=expiry");const expiringRead=await new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject("member").setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+2).sign(pair.privateKey);const expiredRead=await call(`${route}/blob?path=readme.md`,"GET",undefined,expiringRead);expect(expiredRead.status).toBe(503);expect(await expiredRead.text()).not.toContain("synthetic private contents");
    const frozenRoute=`${route}/diff?candidate=candidate-frozen&input=frozen`;
    await config("mode=frozen");const frozen=await call(frozenRoute,"GET",undefined,token);expect(frozen.status).toBe(200);expect(await frozen.json()).toMatchObject({repo:"task:frozen",base:"a".repeat(40),head:{hash:"e".repeat(40)},input:{taskId:"frozen",commit:"e".repeat(40),baseSource:"recorded-contribution-base"}});expect((await counts()).repoNames).toEqual(["synthetic-retained-input"]);expect((await counts()).commitReads).toEqual(["e".repeat(40),"a".repeat(40)]);
    await config("mode=frozen-old-context");const oldContext=await call(frozenRoute,"GET",undefined,token);expect(oldContext.status).toBe(503);expect(await oldContext.text()).toContain("no workspace read was started");expect((await counts()).gets).toBe(0);expect((await counts()).commitReads).toEqual([]);
    await config("mode=frozen-legacy");const parentBase=await call(frozenRoute,"GET",undefined,token);expect(parentBase.status).toBe(200);expect(await parentBase.json()).toMatchObject({base:"7".repeat(40),input:{baseSource:"commit-parent"}});
    for(const query of ["candidate=unknown&input=frozen","candidate=candidate-frozen&input=working","candidate=candidate-frozen&input=missing"]){await config("mode=frozen");expect((await call(`${route}/diff?${query}`,"GET",undefined,token)).status).toBe(404);expect((await counts()).gets).toBe(0);}
    await config("mode=frozen");expect((await call(`${route}/diff?commit=${"e".repeat(40)}&input=frozen`,"GET",undefined,token)).status).toBe(400);expect((await counts()).gets).toBe(0);
    await config("mode=frozen&funded=false");expect((await call(frozenRoute,"GET",undefined,token)).status).toBe(429);expect((await counts()).gets).toBe(0);
    for(const race of ["input-map","input-base"]){await config(`mode=frozen&race=${race}`);const changed=await call(frozenRoute,"GET",undefined,token);expect(changed.status).toBe(503);expect(await changed.text()).not.toContain("readme.md");}
    await config("mode=frozen-missing");const missingInput=await call(frozenRoute,"GET",undefined,token);expect(missingInput.status).toBe(503);expect(await missingInput.text()).toContain("No newer checkpoint was substituted");expect((await counts()).commitReads).toEqual(["e".repeat(40)]);
    const savedTask=async()=>await(await call("/fixture/task")).json() as {currentCommit:string;status:string;checkpoints:unknown[]};
    const original=await savedTask();
    for(const [query,status] of [["mode=ready5000&funded=false",429],["mode=unavailable",503],["mode=ready-base-unavailable",503],["mode=ready5001",413],["mode=ready5000&race=membership",503]] as const){await config(query);const failed=await call(`${route}/tasks/working/ready`,"POST",{},member);expect(failed.status).toBe(status);expect(await savedTask()).toEqual(original);}
    for(const [finalRace,actor] of [["membership",member],["token",token]] as const){await config(`mode=ready5000&finalRace=${finalRace}`);expect((await call(`${route}/tasks/working/ready`,"POST",{},actor)).status).toBe(503);expect(await savedTask()).toEqual(original);}
    await config("mode=ready5000&finalRace=expiry");const expiringReady=await new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject("member").setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+2).sign(pair.privateKey);expect((await call(`${route}/tasks/working/ready`,"POST",{},expiringReady)).status).toBe(503);expect(await savedTask()).toEqual(original);
    await config("mode=ready5000");const ready=await call(`${route}/tasks/working/ready`,"POST",{},member);expect(ready.status).toBe(200);expect(await ready.json()).toMatchObject({commit:"e".repeat(40),applied:true});const accepted=await savedTask();expect(accepted.status).toBe("ready");expect(accepted.currentCommit).toBe("e".repeat(40));expect(accepted.checkpoints).toHaveLength(1);
    await config("race=token");const revoked=await call(`${route}/blob?path=readme.md`,"GET",undefined,token);expect(revoked.status).toBe(503);expect(await revoked.text()).not.toContain("synthetic private contents");
  }finally{await mf.dispose();issuer.stop(true);}
},30000);
