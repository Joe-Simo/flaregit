/** F01 slice: repository topics. Pure validation and normalization; storage and routes are wired separately. */

export const MAX_REPOSITORY_TOPICS = 20;
const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;

export type TopicsResult = { readonly ok: true; readonly topics: string[] } | { readonly ok: false; readonly error: string };

/** Accepts only a list of lowercase topic names; returns a sorted, de-duplicated list. Anything else is refused. */
export function normalizeTopics(input: unknown): TopicsResult {
  if (!Array.isArray(input)) return { ok: false, error: "Topics must be a list" };
  if (input.length > MAX_REPOSITORY_TOPICS) return { ok: false, error: `A repository can have at most ${MAX_REPOSITORY_TOPICS} topics` };
  for (const topic of input) {
    if (typeof topic !== "string" || !TOPIC_PATTERN.test(topic)) return { ok: false, error: "Each topic must be 1-50 lowercase letters, digits or hyphens, starting with a letter or digit" };
  }
  return { ok: true, topics: [...new Set(input as string[])].sort() };
}
