import { validateRecoveryRemote } from "./private-recovery-bundle";
import { gitAuthEnv, q } from "./shell";

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
