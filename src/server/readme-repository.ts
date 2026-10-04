import type { Env } from "./env";
import { allocateArtifact } from "./storage-allocation";
import { admitNativeCompute } from "./native-compute";
import { accountKeyFor } from "./projects";
import { gitAuthEnv, q } from "./shell";

interface GitExecutor { exec(command: string, environment?: Record<string, string>): Promise<{ success: boolean; stdout: string }> }
export interface ReadmeRepositoryInput { projectId: string; canonicalName: string; name: string; description: string; authorName: string; authorEmail: string; defaultBranch: string; userId: string; operationId: string; eventId: string; commitTimestamp: string }
export interface InitialCommitReceipt { head: string; tree: string; defaultBranch: string }
/** Each callback must durably save its receipt before resolving; credentials are server-only. */
export interface RepositoryInitializationJournal {
  authorize(): Promise<void>;
  beforeCreate(input: ReadmeRepositoryInput): Promise<void>;
  created(metadata: { id: string; name: string; remote: string }, initialToken: string): Promise<void>;
  nativeIntent(name: string): Promise<void>;
  committed(receipt: InitialCommitReceipt): Promise<void>;
  beforePush(): Promise<boolean>;
  published(receipt: InitialCommitReceipt): Promise<void>;
  credentialRevoked(): Promise<void>;
  nativeStopped(): Promise<void>;
}

/** A user-requested README creates real Git history, with create-only branch publication. */
export async function initializeReadmeGit(executor: GitExecutor, input: Pick<ReadmeRepositoryInput, "name" | "description" | "authorName" | "authorEmail" | "defaultBranch" | "commitTimestamp">, remote: string, token: string, authorize: () => Promise<void>, recordCommit: (receipt: InitialCommitReceipt) => Promise<void>, beforePush: () => Promise<boolean>, published: (receipt: InitialCommitReceipt) => Promise<void>): Promise<InitialCommitReceipt> {
  if (!Number.isFinite(Date.parse(input.commitTimestamp))) throw new Error("Recorded commit timestamp is invalid");
  if (!input.name.trim() || /[\r\n\x00]/.test(input.name + input.authorName + input.authorEmail) || !input.authorName.trim() || !/^[^\s<>@]+@[^\s<>@]+$/.test(input.authorEmail)) throw new Error("Repository author or name is invalid");
  const run = async (command: string, environment?: Record<string, string>) => { const result = await executor.exec(command, environment); if (!result.success) throw new Error("Repository initialization Git operation was not confirmed"); return result.stdout.trim(); };
  await run(`git check-ref-format ${q(`refs/heads/${input.defaultBranch}`)}`);
  const readme = Buffer.from(`# ${input.name}\n${input.description.trim() ? `\n${input.description.trim()}\n` : ""}`).toString("base64");
  await run(`mkdir -p /workspace/readme-init && git -C /workspace/readme-init init --quiet -b ${q(input.defaultBranch)} && printf %s ${q(readme)} | base64 -d > /workspace/readme-init/README.md`);
  await run(`git -C /workspace/readme-init add -- README.md && git -C /workspace/readme-init -c user.name=${q(input.authorName)} -c user.email=${q(input.authorEmail)} commit --quiet -m 'Initialize repository with README'`, { GIT_AUTHOR_DATE: input.commitTimestamp, GIT_COMMITTER_DATE: input.commitTimestamp });
  const head = await run("git -C /workspace/readme-init rev-parse HEAD"), tree = await run("git -C /workspace/readme-init rev-parse HEAD^{tree}");
  if (!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(tree)) throw new Error("Initial Git objects were not confirmed");
  const ref = `refs/heads/${input.defaultBranch}`;
  const receipt = { head, tree, defaultBranch: input.defaultBranch };
  await recordCommit(receipt);
  await authorize();
  if (await beforePush()) try { await run(`git -C /workspace/readme-init push --quiet ${q(`--force-with-lease=${ref}:`)} ${q(remote)} ${q(`${head}:${ref}`)}`, gitAuthEnv(token)); } catch { /* Observe the exact frozen commit after an ambiguous push; never dispatch another push. */ }
  const observed = await run(`git -C /workspace/readme-init ls-remote --exit-code ${q(remote)} ${q(ref)}`, gitAuthEnv(token));
  if (observed !== `${head}\t${ref}`) throw new Error("Initial repository branch was not confirmed");
  const parents = await run(`git -C /workspace/readme-init rev-list --parents -n 1 ${q(head)}`);
  if (parents !== head || await run(`git -C /workspace/readme-init rev-parse ${q(`${head}^{tree}`)}`) !== tree) throw new Error("Original root commit identity was not confirmed");
  await authorize();
  await published(receipt);
  return receipt;
}

export async function sealAndStopInitializer(sandbox: { seal(): Promise<void>; destroy(): Promise<unknown>; lifetimeStatus(): Promise<{ state: string; sealed?: boolean } | null> }): Promise<boolean> {
  await sandbox.seal(); await sandbox.destroy();
  const lifetime = await sandbox.lifetimeStatus();
  return lifetime?.state === "stopped" && lifetime.sealed === true;
}

export async function createReadmeRepository(env: Env, input: ReadmeRepositoryInput, journal: RepositoryInitializationJournal): Promise<InitialCommitReceipt> {
  await journal.authorize(); await journal.beforeCreate(input);
  const created = await allocateArtifact(env, { name: input.canonicalName, projectId: input.projectId, userId: input.userId, kind: "canonical", operationId: input.operationId }, async () => {
    await journal.authorize();
    const result = await env.ARTIFACTS.create(input.canonicalName, { description: input.description, setDefaultBranch: input.defaultBranch });
    try { await journal.created({ id: result.id, name: result.name, remote: result.remote }, result.token); }
    catch {
      try { using repository = await env.ARTIFACTS.get(input.canonicalName); if (await repository.revokeToken(result.token)) await journal.credentialRevoked(); } catch { /* Pre-create intent preserves the unknown credential outcome. */ }
      throw new Error("Repository creation receipt was not confirmed; retry requires saved-operation recovery");
    }
    return result;
  });
  const nativeName = `readme-${input.eventId}`;
  let nativeAllocated = false, receipt: InitialCommitReceipt | undefined, revoked = false, stopped = false;
  try {
    await journal.authorize(); await admitNativeCompute(env, await accountKeyFor(input.userId), nativeName, "native-essential"); await journal.nativeIntent(nativeName);
    const sandbox = env.INTEGRATOR.getByName(nativeName); nativeAllocated = true;
    receipt = await initializeReadmeGit({ exec: (command, environment) => sandbox.exec(["sh", "-c", command], { env: environment }) }, input, created.remote, created.token, () => journal.authorize(), value => journal.committed(value), () => journal.beforePush(), value => journal.published(value));
  } finally {
    try { using repository = await env.ARTIFACTS.get(input.canonicalName); if (await repository.revokeToken(created.token)) { await journal.credentialRevoked(); revoked = true; } } catch { /* Durable credential receipt stays unresolved. */ }
    if (nativeAllocated) try { const sandbox = env.INTEGRATOR.getByName(nativeName); if (await sealAndStopInitializer(sandbox)) { await journal.nativeStopped(); stopped = true; } } catch { /* Durable native intent stays unresolved. */ }
  }
  if (!receipt || !revoked || !stopped) throw new Error("Repository initialization remains pending; committed history and cleanup receipts are preserved");
  await journal.authorize();
  return receipt;
}
