import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {workerdChild} from "./support/workerd-child";

test("native private comments recover acknowledgments and paginate all history without providers",async()=>{
 if(await workerdChild("tests/private-comments-recovery-http.test.ts"))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/private-comments-recovery-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"CommentRecoveryFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown)=>fetch(new URL(path,direct),{method:payload?"POST":"GET",headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route="/api/p/p123456789abc/comments",subject="change:change-one",payload={subject,body:"Saved private feedback",path:"src/app.ts",line:7,commit:"a".repeat(40),idempotencyKey:crypto.randomUUID()};
 interface Comment{id:number;subject:string;author:string;body:string;created_at:string}
 interface Page{comments:Comment[];nextCursor:string|null;hasMore:boolean}
 const page=async(token:string,cursor?:string)=>await(await call(`${route}?page=1&subject=${encodeURIComponent(subject)}${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,token)).json() as Page;
 const rows=async()=>await(await call("/fixture/snapshot")).json() as Comment[];
 try{
 const tokens=await(await call("/fixture/bootstrap")).json() as Record<string,string>;const member=await session("member"),owner=await session("owner"),other=await session("other");
 expect((await call(route,undefined,payload)).status).toBe(401);const initial=await page(owner);expect(initial.comments).toHaveLength(100);expect(initial.comments[0]?.id).toBe(501);expect(initial.comments.at(-1)?.id).toBe(600);expect(initial.hasMore).toBe(true);
 const savedResponse=await call(route,member,payload);expect(savedResponse.status).toBe(201);const saved=await savedResponse.json() as Comment;expect(saved.id).toBe(601);await call("/fixture/rename");expect(await(await call(route,member,payload)).json() as Comment).toEqual(saved);
 for(const changed of [{subject:"change:change-two"},{body:"Changed"},{path:"src/other.ts"},{line:8},{commit:"b".repeat(40)}])expect((await call(route,member,{...payload,...changed})).status).toBe(409);
 const otherResponse=await call(route,other,payload);if(otherResponse.status===201){const own=await otherResponse.json() as Comment;expect(own.id).not.toBe(saved.id);expect(own.author).toBe("Original other");}else expect([403,409]).toContain(otherResponse.status);
 const first=await page(member);expect(first.comments.at(-1)?.id).toBeGreaterThan(600);const firstIds=first.comments.map(comment=>comment.id);expect(firstIds).toEqual([...firstIds].sort((a,b)=>a-b));
 await call(route,tokens.owner,{subject,body:"Newer comment after cursor",idempotencyKey:crypto.randomUUID()});let cursor=first.nextCursor,loaded=[...first.comments];while(cursor){const next=await page(member,cursor);expect(next.hasMore).toBe(next.nextCursor!==null);loaded=[...next.comments,...loaded];cursor=next.nextCursor;}
 expect(new Set(loaded.map(comment=>comment.id)).size).toBe(loaded.length);expect(loaded[0]?.id).toBe(1);expect(loaded.some(comment=>comment.id===501)).toBe(true);expect(loaded.at(-1)?.id).toBe(first.comments.at(-1)?.id);expect(loaded.map(comment=>comment.id)).toEqual([...loaded.map(comment=>comment.id)].sort((a,b)=>a-b));
 expect((await call(`${route}?page=1&subject=change:change-two&cursor=${encodeURIComponent(first.nextCursor!)}`,member)).status).toBe(400);
 await call(`/fixture/remove?id=${saved.id}`);expect((await call(route,member,payload)).status).toBe(410);expect((await rows()).some(comment=>comment.id===saved.id)).toBe(false);
 for(const [hook,effect,after] of [["profile","revoke-member",1],["lifecycle","revoke-member",2],["profile","seal",1]] as const){const before=await rows();await call(`/fixture/arm?hook=${hook}&effect=${effect}&after=${after}`);expect([403,409]).toContain((await call(route,member,{subject,body:"Race must not save",idempotencyKey:crypto.randomUUID()})).status);expect(await rows()).toEqual(before);await call("/fixture/restore");}
 const beforeToken=await rows();await call("/fixture/arm?hook=profile&effect=revoke-token");expect([401,403]).toContain((await call(route,tokens.member,{subject,body:"Revoked token must not save",idempotencyKey:crypto.randomUUID()})).status);expect(await rows()).toEqual(beforeToken);
 const beforeDelete=await rows();await call("/fixture/arm?hook=profile&effect=delete");const deleted=await call(route,member,{subject,body:"Deleted repository must not save",idempotencyKey:crypto.randomUUID()});expect(deleted.status).toBe(503);expect(await deleted.text()).toBe("Comment access unavailable");expect(await rows()).toEqual(beforeDelete);const providers=await(await call("/fixture/provider-calls")).json() as string[];expect(providers).toEqual([]);
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
