import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {workerdChild} from "./support/workerd-child";

import { PUBLIC_GIT_AUTHOR_ACKNOWLEDGEMENT } from "../src/server/public-git-consent";

test("native sharing HTTP requires named owner session and current accepted scope",async()=>{
  if(await workerdChild("tests/public-git-sharing-http.test.ts"))return;
  const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"sharing-fixture",alg:"RS256",use:"sig"};
  const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
  const file=`/tmp/flaregit-sharing-${crypto.randomUUID()}.js`;
  const build=Bun.spawn([process.execPath,"build","tests/support/public-git-sharing-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
  const[error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
  const script=await Bun.file(file).text();await Bun.file(file).delete();
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"sharing-api",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{TEST:{className:"SharingHttpFixture",useSQLite:true}}}]}));
  const directUrl=await mf.unsafeGetDirectURL("sharing-api");
  const call=(path:string,method="GET",body?:unknown,token?:string)=>fetch(new URL(path,directUrl),{method,headers:{Connection:"close","CF-Connecting-IP":"198.51.100.25",...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
  try{
    const {token}=await(await call("/fixture/bootstrap")).json() as {token:string};
    const owner=await session("owner"),member=await session("member"),outsider=await session("outsider"),route="/api/p/p123456789abc/git-sharing";
    expect((await call(route)).status).toBe(401);
    expect((await call(route,"GET",undefined,outsider)).status).toBe(404);
    expect((await call(route,"GET",undefined,member)).status).toBe(403);
    expect((await call(route,"GET",undefined,token)).status).toBe(403);
    const state=await(await call(route,"GET",undefined,owner)).json() as {target:{incarnation:string;commit:string;tree:string;publicationVersion:number};publication:null};
    expect(state.publication).toBeNull();expect(state.target.commit).toBe("a".repeat(40));expect(state.target.tree).toBe("b".repeat(40));expect(state.target.publicationVersion).toBe(1);
    const decision={enabled:true,consent:{...state.target,confirmed:true,acknowledgement:PUBLIC_GIT_AUTHOR_ACKNOWLEDGEMENT},mutation:{idempotencyKey:crypto.randomUUID(),expectedVersion:0}};
    expect((await call(route,"PUT",decision,token)).status).toBe(403);
    expect((await call(route,"PUT",decision,member)).status).toBe(403);
    expect((await call(route,"PUT",decision,outsider)).status).toBe(404);
    expect((await call(route,"PUT",{...decision,consent:{...decision.consent,commit:"f".repeat(40)}},owner)).status).toBe(409);
    const accepted=await call(route,"PUT",decision,owner);expect(accepted.status).toBe(200);const saved=await accepted.json() as {ownerId:string;version:number;enabled:boolean};expect(saved.ownerId).toBe("owner");expect(saved.version).toBe(1);expect(saved.enabled).toBe(true);
    expect(await(await call(route,"PUT",decision,owner)).json() as typeof saved).toEqual(saved);
    await call("/fixture/mutate?mode=version");
    expect((await call(route,"PUT",{...decision,mutation:{idempotencyKey:crypto.randomUUID(),expectedVersion:1}},owner)).status).toBe(409);
    await call("/fixture/mutate?mode=suppress");expect((await call(route,"PUT",decision,owner)).status).toBe(409);
    await call("/fixture/mutate?mode=head");expect((await(await call(route,"GET",undefined,owner)).json() as {target:unknown}).target).toBeNull();
    expect((await call(route,"PUT",{enabled:false,mutation:{idempotencyKey:crypto.randomUUID(),expectedVersion:1}},owner)).status).toBe(200);
    await call("/fixture/mutate?mode=demote");expect((await call(route,"PUT",decision,owner)).status).toBe(403);
  }finally{await mf.dispose();issuer.stop(true);}
},30000);
