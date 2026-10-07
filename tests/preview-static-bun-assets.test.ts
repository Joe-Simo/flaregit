import {expect,test} from 'bun:test';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bindBuildManifest,type BuildFile} from '../src/server/static-build-artifact';
import {createPreviewStorageManifest} from '../src/server/preview-storage-upload';

test('actual Bun HTML output preserves AVIF/OpenType assets through immutable preview manifests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-bun-assets-'));
 try{
  // Owned synthetic binary fixtures exercise build/byte preservation, not image/font rendering.
  const image=new Uint8Array([0,0,0,24,102,116,121,112,97,118,105,102,0,0,0,0,97,118,105,102,109,105,102,49]),font=new Uint8Array([79,84,84,79,0,0,0,0]);
  await Bun.write(join(root,'hero.avif'),image);await Bun.write(join(root,'type.otf'),font);
  await Bun.write(join(root,'font.ts'),'import fontUrl from "./type.otf";document.documentElement.dataset.fontUrl=fontUrl;');
  await Bun.write(join(root,'style.css'),'@font-face{font-family:owned;src:url("./type.otf")}body{font-family:owned}');
  await Bun.write(join(root,'index.html'),'<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><img src="./hero.avif" alt="Owned fixture"><script type="module" src="./font.ts"></script></body></html>');
  const child=Bun.spawn([process.execPath,'build',join(root,'index.html'),'--outdir',join(root,'out'),'--env=disable'],{stdout:'ignore',stderr:'pipe'});const [code,error]=await Promise.all([child.exited,new Response(child.stderr).text()]);if(code!==0)throw Error(error);
  const files:BuildFile[]=await Promise.all((await readdir(join(root,'out'))).map(async path=>({path,kind:'file' as const,bytes:new Uint8Array(await Bun.file(join(root,'out',path)).arrayBuffer())})));
  const avif=files.find(file=>file.path.endsWith('.avif')),otf=files.find(file=>file.path.endsWith('.otf'));expect(avif?.bytes).toEqual(image);expect(otf?.bytes).toEqual(font);
  const scope={attemptId:crypto.randomUUID(),projectId:'p123456789abc',incarnation:crypto.randomUUID(),commit:'a'.repeat(40),tree:'b'.repeat(40),policyDigest:'c'.repeat(64)};
  const html=new TextDecoder().decode(files.find(file=>file.path==='index.html')!.bytes);expect(html).toContain(avif!.path);expect(files.filter(file=>file.path.endsWith('.js')).some(file=>new TextDecoder().decode(file.bytes).includes(otf!.path))).toBe(true);
  const manifest=await bindBuildManifest('static',scope,files,'d'.repeat(64));expect(manifest.files.some(file=>file.path===avif?.path)).toBe(true);expect(manifest.files.some(file=>file.path===otf?.path)).toBe(true);
  const stored=await createPreviewStorageManifest({projectId:scope.projectId,incarnation:scope.incarnation,commit:scope.commit,accountKey:'e'.repeat(12)},manifest.files.map(file=>({path:file.path,size:file.size,sha256:file.digest})));expect(stored.assets.find(file=>file.path===avif?.path)?.sha256).toBe(manifest.files.find(file=>file.path===avif?.path)?.digest);expect(stored.assets.find(file=>file.path===otf?.path)?.sha256).toBe(manifest.files.find(file=>file.path===otf?.path)?.digest);
 }finally{await rm(root,{recursive:true,force:true});}
});
