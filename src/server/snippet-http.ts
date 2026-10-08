import {snippetWriteSchema} from './snippet-store';
import {accountOf,accountKeyFor} from './projects';
import type {Env} from './env';
import {authenticate} from './access';
import {readRequestJson} from './request-body';
export async function snippetHttp(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url),match=/^\/api\/snippets(?:\/([a-f0-9]{12})(?:\/([a-f0-9-]{36})(?:\/(raw))?)?)?$/.exec(url.pathname);
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
 if(!match)return reply({error:'Not found'},404);
 const auth=await authenticate(request,env),userId=auth instanceof Response?undefined:auth.id;
 const ownKey=userId?await accountKeyFor(userId):undefined,targetKey=match[1]??ownKey;
 if(!targetKey)return auth instanceof Response?auth:reply({error:'Sign in required'},401);
 if(!(await env.API_LIMITER.limit({key:ownKey??`snippets:${request.headers.get('CF-Connecting-IP')??'anonymous'}`})).success)return reply({error:'Too many requests'},429);
 if(!(auth instanceof Response)&&auth.viaToken&&(auth.tokenRepo||auth.tokenScope==='read'&&request.method!=='GET'))return reply({error:'Token scope does not permit snippets'},403);
 const account=accountOf(env,targetKey);if(await account.accountLifecycle()!=='active')return reply({error:'Not found'},404);
 try{
  if(request.method==='GET'){
   if([...url.searchParams.keys()].some(key=>key!=='revision')||url.searchParams.getAll('revision').length>1)return reply({error:'Invalid query'},400);
   if(!match[2])return reply({accountKey:targetKey,snippets:(await account.snippetsList(userId)).map(({ownerId:_,...snippet})=>snippet)});
   const revisionText=url.searchParams.get('revision'),revision=revisionText===null?undefined:Number(revisionText);if(revision!==undefined&&(!/^[1-9][0-9]*$/.test(revisionText!)||!Number.isSafeInteger(revision)))return reply({error:'Invalid revision'},400);
   const result=await account.snippetRead(match[2],userId,revision);
   if(match[3])return new Response(result.snippet.content,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}});
   const {ownerId,...snippet}=result.snippet;
   return reply({...result,snippet,canEdit:userId===ownerId});
  }
  if(request.method==='PUT'&&match[2]&&!match[3]&&!url.search){if(!userId||ownKey!==targetKey)return reply({error:'Only the owner can edit this snippet'},403);const parsed=snippetWriteSchema.safeParse(await readRequestJson<unknown>(request,131072));if(!parsed.success)return reply({error:'Confirm visibility, content and current revision'},400);return reply(await account.snippetSave(match[2],userId,parsed.data));}
  return reply({error:'Method not allowed'},405);
 }catch(error){const status=error instanceof Error&&'status'in error&&typeof error.status==='number'?error.status:409;return reply({error:status===404?'Snippet not found':'Snippet change unavailable; reload before retrying'},status);}
}
