/** F15 slice: verified import. Nothing is written unless every object matches its manifest digest, the manifest and objects are well formed, and no existing object differs from the bundle. */
import {BUNDLE_KINDS, buildManifest, verifyManifest, type ExportObject, type ManifestEntry} from "./export-bundle";

export type BundleKind = ExportObject["kind"];

const ALLOWED_KINDS: ReadonlySet<string> = new Set(BUNDLE_KINDS);
import {importRedirectTable} from "./redirects";

/** The store an import writes into. `get` lets the import tell an identical body from a conflicting one. */
export interface BundleStore {
  has(kind: BundleKind, id: string): boolean;
  get(kind: BundleKind, id: string): string | undefined;
  put(kind: BundleKind, id: string, body: string): void;
}

export interface MemoryStore extends BundleStore {
  entries(): [string, string][];
}

export type ImportResult =
  | {readonly ok: true; readonly imported: number; readonly skipped: number; readonly conflicts: readonly []}
  | {readonly ok: false; readonly error: string; readonly conflicts: readonly string[]; readonly written: readonly string[]};

function storeKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function reject(error: string, conflicts: readonly string[] = []): ImportResult {
  return {ok: false, error, conflicts, written: []};
}

export function createMemoryStore(): MemoryStore {
  const bodies = new Map<string, string>();
  return {
    has: (kind, id) => bodies.has(storeKey(kind, id)),
    get: (kind, id) => bodies.get(storeKey(kind, id)),
    put: (kind, id, body) => {
      bodies.set(storeKey(kind, id), body);
    },
    entries: () => [...bodies],
  };
}

/**
 * Verifies the whole bundle before writing anything. Any malformed entry, digest mismatch, missing or unlisted object,
 * or existing object with a different body aborts the import with zero writes. Re-importing identical content is a no-op.
 */
export async function importBundle(
  manifest: readonly ManifestEntry[],
  objects: readonly ExportObject[],
  target: BundleStore,
): Promise<ImportResult> {
  if (!Array.isArray(manifest) || !Array.isArray(objects)) return reject("Manifest and objects must be lists");
  const listed = new Set<string>();
  for (const entry of manifest) {
    if (typeof entry !== "object" || entry === null || typeof entry.id !== "string" || !entry.id.trim() || entry.id !== entry.id.trim() || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) return reject("Malformed manifest entry");
    if (!ALLOWED_KINDS.has(entry.kind)) return reject(`Manifest entry has unknown kind: ${entry.kind}`);
    const key = storeKey(entry.kind, entry.id);
    if (listed.has(key)) return reject(`Manifest lists ${key} more than once`);
    listed.add(key);
  }

  const included = new Set<string>();
  for (const object of objects) {
    if (typeof object !== "object" || object === null || typeof object.id !== "string" || !object.id.trim() || object.id !== object.id.trim() || typeof object.body !== "string" || typeof object.private !== "boolean") return reject("Malformed bundle object");
    if (!ALLOWED_KINDS.has(object.kind)) return reject(`Object has unknown kind: ${object.kind}`);
    const key = storeKey(object.kind, object.id);
    if (!listed.has(key)) return reject(`Object ${key} is not listed in the manifest`);
    if (included.has(key)) return reject(`Object ${key} is included more than once`);
    included.add(key);
    if (object.kind === "redirect-table") {
      let value: unknown;
      try { value = JSON.parse(object.body); } catch { return reject("Malformed redirect snapshot JSON"); }
      const restored = importRedirectTable(value, Date.now);
      if (!restored.ok) return reject(`Invalid redirect snapshot: ${restored.error}`);
    }
  }

  const mismatched = await verifyManifest(manifest, objects);
  if (mismatched.length > 0) return reject(`Digest mismatch or missing object: ${mismatched.join(", ")}`);

  const conflicts: string[] = [];
  const toWrite: ExportObject[] = [];
  let skipped = 0;
  for (const object of objects) {
    if (!target.has(object.kind, object.id)) toWrite.push(object);
    else if (target.get(object.kind, object.id) === object.body) skipped += 1;
    else conflicts.push(storeKey(object.kind, object.id));
  }
  if (conflicts.length > 0) return reject("Existing objects differ from the bundle; nothing was written", conflicts);

  // Store writes are not transactional. If a write throws, the objects already written are reported so the caller can see the partial state.
  const written: string[] = [];
  for (const object of toWrite) {
    try {
      target.put(object.kind, object.id, object.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown store error";
      return {ok: false, error: `Store write failed after ${written.length} objects: ${message}`, conflicts: [], written};
    }
    written.push(storeKey(object.kind, object.id));
  }
  return {ok: true, imported: toWrite.length, skipped, conflicts: []};
}

/** Exports the objects the requester may read, imports that bundle into a fresh store, and reports whether every exported object reads back unchanged. */
export async function exportRoundTripCheck(objects: readonly ExportObject[], canReadPrivate: boolean): Promise<boolean> {
  const manifest = await buildManifest(objects, canReadPrivate);
  const exported = objects.filter((object) => canReadPrivate || !object.private);
  const store = createMemoryStore();
  const result = await importBundle(manifest, exported, store);
  return result.ok && exported.every((object) => store.get(object.kind, object.id) === object.body);
}
