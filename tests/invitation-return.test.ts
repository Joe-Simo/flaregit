import { expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticate } from "../src/server/access";
import type { Env } from "../src/server/env";
import { invitationReturnHttp } from "../src/server/invitation-return-http";
import { openInvitationReturn, sealInvitationReturn } from "../src/server/invitation-return";
import { safeSignInReturn } from "../src/web/sign-in-return";
import { prepareInvitationSignIn } from "../src/web/invitation-return";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvitationSignIn } from "../src/web/pages/InvitationSignIn";
const origin="https://flaregit.com",master="synthetic-invitation-master-key-1234567890",nonce=crypto.randomUUID(),invite={nonce,projectId:"p123456789abc",token:"a".repeat(48)};
test("encrypted invitation return binds origin nonce TTL and never stores a plain bearer",async()=>{
 const sealed=await sealInvitationReturn(master,origin,invite,1000);
 expect(sealed).not.toContain(invite.token);
 expect((await openInvitationReturn(master,origin,sealed,nonce,1001)).token).toBe(invite.token);
 await expect(openInvitationReturn(master,origin,sealed,nonce,1900)).rejects.toThrow();
 await expect(openInvitationReturn(master,"https://other.example",sealed,nonce,1001)).rejects.toThrow();
 await expect(openInvitationReturn(master,origin,sealed,crypto.randomUUID(),1001)).rejects.toThrow();
 await expect(openInvitationReturn(master,origin,sealed.slice(0,-2)+"xx",nonce,1001)).rejects.toThrow();
});
test("actual HTTP return requires cookie acknowledgement fresh human JWT and confirmed membership",async()=>{
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"synthetic-return",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const authEnv={CLERK_ISSUER:issuer.url.origin,CLERK_AUTHORIZED_PARTIES:origin} as Env;
 const jwt=await new SignJWT({azp:origin}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setSubject("synthetic-human").setIssuer(issuer.url.origin).setExpirationTime("5m").sign(pair.privateKey);
 let member=false,authReads=0,limitAllowed=true;
 const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:request=>{const actual=new Request(origin+new URL(request.url).pathname,request);return invitationReturnHttp(actual,{master,allowedOrigins:origin,limit:async()=>limitAllowed,authenticate:()=>{authReads++;return authenticate(actual,authEnv);},role:async()=>member?"member":null});}});
 const call=(action:string,body:unknown,cookie?:string,authorized=false,site="same-origin")=>fetch(new URL(`/api/join-return/${action}`,server.url),{method:"POST",headers:{Origin:origin,"Sec-Fetch-Site":site,"CF-Connecting-IP":"198.51.100.8","Content-Type":"application/json",...(cookie?{Cookie:cookie}:{}),...(authorized?{Authorization:`Bearer ${jwt}`}:{})},body:JSON.stringify(body)});
 try{
  expect((await call("prepare",invite,undefined,false,"cross-site")).status).toBe(403);
  limitAllowed=false;expect((await call("prepare",invite)).status).toBe(429);limitAllowed=true;
  expect((await call("prepare",{...invite,extra:"x".repeat(1100)})).status).toBe(400);expect(authReads).toBe(0);
  const prepared=await call("prepare",invite),setCookie=prepared.headers.get("Set-Cookie")!;
  expect(prepared.status).toBe(200);expect(setCookie).toContain("HttpOnly; Secure; SameSite=Lax");expect(setCookie).not.toContain(invite.token);
  const cookie=setCookie.split(";")[0]!;
  expect((await call("prepare",invite,cookie)).status).toBe(200);
  expect((await call("prepare",{...invite,token:"c".repeat(48)},cookie)).status).toBe(409);
  expect((await call("confirm",{nonce})).status).toBe(409);
  expect(await(await call("confirm",{nonce},cookie)).json() as unknown).toEqual({nonce,confirmed:true});
  expect((await call("resume",{nonce},cookie)).status).toBe(401);
  expect(await(await call("resume",{nonce},cookie,true)).json() as unknown).toEqual(invite);
  expect((await call("resume",{nonce:crypto.randomUUID()},cookie,true)).status).toBe(409);
  const second={nonce:crypto.randomUUID(),projectId:"pabcdef123456",token:"b".repeat(48)};
  const secondPrepared=await call("prepare",second,cookie),secondCookie=secondPrepared.headers.get("Set-Cookie")!.split(";")[0]!;
  const cancelledOld=await call("clear",{nonce,reason:"cancel"},`${cookie}; ${secondCookie}`);
  expect(cancelledOld.headers.get("Set-Cookie")?.split("=")[0]).toBe(cookie.split("=")[0]);
  expect(cancelledOld.headers.get("Set-Cookie")?.split("=")[0]).not.toBe(secondCookie.split("=")[0]);
  expect(await(await call("resume",{nonce:second.nonce},secondCookie,true)).json() as unknown).toEqual(second);
  expect((await call("clear",{nonce,reason:"joined",projectId:invite.projectId},cookie,true)).status).toBe(409);
  member=true;const cleared=await call("clear",{nonce,reason:"joined",projectId:invite.projectId},cookie,true);expect(cleared.status).toBe(200);expect(cleared.headers.get("Set-Cookie")).toContain("Max-Age=0");member=false;expect(await(await call("clear",{nonce,reason:"joined"},undefined,true)).json() as unknown).toEqual({nonce,cookieAbsent:true});
  expect((await call("clear",{nonce,reason:"cancel"},cookie)).status).toBe(200);
 }finally{server.stop(true);issuer.stop(true);}
});
test("cookie-disabled preparation fails before producing an OAuth return destination",async()=>{
 const original=fetch;let calls=0;
 globalThis.fetch=Object.assign(async(_input:Parameters<typeof fetch>[0],init?:RequestInit)=>{calls++;const body=JSON.parse(String(init?.body));return calls===1?Response.json({nonce:body.nonce,prepared:true}):new Response("Cookie unavailable",{status:409});},{preconnect:original.preconnect});
 try{await expect(prepareInvitationSignIn(invite.projectId,invite.token,new AbortController().signal)).rejects.toThrow();expect(calls).toBe(2);}finally{globalThis.fetch=original;}
 expect(safeSignInReturn(`/join/${invite.projectId}/${invite.token}`)).toBeNull();
 expect(safeSignInReturn(`/join-resume?context=${nonce}`)).toBe(`/join-resume?context=${nonce}`);
 const html=renderToStaticMarkup(createElement(InvitationSignIn,{projectId:invite.projectId,token:invite.token,onPrepared:()=>{},onCancel:()=>{}}));
 expect(html).toContain("Continue to sign in");expect(html).not.toContain(invite.token);expect(html).not.toContain("Join repository</button>");
});
