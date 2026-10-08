/** F04 slice: repository merge-method policy (merge, squash, rebase). Platform policy decides which methods a request may use. */

export type MergeMethod = "merge" | "squash" | "rebase";

export interface MergeMethodPolicy {
  readonly allowMerge: boolean;
  readonly allowSquash: boolean;
  readonly allowRebase: boolean;
  readonly defaultMethod: MergeMethod;
}

export type MergeMethodResult = { readonly ok: true; readonly method: MergeMethod } | { readonly ok: false; readonly error: string };

const METHODS: readonly MergeMethod[] = ["merge", "squash", "rebase"];

function enabled(policy: MergeMethodPolicy, method: MergeMethod): boolean {
  if (method === "merge") return policy.allowMerge;
  if (method === "squash") return policy.allowSquash;
  return policy.allowRebase;
}

/** Refuses a policy that enables no method, or whose default is disabled. */
export function validateMergeMethodPolicy(policy: MergeMethodPolicy): {readonly ok: true} | {readonly ok: false; readonly error: string} {
  if (!METHODS.some((method) => enabled(policy, method))) return {ok: false, error: "At least one merge method must be enabled"};
  if (!enabled(policy, policy.defaultMethod)) return {ok: false, error: "The default merge method must be enabled"};
  return {ok: true};
}

/** Resolves a requested method against the policy. An omitted request uses the default; a disabled method is refused. */
export function resolveMergeMethod(policy: MergeMethodPolicy, requested: unknown): MergeMethodResult {
  const valid = validateMergeMethodPolicy(policy);
  if (!valid.ok) return valid;
  if (requested === undefined) return {ok: true, method: policy.defaultMethod};
  if (typeof requested !== "string" || !METHODS.includes(requested as MergeMethod)) return {ok: false, error: "Merge method must be merge, squash or rebase"};
  const method = requested as MergeMethod;
  if (!enabled(policy, method)) return {ok: false, error: `${method} merges are disabled for this repository`};
  return {ok: true, method};
}
