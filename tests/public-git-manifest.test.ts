import {expect,test} from "bun:test";
import {parsePublicGitManifest,publicGitResource} from "../src/server/public-git-manifest";
const pack=`objects/pack/pack-${"a".repeat(40)}`;
const value=()=>({commit:"a".repeat(40),tree:"b".repeat(40),objectCount:5,objectScope:"exact-accepted-reachable-closure",totalBytes:1,assets:["HEAD","info/refs","objects/info/packs",`${pack}.pack`,`${pack}.idx`].map(path=>({path,size:10,sha256:"c".repeat(64)}))});
function encode(input:ReturnType<typeof value>){let raw="";for(let i=0;i<5;i++){raw=JSON.stringify(input);const measured=input.assets.reduce((n,a)=>n+a.size,0)+new TextEncoder().encode(raw).byteLength;if(input.totalBytes===measured)return raw;input.totalBytes=measured;}throw new Error("fixture did not converge");}
test("strict Git manifest verifies paired assets and all retained bytes",()=>{
 const raw=encode(value()),manifest=parsePublicGitManifest(raw);expect(manifest.totalBytes).toBe(50+new TextEncoder().encode(raw).byteLength);
 for(const mutate of [(v:ReturnType<typeof value>)=>({...v,extra:true}),(v:ReturnType<typeof value>)=>({...v,objectCount:0}),(v:ReturnType<typeof value>)=>({...v,commit:"invalid"}),(v:ReturnType<typeof value>)=>({...v,assets:v.assets.map((a,i)=>i===4?{...a,path:"objects/pack/pack-deadbeef.idx"}:a)}),(v:ReturnType<typeof value>)=>({...v,assets:v.assets.map((a,i)=>i===4?{...a,path:"HEAD"}:a)}),(v:ReturnType<typeof value>)=>({...v,assets:v.assets.map(a=>({...a,extra:true}))})])expect(()=>parsePublicGitManifest(encode(mutate(value())))).toThrow();
 expect(()=>parsePublicGitManifest(raw.replace('"totalBytes":','"totalBytes":1,"unused":'))).toThrow();
 const oversized=value();oversized.assets[0]!.size=512*1024*1024;expect(()=>parsePublicGitManifest(encode(oversized))).toThrow();
});
test("Git allowlist supports ordinary clone discovery and rejects unrelated resources and push",()=>{
 const manifest=parsePublicGitManifest(encode(value()));
 for(const asset of manifest.assets)expect(publicGitResource({method:"GET",path:asset.path,query:new URLSearchParams()},manifest)).toEqual(asset);
 expect(publicGitResource({method:"GET",path:"info/refs",query:new URLSearchParams("service=git-upload-pack")},manifest).path).toBe("info/refs");
 for(const path of ["config","objects/info/alternates","objects/aa/123","../HEAD","/HEAD","./HEAD","objects//info/packs","%48EAD","objects\\info\\packs","git-upload-pack","git-receive-pack"])expect(()=>publicGitResource({method:"GET",path,query:new URLSearchParams()},manifest)).toThrow();
 for(const query of ["service=git-receive-pack","service=git-upload-pack&service=git-upload-pack","token=secret","service=git-upload-pack&extra=x"])expect(()=>publicGitResource({method:"GET",path:"info/refs",query:new URLSearchParams(query)},manifest)).toThrow();
 expect(()=>publicGitResource({method:"POST",path:"info/refs",query:new URLSearchParams()},manifest)).toThrow();
});
