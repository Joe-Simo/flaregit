import {acceptedLfsPointers,type PublicLfsProof} from "./lfs-public";
import {openRepositoryRead} from "./repository-read-budget";
import {validateLfsBatch,type LfsObjectRef} from '../core/git-lfs';
import {authenticate} from './access';
import {gitHttpCredential} from './git-http-gateway';
import {gitParentTokenHash} from './git-gateway-handler';
import {accountKeyFor,globalOf,projectOf,PROJECT_ID} from './projects';
import {LFS_HTTP_OBJECT_BYTES,LfsStorageError} from './lfs-store';
import {readRequestJson,RequestBodyError} from './request-body';
import type {Env} from './env';
export interface LfsCredential {userId:string;taskId:string|null;credentialHash?:string;gitCapability?:string;sessionExpiresAt?:number}
export async function handleLfsHttp(request:Request,env:Env):Promise<Response|null>{
 const url=new URL(request.url);
 const route=/^\/git\/([a-z0-9]{12,16})\/(canonical|tasks\/([a-z0-9][a-z0-9-]{2,100}))\.git\/info\/lfs(?:\/(.*))?$/.exec(url.pathname);
 if(!route){
  // Every LFS-looking request terminates in this protocol boundary. It must
  // never enter native Git transport admission or allocate provider handles.
  if(/\/info\/lfs(?:\/|$)/.test(url.pathname))return Response.json({message:'LFS endpoint not found'},{status:404,headers:{'Content-Type':'application/vnd.git-lfs+json','Cache-Control':'no-store'}});
  return null;
 }
 const projectId=route[1]!,taskId=route[3]??null,path=route[4]??'';
 const endpoint=/^objects\/(batch|[a-f0-9]{64}(?:\/(?:verify|reconcile))?)$/.exec(path)?.[1];
 const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Content-Type':'application/vnd.git-lfs+json','Cache-Control':'no-store',...(status===401?{'WWW-Authenticate':'Basic realm="FlareGit", charset="UTF-8"'}:{})}});
 if(!PROJECT_ID.test(projectId)||url.search||request.headers.has('Content-Encoding'))return response({message:'Invalid LFS route'},400);
 const project=projectOf(env,projectId);
 const publicProof=async(requested:readonly (string|LfsObjectRef)[]):Promise<PublicLfsProof>=>{
  if(taskId!==null)throw new LfsStorageError('Private workspace credential required',401);
  const ip=request.headers.get('CF-Connecting-IP');if(!ip)throw new LfsStorageError('Public LFS admission unavailable',503);
  if(!(await env.API_LIMITER.limit({key:'public-lfs:'+projectId+':'+ip})).success)throw new LfsStorageError('Public LFS request limit reached',429);
  const context=await project.repositoryReadContext(null,null);if(!context.acceptedCommit||!context.incarnation||context.publicationVersion===undefined)throw new LfsStorageError('Repository is not public',404);
  const snapshot={acceptedCommit:context.acceptedCommit,incarnation:context.incarnation,publicationVersion:context.publicationVersion};
  const stored=await project.lfsPublicExpectedSizes(requested.filter((value):value is string=>typeof value==='string'),snapshot);
  const wanted=requested.flatMap(value=>typeof value==='string'?stored.filter(object=>object.oid===value):[value]);
  const authorize=async()=>{if(!await project.assertRepositoryReadContext(context,null,null))throw new LfsStorageError('Public LFS publication changed',409);};
  using reader=await openRepositoryRead(env,{repoName:context.canonicalRepoName,authorize,reserveGroup:operationId=>globalOf(env).reserveRepositoryReadOperation(operationId,context.accountKey),limits:{maxProviderCalls:8192,maxBlobBytes:4*1024*1024,deadlineMs:120000}});
  const objects=await acceptedLfsPointers(reader,context.acceptedCommit,wanted);await authorize();
  return{acceptedCommit:context.acceptedCommit,incarnation:context.incarnation,publicationVersion:context.publicationVersion,objects};
 };
 const credential=async(write:boolean):Promise<LfsCredential>=>{
  const secret=gitHttpCredential(request);
  if(secret?.startsWith('fgg_')){const identity=await project.verifyGitCapability(secret,taskId,write);if(!identity)throw new LfsStorageError('Git credential is expired, revoked or outside its scope',401);return{userId:identity.userId,taskId,gitCapability:secret,...(identity.parentTokenHash?{credentialHash:identity.parentTokenHash}:{})};}
  const auth=await authenticate(secret?new Request(request.url,{headers:{Authorization:'Bearer '+secret}}):request,env);
  if(auth instanceof Response)throw new LfsStorageError('LFS credential required',401);
  if(auth.oauthClientId||auth.tokenRepo&&auth.tokenRepo!==projectId||write&&auth.tokenScope==='read')throw new LfsStorageError('Credential does not permit this LFS operation',403);
  return{userId:auth.id,taskId,...(auth.viaToken?{credentialHash:await gitParentTokenHash(request)}:{sessionExpiresAt:auth.expiresAt})};
 };
 try{
  if(path==='locks/verify'&&request.method==='POST'){
   const actor=await credential(true);await project.lfsBatch('upload',[],actor);await credential(true);
   return response({message:'LFS file locking is not supported; the basic object transfer API is available'},501);
  }
  if(!endpoint)return response({message:path==='locks'||path.startsWith('locks/')?'LFS file locking is not supported':'LFS endpoint not found'},path==='locks'||path.startsWith('locks/')?501:404);
  if(endpoint==='batch'){
   if(request.method!=='POST')return response({message:'Method not allowed'},405);
   const input=await readRequestJson<unknown>(request,65536),batch=validateLfsBatch(input,LFS_HTTP_OBJECT_BYTES);if(!batch.ok)return response({message:batch.error},batch.status);
   if(!request.headers.has('Authorization')&&batch.operation==='download'&&taskId===null){
    const proof=await publicProof(batch.objects),rows=await project.lfsPublicBatch(batch.objects,proof),base=url.origin+url.pathname.slice(0,url.pathname.length-'batch'.length);
    return response({transfer:'basic',hash_algo:'sha256',objects:rows.map(row=>({oid:row.oid,size:row.size,...(row.error?{error:row.error}:{actions:{download:{href:base+row.oid}}})}))});
   }
   const actor=await credential(batch.operation==='upload');
   if(!(await env.API_LIMITER.limit({key:'lfs:'+await accountKeyFor(actor.userId)})).success)return response({message:'LFS request limit reached'},429);
   const rows=await project.lfsBatch(batch.operation,batch.objects,actor);
   await credential(batch.operation==='upload');
   const base=url.origin+url.pathname.slice(0,url.pathname.length-'batch'.length);
   return response({transfer:'basic',hash_algo:'sha256',objects:rows.map(row=>({oid:row.oid,size:row.size,...(row.error?{error:row.error}:row.exists?(batch.operation==='download'?{actions:{download:{href:base+row.oid}}}:{}):{actions:{upload:{href:base+row.oid},verify:{href:base+row.oid+'/verify'}}})}))});
  }
  const verify=endpoint.endsWith('/verify'),oid=endpoint.slice(0,64);
  if(endpoint.endsWith('/reconcile')){if(request.method!=='POST')return response({message:'Method not allowed'},405);const actor=await credential(true),result=await project.lfsReconcile(oid,actor);await credential(true);return response(result,result.reconciled?200:409);}
  if(verify){if(request.method!=='POST')return response({message:'Method not allowed'},405);const actor=await credential(true),input=await readRequestJson<LfsObjectRef>(request,4096);if(input.oid!==oid)return response({message:'LFS verification identity mismatch'},400);await project.lfsVerify(input,actor);await credential(true);return response({});}
  if(request.method==='PUT'){
   const actor=await credential(true),sizeHeader=request.headers.get('Content-Length');
   if(sizeHeader!==null&&!/^\d+$/.test(sizeHeader))return response({message:'Invalid LFS content length'},400);
   const size=sizeHeader===null?undefined:Number(sizeHeader);if(size!==undefined&&(!Number.isSafeInteger(size)||size>LFS_HTTP_OBJECT_BYTES))return response({message:'LFS object exceeds the size limit'},413);
   const body=request.body??new ReadableStream<Uint8Array>({start(controller){controller.close();}});
   await project.lfsUpload({oid,...(size===undefined?{}:{size})},body,actor);await credential(true);return response({});
  }
  if(request.method==='GET'){
   const object=!request.headers.has('Authorization')&&taskId===null
    ? await project.lfsPublicDownload(oid,await publicProof([oid]))
    : await (async()=>{const actor=await credential(false),value=await project.lfsDownload(oid,actor);await credential(false);return value;})();
   return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  return response({message:'Method not allowed'},405);
 }catch(error){if(error instanceof RequestBodyError)return response({message:error.message},error.message==='Request body is too large'?413:400);return response({message:error instanceof LfsStorageError?error.message:'LFS operation is unavailable; retry the same object'},error instanceof LfsStorageError?error.status:503);}
}
