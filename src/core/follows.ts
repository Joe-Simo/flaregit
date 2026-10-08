/** Follow graph: no self-follows, idempotent changes, and follower counts that ignore flagged synthetic accounts. */

export interface FollowGraph {
  /** Edges as `followerId` to the set of followed ids. */
  readonly following: Readonly<Record<string, readonly string[]>>;
}

export type FollowResult =
  | {readonly ok: true; readonly graph: FollowGraph}
  | {readonly ok: false; readonly error: string};

export const emptyGraph: FollowGraph = {following: {}};

export function follow(graph: FollowGraph, followerId: string, targetId: string): FollowResult {
  if (followerId === targetId) return {ok: false, error: "You cannot follow yourself"};
  const current = graph.following[followerId] ?? [];
  if (current.includes(targetId)) return {ok: true, graph};
  return {ok: true, graph: {following: {...graph.following, [followerId]: [...current, targetId]}}};
}

/** Unfollowing someone who is not followed is a no-op. */
export function unfollow(graph: FollowGraph, followerId: string, targetId: string): FollowGraph {
  const current = graph.following[followerId] ?? [];
  if (!current.includes(targetId)) return graph;
  return {following: {...graph.following, [followerId]: current.filter((id) => id !== targetId)}};
}

/** Followers flagged as synthetic never inflate the count. */
export function followerCount(graph: FollowGraph, targetId: string, syntheticIds: ReadonlySet<string>): number {
  return Object.entries(graph.following).filter(([followerId, targets]) => targets.includes(targetId) && !syntheticIds.has(followerId)).length;
}
