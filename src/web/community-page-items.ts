/** Keep one published record per identity, in discovery order, across overlapping pages. */
export function appendCommunityItems<T>(previous: readonly T[], incoming: readonly T[], identity: (item: T) => string): T[] {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of [previous, incoming]) {
    for (const item of page) {
      const key = identity(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}
