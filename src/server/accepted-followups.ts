import type { Ledger } from "./durable-object.js";

/** Optional work has its own durable recovery evidence after core publication. */
export async function rebaseAcceptedFollowup(ledger: Ledger, commit: string, execute: () => Promise<{rebased:string[];blocked:string[]}>) {
  try { return {status:"completed" as const,...await execute()}; }
  catch {
    await ledger.logActivity("FlareGit","stack.rebase_deferred",`Accepted commit ${commit} is preserved. Dependent updates could not finish; inspect the saved branches, update them onto this accepted commit locally, then push and mark ready.`);
    return {status:"deferred" as const,retry:"local-git" as const};
  }
}
export async function mirrorAcceptedFollowup(ledger: Ledger, commit: string, execute: () => Promise<{skipped:true}|{status:string;detail:string}>) {
  try {
    const result=await execute();
    if("skipped" in result)return result;
    await ledger.recordMirrorRun(commit,result.status,result.detail);
    return {status:result.status};
  } catch {
    await ledger.recordMirrorRun(commit,"deferred","Accepted Git history is preserved. Mirror delivery or its status was not confirmed; use Retry now in Mirror settings.");
    return {status:"deferred"};
  }
}
