import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retainWebAssets, exportWebAssetRelease, importVerifiedWebAssetRelease } from "../src/tooling/retained-web-assets";

test("an open old client loads its real lazy Bun chunk after successive rollouts; retention is bounded", async () => {
 const root = await mkdtemp(join(tmpdir(), "flaregit-assets-"));
 try {
  const cache = join(root, "cache"), src = join(root, "src"); await mkdir(src);
  let oldPath = "", oldBytes = "";
  for (let version = 0; version < 4; version++) {
   const out = join(root, `out${version}`);
   await writeFile(join(src, "entry.ts"), 'export const load = () => import("./lazy");');
   await writeFile(join(src, "lazy.ts"), `export const version = ${version};`);
   const result = await Bun.build({ entrypoints: [join(src, "entry.ts")], outdir: out, splitting: true, target: "browser", naming: {entry:"entry.js",chunk:"assets/[name]-[hash].[ext]"} });
   expect(result.success).toBe(true);
   const chunk = result.outputs.find(value => value.path.includes("/assets/")); expect(chunk).toBeDefined();
   if (version === 0) { oldPath = chunk!.path.slice(out.length + 1); oldBytes = await readFile(chunk!.path, "utf8"); }
   await writeFile(join(out, "index.html"), `current ${version}`);
   await writeFile(join(out, "secret.env"), "never retained");
   const retained = await retainWebAssets(out, result.outputs.map(value => value.path), cache, {priorGenerations:2,maxBytes:1024*1024});
   expect(retained.generations).toBe(Math.min(version + 1, 3));
   expect(await readFile(join(out,"index.html"),"utf8")).toBe(`current ${version}`);
   if (version > 0 && version < 3) expect(await readFile(join(out,oldPath),"utf8")).toBe(oldBytes);
   if (version === 3) expect(Bun.file(join(out,oldPath)).size).toBe(0);
   expect(await Bun.file(join(cache,"generations.json")).text()).not.toContain("secret.env");
  }
 } finally { await rm(root,{recursive:true,force:true}); }
});

test("changed bytes at an immutable URL fail rather than overwrite an older client asset", async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-assets-"));
 try {
  const cache=join(root,"cache"),out=join(root,"out");await mkdir(join(out,"assets"),{recursive:true});
  const path=join(out,"assets/lazy-12345678.js");await writeFile(path,"old");await retainWebAssets(out,[path],cache);
  await writeFile(path,"changed");await expect(retainWebAssets(out,[path],cache)).rejects.toThrow("collision");
 } finally {await rm(root,{recursive:true,force:true});}
});

test("byte budget evicts complete oldest generations and rejects an oversized current build", async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-assets-"));
 try {
  const cache=join(root,"cache");
  for(let i=0;i<3;i++){
   const out=join(root,`out${i}`);await mkdir(join(out,"assets"),{recursive:true});
   const path=join(out,`assets/lazy-0000000${i}.js`);await writeFile(path,"12345");
   const value=await retainWebAssets(out,[path],cache,{priorGenerations:3,maxBytes:10});
   expect(value.generations).toBe(Math.min(i+1,2));expect(value.bytes).toBeLessThanOrEqual(10);
  }
  const out=join(root,"huge");await mkdir(join(out,"assets"),{recursive:true});const path=join(out,"assets/huge-12345678.js");await writeFile(path,"12345678901");
  await expect(retainWebAssets(out,[path],cache,{priorGenerations:3,maxBytes:10})).rejects.toThrow("budget");
  expect(JSON.parse(await readFile(join(cache,"generations.json"),"utf8"))).toHaveLength(2);
 } finally {await rm(root,{recursive:true,force:true});}
});

test("cached corruption fails closed; unhashed worker, source maps and private files never enter history", async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-assets-"));
 try {
  const cache=join(root,"cache"),out=join(root,"out");await mkdir(join(out,"assets"),{recursive:true});
  const path=join(out,"assets/lazy-12345678.js"),excluded=["diff.worker.js","assets/lazy-12345678.js.map","assets/token-12345678.json"];
  await writeFile(path,"old");for(const file of excluded)await writeFile(join(out,file),"private");
  await retainWebAssets(out,[path,...excluded.map(file=>join(out,file))],cache);
  const generations=JSON.parse(await readFile(join(cache,"generations.json"),"utf8")) as {id:string;files:{path:string}[]}[];
  expect(generations[0]!.files.map(file=>file.path)).toEqual(["assets/lazy-12345678.js"]);
  await writeFile(join(cache,generations[0]!.id,"assets/lazy-12345678.js"),"bad");
  const next=join(root,"next");await mkdir(join(next,"assets"),{recursive:true});const nextPath=join(next,"assets/lazy-87654321.js");await writeFile(nextPath,"new");
  await expect(retainWebAssets(next,[nextPath],cache)).rejects.toThrow("integrity");
 }finally{await rm(root,{recursive:true,force:true});}
});

test("cold build imports pinned owned release, keeps old lazy asset and current HTML, rejects tampering",async()=>{
 const root=await mkdtemp(join(tmpdir(),"flaregit-assets-"));
 try{
  const old=join(root,"release"),next=join(root,"next"),cache=join(root,"cold-cache"),manifest=join(root,"owned.json"),source="a".repeat(40);
  await mkdir(join(old,"assets"),{recursive:true});await mkdir(join(next,"assets"),{recursive:true});
  const oldPath=join(old,"assets/lazy-12345678.js");await writeFile(oldPath,"old lazy code");await writeFile(join(old,"index.html"),"old index");
  const receipt=await exportWebAssetRelease(old,[oldPath,join(old,"index.html")],source,manifest);
  await importVerifiedWebAssetRelease({manifestPath:manifest,manifestSha256:receipt.manifestSha256,source,assetsDir:old},cache);
  const nextPath=join(next,"assets/lazy-87654321.js");await writeFile(nextPath,"new code");await writeFile(join(next,"index.html"),"new index");
  await retainWebAssets(next,[nextPath],cache);
  expect(await readFile(join(next,"assets/lazy-12345678.js"),"utf8")).toBe("old lazy code");expect(await readFile(join(next,"index.html"),"utf8")).toBe("new index");
  await expect(importVerifiedWebAssetRelease({manifestPath:manifest,manifestSha256:"0".repeat(64),source,assetsDir:old},cache)).rejects.toThrow("manifest digest");
  await expect(importVerifiedWebAssetRelease({manifestPath:manifest,manifestSha256:receipt.manifestSha256,source:"b".repeat(40),assetsDir:old},cache)).rejects.toThrow("source mismatch");
  await writeFile(oldPath,"injected code");await expect(importVerifiedWebAssetRelease({manifestPath:manifest,manifestSha256:receipt.manifestSha256,source,assetsDir:old},cache)).rejects.toThrow("integrity");
 }finally{await rm(root,{recursive:true,force:true});}
});
