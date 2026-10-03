import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {workerdChild} from "./support/workerd-child";

test("native issue creation recovers acknowledgments with actor and authority fences",async()=>{
 if(await workerdChild("tests/private-issue-recovery-http.test.ts"))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/private-issue-recovery-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"IssueRecoveryFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown,method?:string)=>fetch(new URL(path,direct),{method:method??(payload?"POST":"GET"),headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route="/api/p/p123456789abc/issues",payload={title:"  Saved private issue  ",body:"  Original description  ",idempotencyKey:crypto.randomUUID()};
 interface Issue{number:number;title:string;body:string;author:string;created_at:string;updated_at:string;state:string}
 const rows=async()=>await(await call("/fixture/snapshot")).json() as Issue[];
 try{
 const tokens=await(await call("/fixture/bootstrap")).json() as Record<string,string>;const member=await session("member"),other=await session("other"),owner=await session("owner");
 expect((await call(route,undefined,payload)).status).toBe(401);const response=await call(route,member,payload);expect(response.status).toBe(201);const saved=await response.json() as Issue;expect(saved.title).toBe("Saved private issue");expect(saved.body).toBe("Original description");await call("/fixture/rename");expect(await(await call(route,member,payload)).json() as Issue).toEqual(saved);expect((await rows()).length).toBe(1);
 for(const changed of [{title:"Different title"},{body:"Different description"}])expect((await call(route,member,{...payload,...changed})).status).toBe(409);expect((await call(route,member,{...payload,labels:["unsupported"]})).status).toBe(400);expect((await rows()).length).toBe(1);
 const otherResponse=await call(route,other,payload);expect(otherResponse.status).toBe(201);const own=await otherResponse.json() as Issue;expect(own.number).not.toBe(saved.number);expect(own.author).toBe("Original other");expect(await(await call(route,member,payload)).json() as Issue).toEqual(saved);
 const closedResponse=await call(`/api/p/p123456789abc/issues/${saved.number}`,owner,{state:"closed"},"PATCH");expect(closedResponse.status).toBe(200);const closed=await closedResponse.json() as Issue;expect(closed.state).toBe("closed");const closedReplay=await(await call(route,member,payload)).json() as Issue;expect(closedReplay.number).toBe(saved.number);expect(closedReplay.state).toBe("closed");expect(closedReplay.created_at).toBe(saved.created_at);expect(closedReplay.updated_at).toBe(closed.updated_at);
 const concurrentPayload={title:"Concurrent saved issue",body:"One intent",idempotencyKey:crypto.randomUUID()},beforeConcurrent=(await rows()).length;const concurrent=await Promise.all([call(route,member,concurrentPayload),call(route,member,concurrentPayload)]);expect(concurrent.map(response=>response.status)).toEqual([201,201]);const [one,two]=await Promise.all(concurrent.map(response=>response.json() as Promise<Issue>));expect(one).toEqual(two);expect((await rows()).length).toBe(beforeConcurrent+1);
const legacyOne=await call(route,member,{title:"Legacy optional-key input",body:"Legacy"});const legacyTwo=await call(route,member,{title:"Legacy optional-key input",body:"Legacy"});expect(legacyOne.status).toBe(201);expect(legacyTwo.status).toBe(201);expect((await legacyOne.json() as Issue).number).not.toBe((await legacyTwo.json() as Issue).number);
 await call(`/fixture/remove?id=${saved.number}`);expect((await call(route,member,payload)).status).toBe(410);expect((await rows()).some(issue=>issue.number===saved.number)).toBe(false);
 for(const [hook,effect,after] of [["profile","revoke-member",1],["lifecycle","revoke-member",2],["profile","seal",1]] as const){const before=await rows();await call(`/fixture/arm?hook=${hook}&effect=${effect}&after=${after}`);expect([403,409]).toContain((await call(route,member,{title:"Race must not save",body:"Race",idempotencyKey:crypto.randomUUID()})).status);expect(await rows()).toEqual(before);await call("/fixture/restore");}
 const beforeToken=await rows();await call("/fixture/arm?hook=profile&effect=revoke-token");expect([401,403]).toContain((await call(route,tokens.member,{title:"Revoked token",idempotencyKey:crypto.randomUUID()})).status);expect(await rows()).toEqual(beforeToken);
 const beforeDelete=await rows();await call("/fixture/arm?hook=profile&effect=delete");expect([403,409]).toContain((await call(route,member,{title:"Deleted repository",idempotencyKey:crypto.randomUUID()})).status);expect(await rows()).toEqual(beforeDelete);const providers=await(await call("/fixture/provider-calls")).json() as string[];expect(providers).toEqual([]);
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
