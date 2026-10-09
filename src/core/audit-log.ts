/** F19 slice: tamper-evident audit log. Each entry hashes its predecessor, so edits or removals break verification. */

export interface AuditRecord {
  readonly actor: string;
  readonly action: string;
  readonly previous: string;
  readonly hash: string;
}

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function append(log: readonly AuditRecord[], actor: string, action: string): Promise<AuditRecord[]> {
  const previous = log.at(-1)?.hash ?? "";
  return [...log, {actor, action, previous, hash: await digest(`${previous}|${actor}|${action}`)}];
}

/** Returns the index of the first broken entry, or -1 when the chain is intact. */
export async function firstBroken(log: readonly AuditRecord[]): Promise<number> {
  let previous = "";
  for (const [index, entry] of log.entries()) {
    if (entry.previous !== previous || entry.hash !== (await digest(`${previous}|${entry.actor}|${entry.action}`))) return index;
    previous = entry.hash;
  }
  return -1;
}
