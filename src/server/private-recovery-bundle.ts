import { gitAuthEnv, q } from "./shell.js";
export const BUNDLE_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
export interface BundleExecutor {
  exec(argv: string[], options?: { env?: Record<string,string>; timeoutMs?: number }): Promise<{success:boolean;stdout:string;stderr:string}>;
}
/** Build only the accepted ancestry. No checkout, source execution, --all, or candidate ref selection.
 * Native verification compares ALL unbundled objects against the accepted reachable closure,
 * including unreachable pack delta bases; matching ref names alone is insufficient.
 */
export async function createAcceptedBundle(executor: BundleExecutor, input: { remote: string; token: string; commit: string; tree: string | null; directory: string }) {
  validateRecoveryRemote(input.remote);
  if ((input.tree !== null && !/^[a-f0-9]{40}$/.test(input.tree)) || !/^[a-f0-9]{40}$/.test(input.commit) || !/^\/tmp\/flaregit-private-recovery-[a-f0-9-]{36}$/.test(input.directory)) throw new Error("Invalid bundle input");
  const dir=input.directory, source=`${dir}/source.git`, verify=`${dir}/verify.git`, bundle=`${dir}/repository.bundle`;
  const cleanEnv={GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_SYSTEM:"/dev/null",GIT_CONFIG_NOSYSTEM:"1",GIT_TERMINAL_PROMPT:"0",GIT_CONFIG_COUNT:"0"};
  const run=async(argv:string[],env=cleanEnv)=>{const result=await executor.exec(argv,{env,timeoutMs:120_000});if(!result.success)throw new Error("Private Git recovery failed; no download was published");return result.stdout.trim();};
  await run(["mkdir","-m","700","--",dir]);
  await run(["git","init","--quiet","--bare",source]);
  await run(["git","--git-dir",source,"-c","http.followRedirects=false","-c","protocol.allow=never","-c","protocol.https.allow=always","fetch","--quiet","--no-tags","--",input.remote,input.commit],{...cleanEnv,...gitAuthEnv(input.token)});
  await run(["git","--git-dir",source,"update-ref","refs/heads/main",input.commit]);
  await run(["git","--git-dir",source,"symbolic-ref","HEAD","refs/heads/main"]);
  if(await run(["git","--git-dir",source,"rev-parse","--is-shallow-repository"])!=="false")throw new Error("Accepted export requires full ancestry; shallow source refused");
  if (await run(["git", "--git-dir", source, "cat-file", "-t", input.commit]) !== "commit" || (input.tree !== null && await run(["git", "--git-dir", source, "rev-parse", `${input.commit}^{tree}`]) !== input.tree)) throw new Error("Accepted commit or tree does not match immutable receipt");
  await run(["git","--git-dir",source,"-c","pack.window=0","bundle","create",bundle,"refs/heads/main","HEAD"]);
  const heads=await run(["git","bundle","list-heads",bundle]);
  const expectedHeads=[`${input.commit} HEAD`,`${input.commit} refs/heads/main`].sort().join("\n");
  if(heads.split("\n").sort().join("\n")!==expectedHeads)throw new Error("Bundle ref scope differs from accepted history");
  await run(["git","init","--quiet","--bare",verify]);
  await run(["git","--git-dir",verify,"bundle","unbundle",bundle]);
  await run(["bash","-e","-o","pipefail","-c",`git --git-dir ${q(source)} rev-list --objects --no-object-names refs/heads/main | sort > ${q(`${dir}/expected`)} && git --git-dir ${q(verify)} cat-file --batch-all-objects --batch-check='%(objectname)' | sort > ${q(`${dir}/actual`)} && cmp -s ${q(`${dir}/expected`)} ${q(`${dir}/actual`)}`]);
  await run(["git","--git-dir",verify,"fsck","--full","--no-reflogs"]);
  const size=Number(await run(["stat","-c","%s",bundle]));
  if(!Number.isSafeInteger(size)||size<1||size>MAX_BUNDLE_BYTES)throw new Error("Accepted bundle exceeds the current 512 MiB export capacity; source history is preserved");
  const tree=await run(["git","--git-dir",source,"rev-parse",`${input.commit}^{tree}`]);
  const objectCount=Number(await run(["sh","-c",`wc -l < ${q(`${dir}/expected`)}`]));
  if(!/^[a-f0-9]{40}$/.test(tree)||!Number.isSafeInteger(objectCount)||objectCount<1)throw new Error("Invalid bundle integrity receipt");
  const sha256=(await run(["sha256sum",bundle])).split(/\s+/)[0]!;
  if(!/^[a-f0-9]{64}$/.test(sha256))throw new Error("Bundle digest unavailable");
  return {sha256,path:bundle,size,tree,objectCount,commit:input.commit,ref:"refs/heads/main"};
}

/** Recovery fetches only the provisioned Cloudflare artifact origin, never arbitrary hosts. */
export function validateRecoveryRemote(remote: string): void {
  let url: URL;
  try { url = new URL(remote); } catch { throw new Error("Invalid recovery remote"); }
  if (url.protocol !== "https:" || !/^[a-f0-9]{32}\.artifacts\.cloudflare\.net$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9/_.,~-]+$/.test(url.pathname) || remote !== url.href) throw new Error("Invalid recovery remote");
}
