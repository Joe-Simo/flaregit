import type { Env } from "./env";
import { isSafeRef } from "../core/sanitize";
import { validateRecoveryRemote } from "./private-recovery-bundle";
import { allocateArtifact } from "./storage-allocation";
import { admitNativeCompute } from "./native-compute";
import { accountKeyFor } from "./projects";
import { gitAuthEnv, q } from "./shell";
import { sealAndStopInitializer } from "./readme-repository";
import type { BranchGitExecutor } from "./branch-git";

export interface EmptyRepositoryInput {
  projectId: string; canonicalName: string; name: string; description: string; defaultBranch: string;
  userId: string; operationId: string; eventId: string;
}
export interface EmptyRepositoryMetadata { id: string; name: string; remote: string; defaultBranch: string }
export interface EmptyRepositoryProof {
  repositoryId: string; canonicalRepoName: string; defaultRef: string; refs: [];
  /** Null means no symbolic HEAD was advertised. The recorded default ref is
   * an owner choice confirmed by SDK metadata, not an invented Git HEAD. */
  symbolicHead: string | null;
}
/** Every receipt callback must durably persist its fact before resolving. These
 * server-only callbacks share the existing initialization/credential ledgers. */
export interface EmptyRepositoryJournal {
  authorize(): Promise<void>;
  beforeCreate(input: EmptyRepositoryInput): Promise<boolean>;
  created(metadata: EmptyRepositoryMetadata, initialToken: string): Promise<void>;
  credentialRevoked(): Promise<void>;
  nativeIntent(name: string): Promise<void>;
  beforeReadCredential(): Promise<void>;
  readCredentialRecorded(token: string, expiresAt: string, scope: string): Promise<void>;
  readCredentialRevoked(): Promise<void>;
  empty(proof: EmptyRepositoryProof): Promise<void>;
  nativeStopped(): Promise<void>;
}
function defaultRef(defaultBranch: string): string {
  if (!isSafeRef(defaultBranch) || defaultBranch.startsWith("refs/") || defaultBranch === "HEAD") throw new Error("Recorded default branch is invalid");
  return `refs/heads/${defaultBranch}`;
}
/** A successful unfiltered native advertisement is authority for empty advertised
 * refs only. This does not claim that unreachable provider objects do not exist. */
export async function inspectEmptyRepository(executor: BranchGitExecutor, metadata: EmptyRepositoryMetadata, token: string, recordedDefaultBranch: string): Promise<EmptyRepositoryProof> {
  validateRecoveryRemote(metadata.remote);
  const ref = defaultRef(recordedDefaultBranch);
  if (!metadata.id || !metadata.name || metadata.defaultBranch !== recordedDefaultBranch) throw new Error("Created repository metadata differs from the recorded owner choice");
  await executor.beforeCommand("before");
  const result = await executor.exec(`git ls-remote --symref ${q(metadata.remote)}`, { ...gitAuthEnv(token), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_1: "http.followRedirects", GIT_CONFIG_VALUE_1: "false" });
  await executor.beforeCommand("after");
  if (!result.success || new TextEncoder().encode(result.stdout).length > 32768) throw new Error("Empty repository inventory was not confirmed");
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  let symbolicHead: string | null = null;
  for (const line of lines) {
    if (line === `ref: ${ref}\tHEAD` && symbolicHead === null) { symbolicHead = ref; continue; }
    // Includes detached HEAD, tags and custom refs. Never inspect only the chosen branch.
    throw new Error("Repository is not authoritatively empty at its recorded scope");
  }
  return { repositoryId: metadata.id, canonicalRepoName: metadata.name, defaultRef: ref, refs: [], symbolicHead };
}

/** Provision a genuinely empty SDK repository: no README, commit, update-ref or
 * push. Initial SDK credentials are recorded and revoked before narrow READ use.
 * A failed acknowledgement remains in the durable journal; never re-create blindly.
 */
export async function createEmptyRepository(env: Env, input: EmptyRepositoryInput, journal: EmptyRepositoryJournal): Promise<EmptyRepositoryProof> {
  defaultRef(input.defaultBranch);
  if (!/^[a-f0-9-]{36}$/.test(input.eventId)) throw new Error("Recorded empty repository event required");
  await journal.authorize();
  const nativeName = `empty-${input.eventId}`;
  const created = await allocateArtifact(env, { name: input.canonicalName, projectId: input.projectId, userId: input.userId, kind: "canonical", operationId: input.operationId }, async () => {
    const result = await env.ARTIFACTS.create(input.canonicalName, { description: input.description, setDefaultBranch: input.defaultBranch });
    try { await journal.created({ id: result.id, name: result.name, remote: result.remote, defaultBranch: result.defaultBranch }, result.token); }
    catch {
      try { using repository = await env.ARTIFACTS.get(input.canonicalName); if (await repository.revokeToken(result.token)) await journal.credentialRevoked(); } catch { /* Pre-dispatch intent retains uncertain issuance/revocation. */ }
      throw new Error("Empty repository creation receipt is unconfirmed; saved-operation recovery is required");
    }
    return result;
  }, async () => {
    await journal.authorize();
    await admitNativeCompute(env, await accountKeyFor(input.userId), nativeName, "native-essential");
    if (!await journal.beforeCreate(input)) throw new Error("Saved repository creation requires recovery before another dispatch");
  });
  using repository = await env.ARTIFACTS.get(input.canonicalName);
  if (!await repository.revokeToken(created.token)) throw new Error("Initial repository credential revocation remains unconfirmed");
  await journal.credentialRevoked(); await journal.authorize();
  const info = await repository.info();
  const metadata: EmptyRepositoryMetadata = { id: info.id, name: info.name, remote: info.remote, defaultBranch: info.defaultBranch };
  if (metadata.id !== created.id || metadata.name !== input.canonicalName || metadata.remote !== created.remote || metadata.defaultBranch !== input.defaultBranch) throw new Error("Created empty repository identity changed");
  let allocated = false, readToken: string | undefined, revoked = false, stopped = false, proof: EmptyRepositoryProof | undefined;
  try {
    await journal.authorize(); await journal.nativeIntent(nativeName);
    const sandbox = env.INTEGRATOR.getByName(nativeName); allocated = true;
    await journal.authorize(); await journal.beforeReadCredential();
    const issued = await repository.createToken("read", 60); readToken = issued.plaintext;
    // Save cleanup capability before checking its properties or renewed owner authority.
    await journal.readCredentialRecorded(issued.plaintext, issued.expiresAt, issued.scope);
    const expiry = Date.parse(issued.expiresAt);
    if (issued.scope !== "read" || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 65000) throw new Error("Empty repository read credential was not confirmed");
    await journal.authorize();
    proof = await inspectEmptyRepository({ beforeCommand: () => journal.authorize(), exec: (command, environment) => sandbox.exec(["sh", "-c", command], { env: environment }) }, metadata, issued.plaintext, input.defaultBranch);
    await journal.authorize(); await journal.empty(proof);
  } finally {
    if (readToken) try { if (await repository.revokeToken(readToken)) { await journal.readCredentialRevoked(); revoked = true; } } catch { /* Durable READ issuance retains exact cleanup capability. */ }
    if (allocated) try { const sandbox = env.INTEGRATOR.getByName(nativeName); if (await sealAndStopInitializer(sandbox)) { await journal.nativeStopped(); stopped = true; } } catch { /* No fabricated shutdown from inactive/unknown observations. */ }
  }
  if (!proof || !revoked || !stopped) throw new Error("Empty repository initialization remains pending; saved receipts and cleanup holds are preserved");
  await journal.authorize();
  return proof;
}
