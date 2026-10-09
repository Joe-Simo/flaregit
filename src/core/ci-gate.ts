/** F10 slice: required-check evaluation. A run counts only for the exact commit; the latest run per check wins; missing checks block. */

export interface CheckRun {
  readonly name: string;
  readonly commit: string;
  readonly conclusion: "success" | "failure" | "cancelled" | "neutral";
  readonly finishedAt: number;
}

/** Returns the names of required checks that do not currently pass for the commit. */
export function failingRequiredChecks(required: readonly string[], runs: readonly CheckRun[], commit: string): string[] {
  return required.filter((name) => {
    const latest = runs
      .filter((run) => run.name === name && run.commit === commit)
      .reduce<CheckRun | undefined>((best, run) => (best === undefined || run.finishedAt > best.finishedAt ? run : best), undefined);
    return latest === undefined || latest.conclusion !== "success";
  });
}
