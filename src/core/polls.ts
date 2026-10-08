/** Single-choice polls: one vote per user, vote changes allowed until the poll is closed. */

export interface Poll {
  readonly id: string;
  readonly options: readonly string[];
  readonly closed: boolean;
  /** Maps voter id to the chosen option; a user can hold at most one entry. */
  readonly votes: Readonly<Record<string, string>>;
}

export type PollResult =
  | {readonly ok: true; readonly poll: Poll}
  | {readonly ok: false; readonly error: string};

/** Casting again replaces the earlier vote, so a user is never counted twice. */
export function vote(poll: Poll, userId: string, option: string): PollResult {
  if (poll.closed) return {ok: false, error: "This poll is closed"};
  if (!poll.options.includes(option)) return {ok: false, error: "That option does not exist"};
  return {ok: true, poll: {...poll, votes: {...poll.votes, [userId]: option}}};
}

export function closePoll(poll: Poll): Poll {
  return {...poll, closed: true};
}

/** Every option appears in the counts, including those with zero votes. */
export function results(poll: Poll): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(poll.options.map((option) => [option, 0]));
  for (const option of Object.values(poll.votes)) counts[option] = (counts[option] ?? 0) + 1;
  return counts;
}
