import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('authority routes deny inactive browser accounts before publishing or granting consent',async()=>{
  if(await workerdChild('tests/authority-lifecycle-http.test.ts'))return;
  const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'authority-life',alg:'RS256',use:'sig'};
  const issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});
  const built=await Bun.build({entrypoints:['tests/support/authority-lifecycle-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});
  if(!built.success)throw Error(built.logs.join('\n'));
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'authority-life',modules:true,script:await built.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'AuthorityAccountFixture',useSQLite:true},AUTHORITY:{className:'AuthorityController',useSQLite:true}}}]}));
  try{
    const target=await mf.getWorker('authority-life');
    const token=await new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject('member').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const send=(path:string,body:unknown)=>target.fetch('http://fixture'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
    const app={name:'App',redirectUris:['https://app.example/cb'],scopes:['code:read']};
    const registered=await send('/api/oauth/apps',app);
    expect(registered.status).toBe(201);
    const {clientId}=await registered.json() as {clientId:string};
    const authorize=()=>send('/api/oauth/authorize',{clientId,redirectUri:'https://app.example/cb',scope:'code:read',codeChallenge:'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'});
    const {code}=await (await authorize()).json() as {code:string};
    const exchange=(code:string)=>({grant_type:'authorization_code',clientId,code,redirectUri:'https://app.example/cb',codeVerifier:'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'});
    const anonymous=(body:unknown)=>target.fetch('http://fixture/api/oauth/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const issued=await anonymous(exchange(code));expect(issued.status).toBe(200);
    const {refresh_token}=await issued.json() as {refresh_token:string};
    const pending=await (await authorize()).json() as {code:string};
    for(const state of ['deleting','deleted']){
      await target.fetch('http://fixture/fixture/lifecycle?state='+state);
      expect((await anonymous(exchange(pending.code))).status).toBe(400);
      expect((await anonymous({grant_type:'refresh_token',clientId,refreshToken:refresh_token})).status).toBe(400);
      expect((await send('/api/oauth/apps',app)).status).toBe(403);
      expect((await send('/api/oauth/authorize',{})).status).toBe(403);
      expect((await send('/api/registry/private-data/1.0.0',{files:{'secret.txt':'private'},private:true})).status).toBe(403);
    }
    expect((await target.fetch('http://fixture/api/registry/private-data')).status).toBe(404);
  }finally{await mf.dispose();issuer.stop(true);}
},60000);
