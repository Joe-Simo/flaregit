import { type createAcceptedBundle, MAX_BUNDLE_BYTES, type BundleExecutor } from "./private-recovery-bundle";
import { q } from "./shell";
export interface PublicGitExportAsset { path: string; file: string; size: number; sha256: string }
/** Dormant native preparation only. No upload, route, owner consent mutation or publication. */
export async function createPublicGitExport(executor: BundleExecutor, input: {directory:string;bundle:Awaited<ReturnType<typeof createAcceptedBundle>>}) {
  const bundle = input.bundle;
  if (!/^\/tmp\/flaregit-private-recovery-[a-f0-9-]{36}$/.test(input.directory) || bundle.path !== `${input.directory}/repository.bundle` || !/^[a-f0-9]{40}$/.test(bundle.commit) || !/^[a-f0-9]{40}$/.test(bundle.tree) || !/^[a-f0-9]{64}$/.test(bundle.sha256) || !Number.isSafeInteger(bundle.size) || bundle.size < 1 || bundle.size > MAX_BUNDLE_BYTES || !Number.isSafeInteger(bundle.objectCount) || bundle.objectCount < 1) throw new Error("Invalid verified accepted bundle scope");
  const repo = `${input.directory}/public.git`;
  const env = {GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_SYSTEM:"/dev/null",GIT_CONFIG_NOSYSTEM:"1",GIT_TERMINAL_PROMPT:"0",GIT_CONFIG_COUNT:"0"};
  const run=async(argv:string[])=>{const result=await executor.exec(argv,{env,timeoutMs:120000});if(!result.success)throw new Error("Public Git preparation failed; nothing was published");return result.stdout.trim();};
  if ((await run(["sha256sum",bundle.path])).split(/\s+/)[0] !== bundle.sha256 || Number(await run(["stat","-c","%s",bundle.path])) !== bundle.size) throw new Error("Verified accepted bundle changed");
  await run(["git","-c","protocol.allow=never","-c","protocol.file.allow=always","clone","--quiet","--bare","--no-hardlinks",bundle.path,repo]);
  await run(["git","--git-dir",repo,"symbolic-ref","HEAD","refs/heads/main"]);
  if(await run(["git","--git-dir",repo,"rev-parse","--is-shallow-repository"])!=="false")throw new Error("Full accepted ancestry required");
  if(await run(["git","--git-dir",repo,"show-ref"])!==`${bundle.commit} refs/heads/main`)throw new Error("Unexpected public ref");
  await run(["git","--git-dir",repo,"-c","pack.window=0","repack","-a","-d"]);
  await run(["git","--git-dir",repo,"update-server-info"]);
  await run(["bash","-e","-o","pipefail","-c",`git --git-dir ${q(repo)} rev-list --objects --no-object-names refs/heads/main | sort > ${q(`${input.directory}/public-expected`)} && git --git-dir ${q(repo)} cat-file --batch-all-objects --batch-check='%(objectname)' | sort > ${q(`${input.directory}/public-actual`)} && cmp -s ${q(`${input.directory}/public-expected`)} ${q(`${input.directory}/public-actual`)}`]);
  await run(["git","--git-dir",repo,"fsck","--full","--no-reflogs"]);
  if(await run(["git","--git-dir",repo,"rev-parse",`${bundle.commit}^{tree}`])!==bundle.tree)throw new Error("Accepted export tree differs from verified receipt");
  const actualObjectCount=Number(await run(["sh","-c",`wc -l < ${q(`${input.directory}/public-actual`)}`]));
  if(actualObjectCount!==bundle.objectCount)throw new Error("Accepted export object count differs from verified receipt");
  const packs=(await run(["find",`${repo}/objects/pack`,"-maxdepth","1","-type","f","-name","*.pack","-exec","basename","{}",";"])).split("\n");
  if(packs.length!==1||!/^pack-[a-f0-9]{40}\.pack$/.test(packs[0]!))throw new Error("Exactly one accepted pack required");
  const pack=packs[0]!,paths=["HEAD","info/refs","objects/info/packs",`objects/pack/${pack}`,`objects/pack/${pack.replace(/\.pack$/,".idx")}`];
  const assets:PublicGitExportAsset[]=[];
  let totalBytes=0;
  for(const path of paths){
    const file=`${repo}/${path}`,size=Number(await run(["stat","-c","%s",file]));
    const sha256=(await run(["sha256sum",file])).split(/\s+/)[0]!;
    if(!Number.isSafeInteger(size)||size<1||! /^[a-f0-9]{64}$/.test(sha256))throw new Error("Public Git asset receipt unavailable");
    totalBytes+=size;if(totalBytes>MAX_BUNDLE_BYTES)throw new Error("Public Git pack, index and metadata exceed 512 MiB retained capacity");
    assets.push({path,file,size,sha256});
  }
  const assetBytes = totalBytes;
  let manifest = "";
  for (let attempt=0;attempt<4;attempt++) {
    manifest=JSON.stringify({commit:bundle.commit,tree:bundle.tree,objectCount:bundle.objectCount,objectScope:"exact-accepted-reachable-closure",totalBytes,assets:assets.map(({path,size,sha256})=>({path,size,sha256}))});
    const measured=assetBytes+new TextEncoder().encode(manifest).byteLength;
    if(measured===totalBytes)break;
    totalBytes=measured;
  }
  if(totalBytes>MAX_BUNDLE_BYTES||assetBytes+new TextEncoder().encode(manifest).byteLength!==totalBytes)throw new Error("Public Git assets and manifest exceed retained capacity");
  return {commit:bundle.commit,tree:bundle.tree,objectCount:bundle.objectCount,objectScope:"exact-accepted-reachable-closure" as const,totalBytes,manifest,assets};
}
