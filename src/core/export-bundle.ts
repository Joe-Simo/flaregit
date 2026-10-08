/** F15 slice: export manifest. Every exported object carries a digest so a migration can be verified, and private objects stay out unless the requester may read them. */

export interface ExportObject {
  readonly kind: "issue" | "comment" | "label" | "milestone";
  readonly id: string;
  readonly body: string;
  readonly private: boolean;
}

export interface ManifestEntry {
  readonly kind: ExportObject["kind"];
  readonly id: string;
  readonly sha256: string;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildManifest(objects: readonly ExportObject[], canReadPrivate: boolean): Promise<ManifestEntry[]> {
  const included = objects.filter((object) => canReadPrivate || !object.private);
  return Promise.all(included.map(async (object) => ({kind: object.kind, id: object.id, sha256: await sha256(object.body)})));
}

/** Returns the ids whose content no longer matches the manifest. */
export async function verifyManifest(manifest: readonly ManifestEntry[], objects: readonly ExportObject[]): Promise<string[]> {
  const byId = new Map(objects.map((object) => [`${object.kind}:${object.id}`, object]));
  const bad: string[] = [];
  for (const entry of manifest) {
    const object = byId.get(`${entry.kind}:${entry.id}`);
    if (!object || (await sha256(object.body)) !== entry.sha256) bad.push(entry.id);
  }
  return bad;
}
