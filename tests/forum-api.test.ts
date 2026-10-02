import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {workerdChild} from "./support/workerd-child";
import type {CommunityEntry} from "../src/server/platform-community";

test("production forum HTTP+SQL binds signed authors, enforces version/moderator rules and exposes no private data",async()=>{
  if(await workerdChild("tests/forum-api.test.ts"))return;
  const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"synthetic-test-key",alg:"RS256",use:"sig"};
  const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
  const file=`/tmp/flaregit-forum-api-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,"build","tests/support/forum-api-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});const[error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}const script=await Bun.file(file).text();await Bun.file(file).delete();
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"forum-api",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{TEST:{className:"ForumApiRepository",useSQLite:true}}}]}));
  const call=async(path:string,method="GET",body?:unknown,token?:string)=>(await mf.getWorker("forum-api")).fetch(`http://test${path}`,{method,headers:{"CF-Connecting-IP":"198.51.100.20",...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:typeof body==="string"?body:JSON.stringify(body)})});
  try{
    const tokens=await(await call("/fixture/bootstrap")).json() as Record<string,string>;
    const initial=await(await call("/api/community")).json() as{topics:unknown[]};expect(initial.topics).toEqual([]);
    const input={category:"feedback",title:"Owned fixture topic",body:"Explicit new public conversation",idempotencyKey:"forum-api-fixture-123",confirmed:true};
    expect((await call("/api/community/topics","POST",input)).status).toBe(401);
    expect((await call("/api/community/topics","POST",{...input,confirmed:"true"},tokens["forum-owner"])).status).toBe(409);
    expect((await call("/api/community/topics","POST",{...input,author:"Spoofed moderator"},tokens["forum-owner"])).status).toBe(409);
    expect((await call("/api/community/topics","POST",input,tokens.pinned)).status).toBe(403);
    for(const invalid of ["{invalid","[]","null","x".repeat(131073)])expect((await call("/api/community/topics","POST",invalid,tokens["forum-owner"])).status).toBe(400);
    const post=await(await call("/api/community/topics","POST",input,tokens["forum-owner"])).json() as CommunityEntry;expect(post.author).toBe("Verified forum author");expect(post.version).toBe(1);
    const reply=await(await call(`/api/community/topics/${post.id}/replies`,"POST",{body:"Signed reply",idempotencyKey:"reply-fixture-123",confirmed:true},tokens["forum-other"])).json() as CommunityEntry;expect(reply.topicId).toBe(post.id);expect(reply.author).toBe("Other signed contributor");
    const authorPermissions=await(await call(`/api/community/permissions?topic=${post.id}`,"GET",undefined,tokens["forum-owner"])).json() as{entries:Array<{id:string;canEdit:boolean;canRemove:boolean}>;moderator:boolean};expect(authorPermissions.entries.find(entry=>entry.id===post.id)).toMatchObject({canEdit:true,canRemove:true});expect(authorPermissions.entries.find(entry=>entry.id===reply.id)).toMatchObject({canEdit:false,canRemove:false});
    const publicBody=await(await call(`/api/community/topics/${post.id}`)).text();expect(publicBody).not.toContain("forum-owner");expect(publicBody).not.toContain("Private repository conversation body");expect(publicBody).not.toContain("Private repo title");expect(publicBody).not.toContain(tokens["forum-owner"]!);
    expect((await call(`/api/community/entries/${post.id}`,"PUT",{body:"Other edit",expectedVersion:1,confirmed:true},tokens["forum-other"])).status).toBe(409);
    expect((await call(`/api/community/entries/${post.id}`,"PUT",{body:"Author edit",expectedVersion:1,confirmed:true},tokens["forum-owner"])).status).toBe(200);
    expect((await call(`/api/community/entries/${post.id}`,"PUT",{body:"Stale edit",expectedVersion:1,confirmed:true},tokens["forum-owner"])).status).toBe(409);
    expect((await call(`/api/community/entries/${post.id}`,"DELETE",{expectedVersion:2,reason:"Token cannot moderate"},tokens["forum-moderator"])).status).toBe(409);
    const moderator=await new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject("forum-moderator").setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
    const moderatorPermissions=await(await call(`/api/community/permissions?topic=${post.id}`,"GET",undefined,moderator)).json() as{entries:Array<{id:string;canEdit:boolean;canRemove:boolean}>;moderator:boolean};expect(moderatorPermissions.moderator).toBe(true);expect(moderatorPermissions.entries.find(entry=>entry.id===post.id)).toMatchObject({canEdit:false,canRemove:true});
    expect((await call(`/api/community/entries/${post.id}`,"DELETE",{expectedVersion:1,reason:"Stale moderation"},moderator)).status).toBe(409);
    expect((await call(`/api/community/entries/${post.id}`,"DELETE",{expectedVersion:2},moderator)).status).toBe(409);
    expect((await call(`/api/community/entries/${post.id}`,"DELETE",{expectedVersion:2,reason:"Fixture moderation"},moderator)).status).toBe(200);
    const removed=await(await call(`/api/community/topics/${post.id}`)).json() as{topic:CommunityEntry};expect(removed.topic.removed).toBe(true);expect(removed.topic.body).toBe("");
    await call("/fixture/delete","POST",{userId:"forum-other"});expect((await call("/api/community/topics","POST",{...input,idempotencyKey:"deleted-author-fixture"},tokens["forum-other"])).status).toBe(401);
    const deletedSession=await new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject("forum-other").setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
    expect((await call("/api/community/topics","POST",{...input,idempotencyKey:"deleted-session-fixture"},deletedSession)).status).toBe(403);
  }finally{await mf.dispose();issuer.stop(true);}
},30000);
