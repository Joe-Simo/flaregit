import {expect,test} from "bun:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPublicGitExport} from "../src/server/public-git-export";
import {createAcceptedBundle,type BundleExecutor} from "../src/server/private-recovery-bundle";
test("ordinary native HTTP clone preserves accepted ancestry and excludes private candidate objects",async()=>{
 const root=await mkdtemp(join(tmpdir(),"public-git-fixture-")),directory=`/tmp/flaregit-private-recovery-${crypto.randomUUID()}`,repo=join(root,"repo"),remote=`https://${"a".repeat(32)}.artifacts.cloudflare.net/synthetic.git`;
 const contaminatedDirectory=`/tmp/flaregit-private-recovery-${crypto.randomUUID()}`;
 const native:BundleExecutor={async exec(argv,options){const proc=Bun.spawn(argv,{env:{...process.env,...options?.env},stdout:"pipe",stderr:"pipe"});const [stdout,stderr,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);return {success:code===0,stdout,stderr};}};
 const git=async(...args:string[])=>{const result=await native.exec(["git",...args]);if(!result.success)throw new Error(result.stderr);return result.stdout.trim();};
 let server:ReturnType<typeof Bun.serve>|undefined;
 try{
  await git("init","-q","-b","main",repo);await git("-C",repo,"config","user.name","Synthetic author");await git("-C",repo,"config","user.email","author@example.invalid");
  for(const value of ["one","two"]){await Bun.write(join(repo,"accepted.txt"),value);await git("-C",repo,"add",".");await git("-C",repo,"commit","-qm",value);}
  const commit=await git("-C",repo,"rev-parse","HEAD"),tree=await git("-C",repo,"rev-parse","HEAD^{tree}");
  await git("-C",repo,"checkout","-qb","private-candidate");await Bun.write(join(repo,"private.txt"),"synthetic private candidate");await git("-C",repo,"add",".");await git("-C",repo,"commit","-qm","private");const privateBlob=await git("-C",repo,"rev-parse","HEAD:private.txt");
  const executor:BundleExecutor={async exec(argv,options){
   if(argv.includes("fetch"))return native.exec(argv.map(value=>value===remote?repo:value==="protocol.https.allow=always"?"protocol.file.allow=always":value),options);
   if(argv[0]==="stat")return {success:true,stdout:String(Bun.file(argv[3]!).size),stderr:""};
   if(argv[0]==="sha256sum")return native.exec(["shasum","-a","256",argv[1]!],options);
   return native.exec(argv,options);
  }};
  const bundle=await createAcceptedBundle(executor,{remote,token:"synthetic",commit,tree,directory});
  const contaminatedBundle=await createAcceptedBundle(executor,{remote,token:"synthetic",commit,tree,directory:contaminatedDirectory});
  const contaminated:BundleExecutor={async exec(argv,options){const result=await executor.exec(argv,options);if(result.success&&argv.includes("repack")){await git("--git-dir",`${contaminatedDirectory}/public.git`,"hash-object","-w",join(repo,"private.txt"));}return result;}};
  await expect(createPublicGitExport(contaminated,{bundle:contaminatedBundle,directory:contaminatedDirectory})).rejects.toThrow("nothing was published");
  const result=await createPublicGitExport(executor,{bundle,directory});expect(result.totalBytes).toBe(result.assets.reduce((sum,item)=>sum+item.size,0)+new TextEncoder().encode(result.manifest).byteLength);expect(result.totalBytes).toBeLessThanOrEqual(512*1024*1024);
  const requests:string[]=[];
  server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){const url=new URL(request.url),path=url.pathname.replace(/^\/accepted.git\//,"");requests.push(path);const asset=result.assets.find(item=>item.path===path);return asset?new Response(Bun.file(asset.file),{headers:{"Content-Type":"application/octet-stream"}}):new Response("Not found",{status:404});}});
  const clone=join(root,"clone");await git("-c","init.defaultBranch=master","clone","-q",`${server.url.origin}/accepted.git`,clone);await git("-C",clone,"fsck","--full");expect(await git("-C",clone,"rev-parse","HEAD")).toBe(commit);expect(await git("-C",clone,"rev-parse","--is-shallow-repository")).toBe("false");expect(await git("-C",clone,"rev-list","--count","HEAD")).toBe("2");expect(await git("-C",clone,"log","-1","--format=%an <%ae>")).toBe("Synthetic author <author@example.invalid>");
  expect((await native.exec(["git","-C",clone,"cat-file","-e",privateBlob])).success).toBe(false);expect(await Bun.file(join(clone,"private.txt")).exists()).toBe(false);expect(requests).toContain("info/refs");expect(requests.some(path=>path.endsWith(".pack"))).toBe(true);
 }finally{server?.stop(true);await rm(root,{recursive:true,force:true});await rm(directory,{recursive:true,force:true});await rm(contaminatedDirectory,{recursive:true,force:true});}
},30000);
