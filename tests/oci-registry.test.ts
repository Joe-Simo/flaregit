import {test,expect} from 'bun:test';
import {createOciStore,ociDigest,OCI_CATALOG_ROW_LIMIT,OCI_UPLOAD_ROW_LIMIT} from '../src/core/oci-store';
import {handleOciRegistryCall,type OciRegistryCall} from '../src/server/oci-registry';
const bytes=(s:string)=>new TextEncoder().encode(s);
test('OCI binary upload, immutable manifest tag, private reads and live permissions',async()=>{
 const store=createOciStore();
 const call=(path:string,method='GET',body=new Uint8Array(0),extra:Partial<OciRegistryCall>={})=>handleOciRegistryCall(store,{url:'http://localhost/v2/alice/image/'+path,method,body,userId:'owner',namespaces:['alice'],canPublish:true,private:true,...extra});
 const data=new Uint8Array([0,255,128,10]),digest=await ociDigest(data);
 const start=await call('blobs/uploads/','POST');expect(start.status).toBe(202);const upload=start.headers.Location!.split('/').at(-1)!;
 expect((await call('blobs/uploads/'+upload,'PATCH',data)).status).toBe(202);
 expect((await call('blobs/uploads/'+upload+'?digest=sha256:'+'0'.repeat(64),'PUT')).status).toBe(400);
 expect((await call('blobs/uploads/'+upload+'?digest='+digest,'PUT')).status).toBe(201);
 expect((await call('blobs/'+digest,'GET',undefined,{userId:undefined})).status).toBe(401);
 expect((await call('blobs/'+digest)).body).toEqual(data);
 const mediaType='application/vnd.oci.image.manifest.v1+json';
 const manifest=bytes(JSON.stringify({schemaVersion:2,mediaType,config:{digest,size:data.length,mediaType:'application/vnd.oci.image.config.v1+json'},layers:[]}));
 expect((await call('manifests/1.0.0','PUT',manifest,{contentType:mediaType})).status).toBe(201);
 expect((await call('manifests/1.0.0','PUT',manifest,{contentType:mediaType})).status).toBe(201);
 const changed=bytes(JSON.stringify({...JSON.parse(new TextDecoder().decode(manifest)),annotations:{changed:'yes'}}));
 expect((await call('manifests/1.0.0','PUT',changed,{contentType:mediaType})).status).toBe(409);
 expect((await call('manifests/1.0.0','GET',undefined,{userId:'reader',memberOf:['owner']})).status).toBe(200);
 expect((await call('blobs/uploads/','POST',undefined,{canPublish:false})).status).toBe(403);
 expect((await call('blobs/uploads/','POST',undefined,{namespaces:['other']})).status).toBe(403);
 expect((await call('blobs/uploads/','POST',undefined,{userId:'intruder'})).status).toBe(403);
 const item=store.objects.get('alice/image@'+digest)!;store.objects.set('alice/image@'+digest,{...item,data:btoa('bad')});expect((await call('blobs/'+digest)).status).toBe(500);
});
test('OCI rejects absent descriptor content and digest mismatch, bounds uploads',async()=>{
 const store=createOciStore();const body=bytes('{}');
 const call=(path:string,method:string,data=body)=>handleOciRegistryCall(store,{url:'http://localhost/v2/a/image/'+path,method,body:data,userId:'a',namespaces:['a'],canPublish:true});
 expect((await call('blobs/uploads/?digest=sha256:'+'0'.repeat(64),'POST')).status).toBe(400);
 expect((await call('blobs/uploads/','POST',new Uint8Array(10*1024*1024+1))).status).toBe(413);
 for(let i=0;i<32;i++)expect((await call('blobs/uploads/','POST')).status).toBe(202);
 expect((await call('blobs/uploads/','POST')).status).toBe(429);
});

test.skipIf(!Bun.env.FLAREGIT_ORAS_BIN)('stock ORAS pushes and pulls private binary content and rejects revoked credentials', async () => {
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
 const store=createOciStore();let active=true;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const credential=request.headers.get('Authorization');
  if(credential&&(!active||credential!==`Basic ${btoa('alice:local-oci-proof')}`))return new Response('Revoked',{status:401,headers:{'WWW-Authenticate':'Basic realm="FlareGit registry"'}});
  const response=await handleOciRegistryCall(store,{url:request.url,method:request.method,body:new Uint8Array(await request.arrayBuffer()),contentType:request.headers.get('Content-Type')??undefined,...(credential?{userId:'owner',namespaces:['alice'],canPublish:true,private:true}:{})});
  if(response.status===401)response.headers['WWW-Authenticate']='Basic realm="FlareGit registry"';
  return new Response(request.method==='HEAD'||response.status===204?null:response.body,{status:response.status,headers:response.headers});
 }});
 const directory=await mkdtemp(join(tmpdir(),'flaregit-oci-'));const destination=join(directory,'pull');
 try{
  await mkdir(destination);const binary=new Uint8Array([0,255,128,10,0,13]);await writeFile(join(directory,'binary.dat'),binary);
  const target=`127.0.0.1:${server.port}/alice/image:1.0.0`;
  const run=async(args:string[],cwd=directory)=>{const process=Bun.spawn([Bun.env.FLAREGIT_ORAS_BIN!,...args,'--plain-http','--username','alice','--password-stdin'],{cwd,stdin:'pipe',stdout:'pipe',stderr:'pipe'});process.stdin.write('local-oci-proof');process.stdin.end();const [output,error,code]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);return{code,output:output+error};};
  const pushed=await run(['push',target,'binary.dat']);expect(pushed.output).not.toContain('Error');expect(pushed.code).toBe(0);
  const pulled=await run(['pull',target],destination);expect(pulled.output).not.toContain('Error');expect(pulled.code).toBe(0);
  expect(new Uint8Array(await Bun.file(join(destination,'binary.dat')).arrayBuffer())).toEqual(binary);
  active=false;expect((await run(['manifest','fetch',target])).code).not.toBe(0);
 }finally{server.stop(true);await rm(directory,{recursive:true,force:true});}
},30000);

test('OCI durable restart preserves private namespace, upload and immutable tag',async()=>{
 const {Database}=await import('bun:sqlite');
 const db=new Database(':memory:');
 const sql: import('../src/core/durable-stores').SqlLike={exec(query:string,...bindings:unknown[]){const statement=db.query(query);if(/^\s*select/i.test(query)){const rows=statement.all(...bindings as never[]);return{toArray:()=>rows};}statement.run(...bindings as never[]);return{toArray:()=>[]};}};
 try{
 const store=createOciStore(sql);const data=bytes('{}'),digest=await ociDigest(data);
 const upload=await handleOciRegistryCall(store,{method:'POST',url:'http://registry/v2/alice/image/blobs/uploads/?digest='+digest,body:data,userId:'owner',namespaces:['alice'],canPublish:true,private:true});expect(upload.status).toBe(201);
 const restarted=createOciStore(sql);
 expect(restarted.repositories.get('alice/image')).toEqual({ownerId:'owner',private:true});
 const read=await handleOciRegistryCall(restarted,{method:'GET',url:'http://registry/v2/alice/image/blobs/'+digest,body:new Uint8Array(0),userId:'owner'});expect(read.status).toBe(200);expect(read.body).toEqual(data);
 expect((await handleOciRegistryCall(restarted,{method:'GET',url:'http://registry/v2/bob/image/blobs/'+digest,body:new Uint8Array(0),userId:'owner'})).status).toBe(404);
 }finally{db.close();}
});

test('OCI manifest bytes uploaded as a blob remain pullable after manifest publication',async()=>{
 const store=createOciStore();const config=bytes('{}'),configDigest=await ociDigest(config),mediaType='application/vnd.oci.image.manifest.v1+json';
 const manifest=bytes(JSON.stringify({schemaVersion:2,mediaType,config:{digest:configDigest,size:config.length,mediaType:'application/vnd.oci.image.config.v1+json'},layers:[]}));
 const call=(path:string,method:string,body:Uint8Array<ArrayBuffer>,contentType?:string)=>handleOciRegistryCall(store,{url:'http://registry/v2/alice/image/'+path,method,body,contentType,userId:'owner',namespaces:['alice'],canPublish:true});
 expect((await call('blobs/uploads/?digest='+configDigest,'POST',config)).status).toBe(201);
 expect((await call('blobs/uploads/?digest='+await ociDigest(manifest),'POST',manifest)).status).toBe(201);
 expect((await call('manifests/1.0.0','PUT',manifest,mediaType)).status).toBe(201);
 const manifestDigest=await ociDigest(manifest),manifestRead=await call('manifests/1.0.0','GET',new Uint8Array(0));expect(manifestRead.body).toEqual(manifest);expect(manifestRead.headers['Content-Type']).toBe(mediaType);
 expect((await call('blobs/'+manifestDigest,'GET',new Uint8Array(0))).headers['Content-Type']).toBe('application/octet-stream');
 expect((await call('blobs/uploads/?digest='+manifestDigest,'POST',manifest)).status).toBe(201);
 expect((await call('manifests/'+manifestDigest,'GET',new Uint8Array(0))).body).toEqual(manifest);

});

test('durable OCI catalogs reject new tiny rows at admission while updates and existing enumeration remain available',async()=>{
 const {Database}=await import('bun:sqlite'),db=new Database(':memory:');
 const sql:import('../src/core/durable-stores').SqlLike={exec(query:string,...bindings:unknown[]){const statement=db.query(query);if(/^\s*select/i.test(query))return {toArray:()=>statement.all(...bindings as never[])};statement.run(...bindings as never[]);return {toArray:()=>[]};}};
 try{
  const store=createOciStore(sql),object={data:'',mediaType:'application/octet-stream',size:0},repository={ownerId:'owner',private:false},upload={ownerId:'owner',repository:'alice/image',data:'',size:0,expires:Date.now()+60000};
  const seed=(namespace:string,value:unknown,limit:number)=>db.query("WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<?) INSERT INTO kv(ns,k,v) SELECT ?,'key-'||n,? FROM sequence").run(limit,namespace,JSON.stringify(value));
  seed('ociRepositories',repository,OCI_CATALOG_ROW_LIMIT);seed('ociObjects',object,OCI_CATALOG_ROW_LIMIT);seed('ociTags','sha256:'+'a'.repeat(64),OCI_CATALOG_ROW_LIMIT);seed('ociUploads',upload,OCI_UPLOAD_ROW_LIMIT);
  const boundary=<T>(map:{set(key:string,value:T):void;entries():Array<[string,T]>},value:T,limit:number)=>{
   expect(()=>map.set('one-more',value)).toThrow('admission');map.set('key-1',value);expect(map.entries().length).toBe(limit);
  };
  boundary(store.repositories,repository,OCI_CATALOG_ROW_LIMIT);boundary(store.objects,object,OCI_CATALOG_ROW_LIMIT);boundary(store.tags,'sha256:'+'a'.repeat(64),OCI_CATALOG_ROW_LIMIT);boundary(store.uploads,upload,OCI_UPLOAD_ROW_LIMIT);
  const restarted=createOciStore(sql);expect(restarted.objects.entries().length).toBe(OCI_CATALOG_ROW_LIMIT);expect(restarted.uploads.entries().length).toBe(OCI_UPLOAD_ROW_LIMIT);
  db.query("UPDATE kv SET k='alice/image' WHERE ns='ociRepositories' AND k='key-1'").run();db.query("DELETE FROM kv WHERE ns='ociUploads'").run();
  const content=bytes('new tiny object'),digest=await ociDigest(content),reply=await handleOciRegistryCall(restarted,{url:'http://registry/v2/alice/image/blobs/uploads/?digest='+digest,method:'POST',body:content,userId:'owner',namespaces:['alice'],canPublish:true});expect(reply.status).toBe(507);expect(restarted.objects.entries().length).toBe(OCI_CATALOG_ROW_LIMIT);
  expect((await handleOciRegistryCall(restarted,{url:'http://registry/v2/alice/image/tags/list',method:'GET',body:new Uint8Array(0)})).status).toBe(200);
 }finally{db.close();}
});
test('durable OCI blob and manifest representations coexist through restart',async()=>{
 const {Database}=await import('bun:sqlite'),db=new Database(':memory:');
 const sql:import('../src/core/durable-stores').SqlLike={exec(query:string,...bindings:unknown[]){const statement=db.query(query);if(/^\s*select/i.test(query))return {toArray:()=>statement.all(...bindings as never[])};statement.run(...bindings as never[]);return {toArray:()=>[]};}};
 try{
  let store=createOciStore(sql);const config=bytes('{}'),configDigest=await ociDigest(config),mediaType='application/vnd.oci.image.manifest.v1+json',manifest=bytes(JSON.stringify({schemaVersion:2,mediaType,config:{digest:configDigest,size:config.length,mediaType:'application/vnd.oci.image.config.v1+json'},layers:[]})),digest=await ociDigest(manifest);
  const call=(path:string,method:string,body=new Uint8Array(0),contentType?:string)=>handleOciRegistryCall(store,{url:'http://registry/v2/alice/image/'+path,method,body,contentType,userId:'owner',namespaces:['alice'],canPublish:true});
  expect((await call('blobs/uploads/?digest='+configDigest,'POST',config)).status).toBe(201);expect((await call('blobs/uploads/?digest='+digest,'POST',manifest)).status).toBe(201);expect((await call('manifests/v1','PUT',manifest,mediaType)).status).toBe(201);
  store=createOciStore(sql);const pulled=await call('manifests/v1','GET');expect(pulled.body).toEqual(manifest);expect(pulled.headers['Content-Type']).toBe(mediaType);
  const blob=await call('blobs/'+digest,'GET');expect(blob.body).toEqual(manifest);expect(blob.headers['Content-Type']).toBe('application/octet-stream');expect(store.objects.entries().length).toBe(2);
 }finally{db.close();}
});
