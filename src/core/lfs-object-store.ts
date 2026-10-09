/** F02 slice: LFS object storage contract with content verification and per-repository quota. The R2-backed store is wired separately. */

import { verifyLfsObject, type LfsObjectRef } from "./git-lfs";

export type LfsPutResult =
  | { readonly ok: true; readonly stored: boolean }
  | { readonly ok: false; readonly status: 400 | 413; readonly error: string };

export interface LfsObjectStore {
  /** Returns the stored bytes, or null when the repository has no such object. */
  get(repositoryId: string, oid: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** Stores an object only after its bytes match the declared size and SHA-256 oid and the repository stays within quota. */
  put(repositoryId: string, object: LfsObjectRef, bytes: Uint8Array<ArrayBuffer>): Promise<LfsPutResult>;
  exists(repositoryId: string, oid: string): Promise<boolean>;
}

/** In-memory store used by tests. Objects are scoped per repository; the byte cap applies per repository. */
export class InMemoryLfsObjectStore implements LfsObjectStore {
  private readonly repositories = new Map<string, Map<string, Uint8Array<ArrayBuffer>>>();

  constructor(private readonly quotaBytes: number) {
    if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 0) throw new RangeError("LFS quota must be a non-negative integer");
  }

  usedBytes(repositoryId: string): number {
    let total = 0;
    for (const bytes of this.repositories.get(repositoryId)?.values() ?? []) total += bytes.byteLength;
    return total;
  }

  async get(repositoryId: string, oid: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const bytes = this.repositories.get(repositoryId)?.get(oid);
    return bytes ? bytes.slice() : null;
  }

  async exists(repositoryId: string, oid: string): Promise<boolean> {
    return this.repositories.get(repositoryId)?.has(oid) ?? false;
  }

  async put(repositoryId: string, object: LfsObjectRef, bytes: Uint8Array<ArrayBuffer>): Promise<LfsPutResult> {
    const verified = await verifyLfsObject(object, bytes);
    if (!verified.ok) return { ok: false, status: 400, error: verified.error };
    // The oid is content-addressed, so re-uploading an existing object stores nothing and costs no quota.
    if (await this.exists(repositoryId, object.oid)) return { ok: true, stored: false };
    if (this.usedBytes(repositoryId) + bytes.byteLength > this.quotaBytes) {
      return { ok: false, status: 413, error: "Repository LFS storage quota would be exceeded" };
    }
    const objects = this.repositories.get(repositoryId) ?? new Map<string, Uint8Array<ArrayBuffer>>();
    objects.set(object.oid, bytes.slice());
    this.repositories.set(repositoryId, objects);
    return { ok: true, stored: true };
  }
}
