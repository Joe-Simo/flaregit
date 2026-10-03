import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {workerdChild} from "./support/workerd-child";
test("actual Git sharing HTTP requires a named owner session and rejects full-access keys",async()=>{
 if(await workerdChild("tests/public-git-sharing-http.test.ts"))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"sharing",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const built=await Bun.build({entrypoints:["tests/support/public-git-sharing-http-worker.ts"],target:"browser",external:["cloudflare:workers","node:*"]});if(!built.success){issuer.stop(true);throw new Error(String(built.logs));}
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"sharing-http",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script:await built.outputs[0]!.text(),compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{ISSUER:issuer.url.origin},durableObjects:{TEST:{className:"SharingHttpFixture",useSQLite:true}},queueProducers:["INTEGRATION_QUEUE"]}]}));
 const direct=await mf.unsafeGetDirectURL("sharing-http");
 const call=(path:string,token?:string,method="GET")=>fetch(new URL(path,direct),{method,headers:{Connection:"close","CF-Connecting-IP":"198.51.100.12",...(token?{Authorization:`Bearer ${token}`}:{})},...(method==="PUT"?{body:JSON.stringify({enabled:false,mutation:{expectedVersion:0,idempotencyKey:crypto.randomUUID()}})}:{})});
 const session=(sub:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:"sharing"}).setIssuer(issuer.url.origin).setSubject(sub).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 try{
  const {token}=await(await call("/bootstrap")).json() as {token:string};const route="/api/p/abcdef123456/git-sharing",owner=await session("owner"),member=await session("member"),outsider=await session("outsider");
  expect((await call(route)).status).toBe(401);
  for(const method of ["GET","PUT"]){expect((await call(route,token,method)).status).toBe(403);expect((await call(route,member,method)).status).toBe(403);expect((await call(route,outsider,method)).status).toBe(404);expect((await call(route,owner,method)).status).toBe(200);}
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
