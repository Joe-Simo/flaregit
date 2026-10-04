import { z } from "zod";
import { isSafeRef } from "../core/sanitize";
import { validateRecoveryRemote } from "./private-recovery-bundle";
import { gitAuthEnv, q } from "./shell";
import type { BranchGitExecutor } from "./branch-git";

const sha = z.string().regex(/^[a-f0-9]{40}$/).refine(value => !/^0{40}$/.test(value));
export const tagCreationSchema = z.object({
  operationId: z.uuid(), projectId: z.string().min(1).max(128), incarnation: z.uuid(), canonicalRepoName: z.string().min(1).max(200), actorId: z.string().min(1).max(256), accountKey: z.string().min(1).max(200),
  tag: z.string().refine(value => isSafeRef(value) && !value.startsWith("refs/") && value !== "HEAD"),
  sourceCommit: sha, sourceTree: sha, acceptedCommit: sha,
}).strict().refine(value => value.sourceCommit === value.acceptedCommit, "Exact accepted commit required");
export type TagCreationIdentity = z.infer<typeof tagCreationSchema>;
export interface TagGitObservation { object: string; commit?: string; tree?: string; type?: "commit" | "tag" }
export type TagGitResult = { status: "confirmed" | "existing" | "different" | "unknown"; observation?: TagGitObservation };

/** Lightweight tag primitive only. The caller owns exact accepted-root authority,
 * funding, short-lived credentials, scoped native workspace and positive shutdown.
 * Ordinary Git clients must remain unable to write canonical refs. This helper
 * is not a provider-wide protection rule or an annotated-tag creation feature.
 */
export async function createNativeTag(executor: BranchGitExecutor, options: { identity: TagCreationIdentity; remote: string; token: string; directory: string; dispatch: "prepared" | "unknown"; markDispatch(): Promise<void> }): Promise<TagGitResult> {
  validateRecoveryRemote(options.remote);
  const identity = tagCreationSchema.parse(options.identity), ref = `refs/tags/${identity.tag}`;
  if (!options.directory.startsWith("/") || options.directory === "/" || /[\x00-\x1f\x7f]/.test(options.directory)) throw new Error("Owned tag workspace required");
  const env = { ...gitAuthEnv(options.token), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_COUNT: "3", GIT_CONFIG_KEY_1: "http.followRedirects", GIT_CONFIG_VALUE_1: "false", GIT_CONFIG_KEY_2: "core.hooksPath", GIT_CONFIG_VALUE_2: "/dev/null" };
  const run = async (command: string) => { await executor.beforeCommand("before"); const result = await executor.exec(command, env); await executor.beforeCommand("after"); return result; };
  const initialize = async () => { const result = await run(`git init --quiet --bare ${q(options.directory)}`); if (!result.success) throw new Error("Tag workspace unavailable"); };
  const advertise = async (): Promise<string | null> => {
    const result = await run(`git ls-remote --refs ${q(options.remote)} ${q(ref)}`);
    if (!result.success) throw new Error("Exact tag advertisement unavailable");
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    if (!lines.length) return null;
    if (lines.length !== 1) throw new Error("Exact tag advertisement is ambiguous");
    const [object, name, extra] = lines[0]!.split("\t");
    if (!object || !/^[a-f0-9]{40}$/.test(object) || /^0{40}$/.test(object) || name !== ref || extra !== undefined) throw new Error("Exact tag advertisement differs");
    return object;
  };
  const inspect = async (object: string): Promise<TagGitObservation> => {
    await initialize();
    const fetched = await run(`git -C ${q(options.directory)} fetch --quiet --no-tags ${q(options.remote)} ${q(object)}`);
    if (!fetched.success) throw new Error("Tag object recovery unavailable");
    const type = await run(`git -C ${q(options.directory)} cat-file -t ${q(object)}`);
    if (!type.success || !["commit", "tag"].includes(type.stdout.trim())) return { object };
    const commit = await run(`git -C ${q(options.directory)} rev-parse --verify ${q(`${object}^{commit}`)}`);
    if (!commit.success || !/^[a-f0-9]{40}$/.test(commit.stdout.trim())) return { object };
    const tree = await run(`git -C ${q(options.directory)} rev-parse --verify ${q(`${object}^{tree}`)}`);
    if (!tree.success || !/^[a-f0-9]{40}$/.test(tree.stdout.trim())) throw new Error("Tag target tree unavailable");
    // Ref movement during inspection is an uncertain observation, not confirmation.
    if (await advertise() !== object) throw new Error("Tag changed during inspection");
    return { object, commit: commit.stdout.trim(), tree: tree.stdout.trim(), type: type.stdout.trim() === "tag" ? "tag" : "commit" };
  };
  const previous = await advertise();
  if (previous) {
    const observation = await inspect(previous);
    const matches = observation.object === identity.sourceCommit && observation.commit === identity.sourceCommit && observation.tree === identity.sourceTree && observation.type === "commit";
    return { status: matches ? options.dispatch === "unknown" ? "confirmed" : "existing" : "different", observation };
  }
  if (options.dispatch === "unknown") return { status: "unknown" };
  await initialize();
  const fetched = await run(`git -C ${q(options.directory)} fetch --quiet --no-tags ${q(options.remote)} ${q(identity.acceptedCommit)}`);
  if (!fetched.success) throw new Error("Accepted tag source unavailable");
  const commit = await run(`git -C ${q(options.directory)} rev-parse --verify ${q(`${identity.sourceCommit}^{commit}`)}`);
  const tree = await run(`git -C ${q(options.directory)} rev-parse --verify ${q(`${identity.sourceCommit}^{tree}`)}`);
  if (!commit.success || commit.stdout.trim() !== identity.sourceCommit || !tree.success || tree.stdout.trim() !== identity.sourceTree) throw new Error("Exact accepted tag commit or tree differs");
  await options.markDispatch();
  // Empty expected value is a create-only CAS. It never replaces an existing tag.
  await run(`git -C ${q(options.directory)} push --quiet --force-with-lease=${q(`${ref}:`)} ${q(options.remote)} ${q(`${identity.sourceCommit}:${ref}`)}`);
  const observed = await advertise();
  if (!observed) return { status: "unknown" };
  const observation = await inspect(observed);
  return { status: observation.object === identity.sourceCommit && observation.commit === identity.sourceCommit && observation.tree === identity.sourceTree && observation.type === "commit" ? "confirmed" : "different", observation };
}
