import { isSafeRef } from "../core/sanitize";
import { validateRecoveryRemote } from "./private-recovery-bundle";
import { retainedGitInputRef } from "./retained-git-input";
import { retainedInputSchema, type RebaseApplication } from "./retained-inputs";
import { gitAuthEnv, q } from "./shell";
export class SavedRebaseGitError extends Error {
  constructor(message: string, readonly status: 409 | 503) { super(message); }
}
export interface SavedRebaseGitOptions {
  application: RebaseApplication;
  directory: string;
  canonical: { remote: string; token: string };
  workspace: { remote: string; token: string };
  exec(command: string, env?: Record<string, string>): Promise<{ success: boolean; stdout: string }>;
  beforeCommand(phase: "before" | "after"): Promise<void>;
}
/** Saved objects only; caller owns directory and credential cleanup. */
export async function resumeSavedRebaseGit(options: SavedRebaseGitOptions): Promise<{commit:string;base:string;observedHead:string;status:"pushed"|"already_present"}> {
  const { application: app, directory, canonical, workspace } = options;
  const input = retainedInputSchema.parse(app.input);
  if (!/^[a-f0-9]{40}$/.test(app.commit) || !/^[a-f0-9]{40}$/.test(app.base) || input.followup || !isSafeRef(input.branch)
    || !/^\/tmp\/flaregit-rebase-resume-[a-f0-9-]{36}$/.test(directory)
    || input.canonicalRepoName === input.workspaceRepoName || canonical.remote === workspace.remote) throw new SavedRebaseGitError("Invalid saved rebase scope",409);
  for (const connection of [canonical,workspace]) {
    validateRecoveryRemote(connection.remote);
    if (!connection.token || connection.token.length>4096 || /[\r\n\0]/.test(connection.token)) throw new SavedRebaseGitError("Invalid saved rebase credential",409);
  }
  const pins = [input.commit,...(input.base === null ? [] : [input.base]),app.commit,app.base].map(commit=>({commit,ref:retainedGitInputRef(input.incarnation,input.taskId,commit)}));
  if(input.protectedRef!==pins[0]!.ref || input.protectedBaseRef!==(input.base===null?null:retainedGitInputRef(input.incarnation,input.taskId,input.base))) throw new SavedRebaseGitError("Saved input pin scope changed",409);
  const run=async(command:string,token?:string)=>{
    await options.beforeCommand("before");
    const result=await options.exec(command,token?{...gitAuthEnv(token),GIT_CONFIG_COUNT:"2",GIT_CONFIG_KEY_1:"http.followRedirects",GIT_CONFIG_VALUE_1:"false"}:undefined);
    await options.beforeCommand("after");
    return result;
  };
  if(!(await run(`git init --quiet --bare ${q(directory)}`)).success) throw new SavedRebaseGitError("Saved workspace unavailable",503);
  for(const pin of new Map(pins.map(pin=>[pin.ref,pin])).values()) {
    const fetch=await run(`git -C ${q(directory)} fetch --quiet --no-tags ${q(canonical.remote)} ${q(`${pin.ref}:${pin.ref}`)}`,canonical.token);
    if(!fetch.success) throw new SavedRebaseGitError("Saved rebase pin unavailable",503);
    const proof=await run(`git -C ${q(directory)} rev-parse --verify ${q(`${pin.ref}^{commit}`)}`);
    if(!proof.success || proof.stdout.trim()!==pin.commit) throw new SavedRebaseGitError("Saved pin differs from recorded commit",409);
  }
  const branch=`refs/heads/${input.branch}`;
  const inspect=async()=>{
    const result=await run(`git -C ${q(directory)} ls-remote --refs ${q(workspace.remote)} ${q(branch)}`,workspace.token);
    if(!result.success) throw new SavedRebaseGitError("Workspace proof unavailable",503);
    const rows=result.stdout.trim().split("\n").filter(Boolean), row=rows[0]?.split("\t");
    if(rows.length!==1 || !row || !/^[a-f0-9]{40}$/.test(row[0]!) || row[1]!==branch) throw new SavedRebaseGitError("Workspace branch unavailable",409);
    return row[0]!;
  };
  const head=await inspect();
  if(head===app.commit) return {commit:app.commit,base:app.base,observedHead:head,status:"already_present"};
  if(head!==input.commit) throw new SavedRebaseGitError("Workspace contains newer work",409);
  try { await run(`git -C ${q(directory)} push --quiet --force-with-lease=${q(`${branch}:${input.commit}`)} ${q(workspace.remote)} ${q(`${app.commit}:${branch}`)}`,workspace.token); }
  catch { /* A fresh independently authorized read-back must settle uncertainty. */ }
  const observedHead=await inspect();
  if(observedHead!==app.commit) throw new SavedRebaseGitError(observedHead===input.commit?"Saved push unconfirmed":"Workspace changed during push",observedHead===input.commit?503:409);
  return {commit:app.commit,base:app.base,observedHead,status:"pushed"};
}
