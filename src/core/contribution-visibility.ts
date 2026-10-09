/** Contribution counts: private-repo activity is counted for the owner only unless they opt in, and viewers never see private repo names. */

export interface Contribution {
  readonly repo: string;
  readonly repoPrivate: boolean;
}

export interface ContributionSummary {
  readonly total: number;
  /** Repo names shown to the viewer; private names are never included for anyone but the owner. */
  readonly repos: readonly string[];
}

export function summarize(contributions: readonly Contribution[], viewerIsOwner: boolean, ownerOptedIn: boolean): ContributionSummary {
  const counted = contributions.filter((entry) => !entry.repoPrivate || viewerIsOwner || ownerOptedIn);
  const repos = viewerIsOwner ? counted.map((entry) => entry.repo) : counted.filter((entry) => !entry.repoPrivate).map((entry) => entry.repo);
  return {total: counted.length, repos: [...new Set(repos)]};
}
