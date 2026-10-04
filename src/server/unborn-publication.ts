import type { UnbornRepositoryBaseline, UnbornRootCandidate, UnbornRootDecision, UnbornRootVerification } from "../core/pipeline/unborn";
import { gitAuthEnv } from "./shell";

export interface UnbornPublicationIntent extends UnbornRootCandidate { operationId: string }
interface NativeGitExecutor { exec(argv: string[], options?: { env?: Record<string, string> }): Promise<{ success: boolean; stdout: string }> }
export interface UnbornPublicationJournal {
  authorize(baseline: UnbornRepositoryBaseline): Promise<void>;
  prepare(intent: UnbornPublicationIntent): Promise<void>;
  beforePush(intent: UnbornPublicationIntent): Promise<boolean>;
  confirm(intent: UnbornPublicationIntent): Promise<void>;
}
export type UnbornPublicationResult = { status: "published" | "published_projection_pending"; commit: string } | { status: "unconfirmed" } | { status: "stale"; observedHead: string };

/** Staged native adapter. An unknown write acknowledgment is recovered only by exact readback. */
export async function publishUnbornRepository(executor: NativeGitExecutor, workspace: string, remote: string, token: string, proposed: UnbornPublicationIntent, decision: UnbornRootDecision, verification: UnbornRootVerification, journal: UnbornPublicationJournal): Promise<UnbornPublicationResult> {
  const intent = structuredClone(proposed), baseline = intent.baseline;
  if (baseline.kind !== "unborn" || baseline.expectedHead !== null || !baseline.providerRepoId || !baseline.repositoryIncarnation || !baseline.canonicalRepoName || !baseline.defaultRef.startsWith("refs/heads/") || !intent.operationId || !intent.candidateId || !/^[a-f0-9]{40}$/.test(intent.commit) || !/^[a-f0-9]{40}$/.test(intent.tree)) throw new Error("Exact missing-head publication intent required");
  for (const receipt of [decision, verification]) if (receipt.candidateId !== intent.candidateId || receipt.commit !== intent.commit || receipt.tree !== intent.tree) throw new Error("First-root review or verification scope differs");
  if (decision.decision !== "approved" || !decision.actorId || !verification.passed) throw new Error("Verified human first-root approval required");
  const run = async (args: string[], authenticated = false) => {
    await journal.authorize(baseline);
    return executor.exec(["git", "-C", workspace, ...args], authenticated ? { env: gitAuthEnv(token) } : undefined);
  };
  const read = async (args: string[], authenticated = false) => { const result = await run(args, authenticated); if (!result.success) throw new Error("First-root Git observation unavailable"); return result.stdout.trim(); };
  await read(["check-ref-format", baseline.defaultRef]);
  if (await read(["rev-parse", `${intent.commit}^{tree}`]) !== intent.tree) throw new Error("First-root Git object proof differs");
  const contributors=intent.contributorCommits??[intent.commit],roots=new Set<string>();
  if(!contributors.length||contributors.length>8||new Set(contributors).size!==contributors.length)throw new Error("Frozen initial contributors required");
  for(const contributor of contributors){
    if(!/^[a-f0-9]{40}$/.test(contributor))throw new Error("Invalid frozen initial contributor");
    const lineage=(await read(["rev-list","--max-parents=0",contributor])).split("\n");
    if(lineage.length!==1)throw new Error("Initial contributor root lineage differs");
    roots.add(lineage[0]!);await read(["merge-base","--is-ancestor",contributor,intent.commit]);
  }
  const candidateRoots=(await read(["rev-list","--max-parents=0",intent.commit])).split("\n");
  if(candidateRoots.length!==roots.size||candidateRoots.some(root=>!roots.has(root)))throw new Error("Candidate contains an unfrozen initial root lineage");
  await journal.prepare(intent);
  const observe = async (): Promise<string | null> => {
    const inventory = await read(["ls-remote", "--refs", remote], true);
    const lines = inventory ? inventory.split("\n") : [];
    if (lines.some(line => !/^[a-f0-9]{40}\trefs\/[^\s]+$/.test(line))) throw new Error("First-root ref inventory is invalid");
    const matches = lines.filter(line => line.split("\t")[1] === baseline.defaultRef);
    if (matches.length > 1 || matches.some(line => !/^[a-f0-9]{40}\trefs\//.test(line))) throw new Error("First-root ref observation is ambiguous");
    return matches[0]?.split("\t")[0] ?? null;
  };
  let observed = await observe();
  if (observed !== null && observed !== intent.commit) return { status: "stale", observedHead: observed };
  if (observed === null && await journal.beforePush(intent)) {
    // The durable dispatch gate forbids retries from sending this write twice.
    try { await run(["push", "--quiet", `--force-with-lease=${baseline.defaultRef}:`, remote, `${intent.commit}:${baseline.defaultRef}`], true); }
    catch { /* Authoritative readback below determines the outcome. */ }
    observed = await observe();
  }
  if (observed === null) return { status: "unconfirmed" };
  if (observed !== intent.commit) return { status: "stale", observedHead: observed };
  await journal.authorize(baseline);
  try { await journal.confirm(intent); } catch { return { status: "published_projection_pending", commit: intent.commit }; }
  return { status: "published", commit: intent.commit };
}
