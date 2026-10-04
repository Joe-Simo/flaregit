import { validateRecoveryRemote } from "./private-recovery-bundle";
import { gitAuthEnv, q } from "./shell";
import { acceptedTargetSchema, type UnbornAcceptedTarget } from "../core/accepted-target";

export interface RetainedGitInput { ref: string; commit: string }
export interface RetainGitInputOptions {
  exec(command: string, env?: Record<string, string>): Promise<{ success: boolean; stdout: string }>;
  directory: string;
  remote: string;
  token: string;
  incarnation: string;
  taskId: string;
  commit: string;
  /** Revalidate frozen authority and admit each actual command before execution. */
  beforeCommand(phase: "before" | "after"): Promise<void>;
}
const sha = /^[a-f0-9]{40}$/;
export function retainedGitInputRef(incarnation: string, taskId: string, commit: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(incarnation) || !/^[a-z0-9][a-z0-9-]{2,100}$/.test(taskId) || !sha.test(commit)) throw new Error("Invalid retained input identity");
  return `refs/flaregit/inputs/${incarnation}/${taskId}/${commit}`;
}
/** Create-only private canonical pin. Never updates an accepted branch or replaces a pin. */
export async function retainGitInput(options: RetainGitInputOptions): Promise<RetainedGitInput> {
  const {directory,remote,token,commit}=options;
  const ref=retainedGitInputRef(options.incarnation,options.taskId,commit);
  validateRecoveryRemote(remote);
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(directory) || directory.split("/").some(part=>part===".." || part===".") || !token || token.length>4096 || /[\r\n\0]/.test(token)) throw new Error("Invalid retained input workspace or credential");
  const run=async(command:string,authenticated=false)=>{
    await options.beforeCommand("before");
    const result=await options.exec(command,authenticated?gitAuthEnv(token):undefined);
    await options.beforeCommand("after");
    return result;
  };
  const local=await run(`git -C ${q(directory)} rev-parse --verify ${q(`${commit}^{commit}`)}`);
  if(!local.success || local.stdout.trim()!==commit)throw new Error("Retained input commit is unavailable");
  const inspect=async()=>{
    const result=await run(`git -C ${q(directory)} ls-remote --refs ${q(remote)} ${q(ref)}`,true);
    if(!result.success)throw new Error("Retained input remote proof is unavailable");
    const rows=result.stdout.trim().split("\n").filter(Boolean);
    if(rows.length===0)return false;
    if(rows.length!==1 || rows[0]!==`${commit}\t${ref}`)throw new Error("Retained input ref differs from its immutable identity");
    return true;
  };
  if(await inspect())return {ref,commit};
  // An empty expected old value atomically permits creation only; even a racing
  // writer cannot cause this command to overwrite a different existing object.
  try { await run(`git -C ${q(directory)} push --quiet --force-with-lease=${q(`${ref}:`)} ${q(remote)} ${q(`${commit}:${ref}`)}`,true); }
  catch {
    // Transport exceptions can occur after the server accepts the pin. Fresh
    // authorization plus exact remote proof settles that uncertainty safely.
    if(await inspect())return {ref,commit};
    throw new Error("Retained input push was not confirmed");
  }
  if(!await inspect())throw new Error("Retained input push was not confirmed");
  return {ref,commit};
}

/** Pin only real contributor history for an unborn target; there is no base object to pin. */
export async function retainUnbornGitInput(options: RetainGitInputOptions & { acceptedTarget: UnbornAcceptedTarget }): Promise<RetainedGitInput & { base: null; protectedBaseRef: null; rootCommit: string; rootAncestryVerified: true }> {
  retainedGitInputRef(options.incarnation,options.taskId,options.commit);
  const target=acceptedTargetSchema.parse(options.acceptedTarget);
  if(target.kind!=="unborn"||target.incarnation!==options.incarnation)throw new Error("Retained unborn target scope differs");
  await options.beforeCommand("before");
  const roots=await options.exec(`git --no-replace-objects -C ${q(options.directory)} rev-list --max-parents=0 ${q(options.commit)}`);
  await options.beforeCommand("after");
  const values=roots.stdout.trim().split("\n");
  if(!roots.success||values.length!==1||!sha.test(values[0]!)||/^0{40}$/.test(values[0]!))throw new Error("Actual contributor root lineage is unavailable");
  await options.beforeCommand("before");
  const ancestry=await options.exec(`git --no-replace-objects -C ${q(options.directory)} merge-base --is-ancestor ${q(values[0]!)} ${q(options.commit)}`);
  await options.beforeCommand("after");
  if(!ancestry.success)throw new Error("Contributor root ancestry was not confirmed");
  const retained=await retainGitInput(options);
  return{...retained,base:null,protectedBaseRef:null,rootCommit:values[0]!,rootAncestryVerified:true};
}
