/** OCI Distribution push/pull subset: sha256 blobs, chunked/monolithic uploads,
 * image manifests/indexes, immutable tags and discovery. No deletion or cross-repository mount.
 * https://github.com/opencontainers/distribution-spec/blob/main/spec.md */
import {decodeOciBytes,encodeOciBytes,ociDigest,type OciStore,type OciObject} from '../core/oci-store';
export const OCI_MAX_BYTES=10*1024*1024;
const CAPACITY=128*1024*1024;
const ROW_CAPACITY=9000;
export interface OciRegistryCall {method:string;url:string;body:Uint8Array<ArrayBuffer>;contentType?:string;userId?:string;namespaces?:readonly string[];memberOf?:readonly string[];canPublish?:boolean;private?:boolean;contentRange?:string}
export interface OciRegistryReply {status:number;headers:Record<string,string>;body:string|Uint8Array<ArrayBuffer>}
const digestPattern=/^sha256:[a-f0-9]{64}$/;
const mediaTypes=new Set(['application/vnd.oci.image.manifest.v1+json','application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.v2+json','application/vnd.docker.distribution.manifest.list.v2+json']);
const reply=(status:number,body:string|Uint8Array<ArrayBuffer>='',headers:Record<string,string>={}):OciRegistryReply=>({status,body,headers:{'Docker-Distribution-API-Version':'registry/2.0',...headers}});
const error=(status:number,code:string,message:string)=>reply(status,JSON.stringify({errors:[{code,message}]}),{'Content-Type':'application/json'});
const object=(v:unknown):Record<string,unknown>|undefined=>typeof v==='object'&&v!==null&&!Array.isArray(v)?v as Record<string,unknown>:undefined;
export async function handleOciRegistryCall(store:OciStore,call:OciRegistryCall):Promise<OciRegistryReply>{
 const url=new URL(call.url),method=call.method;
 if(url.pathname==='/v2/'||url.pathname==='/v2')return method==='GET'?reply(200,'{}',{'Content-Type':'application/json'}):error(405,'UNSUPPORTED','Method not supported');
 const match=/^\/v2\/([a-z0-9]+(?:(?:[._-]+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._-]+)[a-z0-9]+)*)*)\/(blobs|manifests|tags)\/(.*)$/.exec(url.pathname);
 if(!match||match[1]!.length>255)return error(404,'NAME_UNKNOWN','Repository not found');
 const name=match[1]!,kind=match[2]!,ref=match[3]!,namespace=name.split('/')[0]!;
 const repository=store.repositories.get(name),writing=!['GET','HEAD'].includes(method);
 if(writing){if(!call.userId)return error(401,'UNAUTHORIZED','Authentication required');if(!call.canPublish||!(call.namespaces??[]).includes(namespace))return error(403,'DENIED','Repository publish scope required');if(repository&&repository.ownerId!==call.userId)return error(403,'DENIED','Repository belongs to another owner');}
 else if(repository?.private&&repository.ownerId!==call.userId&&!(call.memberOf??[]).includes(repository.ownerId))return call.userId ? error(404,'NAME_UNKNOWN','Repository not found') : reply(401,JSON.stringify({errors:[{code:'UNAUTHORIZED',message:'Authentication required'}]}),{'Content-Type':'application/json','WWW-Authenticate':'Basic realm="FlareGit registry"'});
 if(call.body.byteLength>OCI_MAX_BYTES)return error(413,'SIZE_INVALID','Maximum object size is 10 MiB');
 if(writing && !repository && store.repositories.entries().length>=ROW_CAPACITY)return error(507,'SIZE_INVALID','Repository catalog capacity reached');
 const now=Date.now();for(const [id,upload]of store.uploads.entries())if(upload.expires<=now)store.uploads.delete(id);
 const usedBytes=()=>store.objects.entries().reduce((sum,[,value])=>sum+value.size,0)+store.uploads.entries().reduce((sum,[,value])=>sum+value.size,0);
 const key=(digest:string)=>name+'@'+digest;
 const location=(path:string)=>url.origin+'/v2/'+name+'/'+path;
 const save=(digest:string,bytes:Uint8Array<ArrayBuffer>,mediaType:string):boolean=>{const existing=store.objects.get(key(digest));if(existing){if(existing.size!==bytes.length||existing.data!==encodeOciBytes(bytes))return false;if(mediaTypes.has(mediaType)&&!mediaTypes.has(existing.mediaType))store.objects.set(key(digest),{...existing,mediaType});return true;}if(store.objects.entries().length>=ROW_CAPACITY)return false;const used=store.objects.entries().reduce((sum,[,v])=>sum+v.size,0)+store.uploads.entries().reduce((sum,[,v])=>sum+v.size,0);if(used+bytes.length>CAPACITY)return false;store.objects.set(key(digest),{data:encodeOciBytes(bytes),size:bytes.length,mediaType});return true;};
 if(kind==='tags'&&ref==='list'&&method==='GET'){if(!repository)return error(404,'NAME_UNKNOWN','Repository not found');const tags=store.tags.entries().filter(([k])=>k.startsWith(name+'@')).map(([k])=>k.slice(name.length+1)).sort();return reply(200,JSON.stringify({name,tags}),{'Content-Type':'application/json'});}
 if(kind==='blobs'&&ref.startsWith('uploads/')){
  const id=ref.slice('uploads/'.length);
  if(method==='POST'&&!id){if(usedBytes()+call.body.length>CAPACITY)return error(507,'SIZE_INVALID','Registry capacity reached');if(store.uploads.entries().length>=32)return error(429,'TOOMANYREQUESTS','Upload capacity reached');if(!repository)store.repositories.set(name,{ownerId:call.userId!,private:call.private===true});const supplied=url.searchParams.get('digest');if(supplied){if(!digestPattern.test(supplied)||await ociDigest(call.body)!==supplied)return error(400,'DIGEST_INVALID','Digest mismatch');if(!save(supplied,call.body,'application/octet-stream'))return error(507,'SIZE_INVALID','Registry capacity reached');return reply(201,'',{'Location':location('blobs/'+supplied),'Docker-Content-Digest':supplied});}const newId=crypto.randomUUID();store.uploads.set(newId,{ownerId:call.userId!,repository:name,data:encodeOciBytes(call.body),size:call.body.length,expires:now+3600000});return reply(202,'',{'Location':location('blobs/uploads/'+newId),'Range':'0-'+Math.max(0,call.body.length-1),'Docker-Upload-UUID':newId});}
  const upload=store.uploads.get(id);if(!upload||upload.repository!==name||upload.ownerId!==call.userId)return error(404,'BLOB_UPLOAD_UNKNOWN','Upload not found');
  if(method==='DELETE'){store.uploads.delete(id);return reply(204);}
  if(method==='GET')return reply(204,'',{'Location':location('blobs/uploads/'+id),'Range':'0-'+Math.max(0,upload.size-1)});
  if(method!=='PATCH'&&method!=='PUT')return error(405,'UNSUPPORTED','Method not supported');
  if(upload.size+call.body.length>OCI_MAX_BYTES)return error(413,'SIZE_INVALID','Maximum object size is 10 MiB');
  if(call.contentRange&&call.contentRange!==upload.size+'-'+(upload.size+call.body.length-1))return error(416,'RANGE_INVALID','Upload range mismatch');
  const bytes=new Uint8Array(upload.size+call.body.length);bytes.set(decodeOciBytes(upload.data));bytes.set(call.body,upload.size);
  if(method==='PATCH'){if(usedBytes()+call.body.length>CAPACITY)return error(507,'SIZE_INVALID','Registry capacity reached');store.uploads.set(id,{...upload,data:encodeOciBytes(bytes),size:bytes.length});return reply(202,'',{'Location':location('blobs/uploads/'+id),'Range':'0-'+Math.max(0,bytes.length-1)});}
  const digest=url.searchParams.get('digest');if(!digest||!digestPattern.test(digest)||await ociDigest(bytes)!==digest)return error(400,'DIGEST_INVALID','Digest mismatch');store.uploads.delete(id);if(!save(digest,bytes,'application/octet-stream'))return error(507,'SIZE_INVALID','Registry capacity reached');return reply(201,'',{'Location':location('blobs/'+digest),'Docker-Content-Digest':digest});
 }
 if(kind==='manifests'&&method==='PUT'){
  if(!digestPattern.test(ref)&&! /^[\w][\w.-]{0,127}$/.test(ref))return error(400,'TAG_INVALID','Invalid tag');
  const mediaType=call.contentType?.split(';')[0]??'';if(!mediaTypes.has(mediaType))return error(415,'MANIFEST_INVALID','Unsupported manifest media type');
  let manifest:Record<string,unknown>|undefined;try{manifest=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(call.body)));}catch{return error(400,'MANIFEST_INVALID','Invalid JSON');}
  if(!manifest||manifest.schemaVersion!==2||manifest.mediaType!==mediaType)return error(400,'MANIFEST_INVALID','Manifest schema/media type mismatch');
  const descriptors=mediaType.includes('index')||mediaType.includes('list')?manifest.manifests:manifest.layers;
  if(!Array.isArray(descriptors)||descriptors.length>1000)return error(400,'MANIFEST_INVALID','Invalid descriptors');
  const refs=[...descriptors,...(manifest.config===undefined?[]:[manifest.config])];if(!mediaType.includes('index')&&!mediaType.includes('list')&&!manifest.config)return error(400,'MANIFEST_INVALID','Config required');
  for(const raw of refs){const d=object(raw);if(!d||typeof d.digest!=='string'||!digestPattern.test(d.digest)||!Number.isSafeInteger(d.size)||typeof d.mediaType!=='string')return error(400,'MANIFEST_INVALID','Invalid descriptor');const stored=store.objects.get(key(d.digest));if(!stored||stored.size!==d.size)return error(400,'MANIFEST_BLOB_UNKNOWN','Referenced content missing');}
  const digest=await ociDigest(call.body);if(digestPattern.test(ref)&&ref!==digest)return error(400,'DIGEST_INVALID','Manifest digest mismatch');
  const previous=store.tags.get(key(ref));if(!digestPattern.test(ref)&&!previous&&store.tags.entries().length>=ROW_CAPACITY)return error(507,'SIZE_INVALID','Tag catalog capacity reached');if(previous&&previous!==digest)return error(409,'DENIED','Tags are immutable');
  if(!save(digest,call.body,mediaType))return error(507,'SIZE_INVALID','Registry capacity reached');if(!repository)store.repositories.set(name,{ownerId:call.userId!,private:call.private===true});if(!digestPattern.test(ref))store.tags.set(key(ref),digest);return reply(201,'',{'Location':location('manifests/'+digest),'Docker-Content-Digest':digest});
 }
 if((kind==='blobs'||kind==='manifests')&&(method==='GET'||method==='HEAD')){
  const digest=digestPattern.test(ref)?ref:kind==='manifests'?store.tags.get(key(ref)):undefined;const stored:OciObject|undefined=digest?store.objects.get(key(digest)):undefined;
  if(!stored||!digest||kind==='manifests'&&!mediaTypes.has(stored.mediaType))return error(404,kind==='blobs'?'BLOB_UNKNOWN':'MANIFEST_UNKNOWN','Content not found');const bytes=decodeOciBytes(stored.data);if(bytes.length!==stored.size||await ociDigest(bytes)!==digest)return error(500,'UNKNOWN','Stored content failed digest verification');return reply(200,method==='HEAD'?'':bytes,{'Content-Type':stored.mediaType,'Content-Length':String(bytes.length),'Docker-Content-Digest':digest});
 }
 return error(405,'UNSUPPORTED','Method not supported');
}
