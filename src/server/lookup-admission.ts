import type {Env} from "./env.js";
/** Fixed IP admission precedes credential/repository DO lookup. Never key this
 * bucket by an attacker-selected token, subject, repository or URL segment.
 * The API fallback keeps older local fixture environments conservative.
 */
export async function admitCredentialLookup(request:Request,env:Pick<Env,"API_LIMITER"|"LOOKUP_LIMITER">):Promise<Response|null>{
 const limiter=env.LOOKUP_LIMITER??env.API_LIMITER;
 try{const result=await limiter.limit({key:`flaregit:credential/lookups:${request.headers.get("CF-Connecting-IP")??"unknown"}`});if(result.success)return null;}
 catch{return new Response("Credential lookup admission unavailable; retry shortly",{status:503,headers:{"Cache-Control":"no-store"}});}
 return new Response("Credential lookup limit reached; retry shortly",{status:429,headers:{"Cache-Control":"no-store","Retry-After":"60"}});
}
