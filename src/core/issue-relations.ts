/** F05 slice: duplicate-of and sub-issue links. Self-links and cycles are rejected. */

export type RelationKind = "duplicate-of" | "sub-issue-of";

/** `from` is a duplicate of `to`, or a sub-issue of `to`. */
export interface IssueLink {
  readonly kind: RelationKind;
  readonly from: number;
  readonly to: number;
}

export type LinkResult = {readonly ok: true; readonly links: readonly IssueLink[]} | {readonly ok: false; readonly error: string};

function targetOf(links: readonly IssueLink[], kind: RelationKind, from: number): number | undefined {
  return links.find((link) => link.kind === kind && link.from === from)?.to;
}

/** True when following the chain from `start` reaches `goal`. */
function reaches(links: readonly IssueLink[], kind: RelationKind, start: number, goal: number): boolean {
  const visited = new Set<number>();
  let current: number | undefined = start;
  while (current !== undefined && !visited.has(current)) {
    if (current === goal) return true;
    visited.add(current);
    current = targetOf(links, kind, current);
  }
  return false;
}

/** Adds a link. Each issue has at most one duplicate target and at most one parent; repeating an identical link is a no-op. */
export function addLink(links: readonly IssueLink[], link: IssueLink): LinkResult {
  if (!Number.isInteger(link.from) || !Number.isInteger(link.to)) return {ok: false, error: "Links need issue numbers"};
  if (link.from === link.to) return {ok: false, error: "An issue cannot be linked to itself"};
  const existing = targetOf(links, link.kind, link.from);
  if (existing === link.to) return {ok: true, links};
  if (existing !== undefined) {
    return {ok: false, error: link.kind === "duplicate-of" ? "Issue is already marked as a duplicate" : "Issue already has a parent"};
  }
  if (reaches(links, link.kind, link.to, link.from)) return {ok: false, error: "This link would create a cycle"};
  return {ok: true, links: [...links, link]};
}

/** Removes a link if present. */
export function removeLink(links: readonly IssueLink[], link: IssueLink): readonly IssueLink[] {
  return links.filter((candidate) => !(candidate.kind === link.kind && candidate.from === link.from && candidate.to === link.to));
}

/** Direct sub-issues of a parent, in link order. */
export function subIssues(links: readonly IssueLink[], parent: number): readonly number[] {
  return links.filter((link) => link.kind === "sub-issue-of" && link.to === parent).map((link) => link.from);
}

/** Issues marked as duplicates of the given canonical issue. */
export function duplicatesOf(links: readonly IssueLink[], canonical: number): readonly number[] {
  return links.filter((link) => link.kind === "duplicate-of" && link.to === canonical).map((link) => link.from);
}
