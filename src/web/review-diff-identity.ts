interface FrozenDiffIdentity {
  repo: string;
  base: string | null;
  head: { hash: string; parents?: string[] };
  input?: { taskId: string; commit: string; baseSource: "recorded-contribution-base" | "commit-parent" };
}

/** A verified saved base may outlive older candidate metadata; never substitute a new head. */
export function frozenInputDiffMatches(response: FrozenDiffIdentity, expected: { taskId: string; commit?: string; base?: string }): boolean {
  if (!expected.commit || !/^[a-f0-9]{40}$/.test(expected.commit) || response.head.hash !== expected.commit || response.input?.commit !== expected.commit || response.input.taskId !== expected.taskId || response.repo !== `task:${expected.taskId}`) return false;
  if (expected.base) return response.base === expected.base && response.input.baseSource === "recorded-contribution-base";
  if (response.input.baseSource === "recorded-contribution-base") return /^[a-f0-9]{40}$/.test(response.base ?? "");
  return response.input.baseSource === "commit-parent" && response.base === (response.head.parents?.[0] ?? null);
}
