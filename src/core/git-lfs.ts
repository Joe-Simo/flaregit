/** F02 slice: Git LFS batch validation and object verification. Pure logic; the R2-backed store is wired separately. */

export const LFS_MAX_BATCH_OBJECTS = 100;
export const LFS_MAX_OBJECT_BYTES = 2 * 1024 * 1024 * 1024;

export interface LfsObjectRef {
  readonly oid: string;
  readonly size: number;
}

export type LfsBatchRequest =
  | { readonly ok: true; readonly operation: "download" | "upload"; readonly objects: LfsObjectRef[] }
  | { readonly ok: false; readonly status: 400 | 413; readonly error: string };

const OID_PATTERN = /^[a-f0-9]{64}$/;

/** Validates an LFS batch request before any upload is accepted: operation, transfer, object count, OID and size. */
export function validateLfsBatch(input: unknown, maxObjectBytes = LFS_MAX_OBJECT_BYTES): LfsBatchRequest {
  if (typeof input !== "object" || input === null) return { ok: false, status: 400, error: "LFS batch request must be an object" };
  const batch = input as Record<string, unknown>;
  if (batch.operation !== "download" && batch.operation !== "upload") return { ok: false, status: 400, error: "LFS operation must be download or upload" };
  if (batch.transfers !== undefined && (!Array.isArray(batch.transfers) || !batch.transfers.includes("basic"))) return { ok: false, status: 400, error: "Only the basic LFS transfer is supported" };
  if (!Array.isArray(batch.objects)) return { ok: false, status: 400, error: "LFS batch must list objects" };
  if (batch.objects.length > LFS_MAX_BATCH_OBJECTS) return { ok: false, status: 413, error: `An LFS batch can list at most ${LFS_MAX_BATCH_OBJECTS} objects` };
  const objects: LfsObjectRef[] = [];
  for (const entry of batch.objects) {
    if (typeof entry !== "object" || entry === null) return { ok: false, status: 400, error: "Each LFS object must be an object" };
    const object = entry as Record<string, unknown>;
    if (typeof object.oid !== "string" || !OID_PATTERN.test(object.oid)) return { ok: false, status: 400, error: "Each LFS object needs a 64-character lowercase SHA-256 oid" };
    if (typeof object.size !== "number" || !Number.isSafeInteger(object.size) || object.size < 0) return { ok: false, status: 400, error: "Each LFS object needs a non-negative integer size" };
    if (object.size > maxObjectBytes) return { ok: false, status: 413, error: "LFS object exceeds the size limit" };
    objects.push({ oid: object.oid, size: object.size });
  }
  return { ok: true, operation: batch.operation, objects };
}

/** SHA-256 of the object bytes, lowercase hex. The OID is always derived from content, never trusted from the pointer. */
export async function lfsOidOf(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Accepts an uploaded object only when its actual bytes match the declared size and SHA-256 OID. */
export async function verifyLfsObject(object: LfsObjectRef, bytes: BufferSource): Promise<{ ok: true } | { ok: false; error: string }> {
  if (bytes.byteLength !== object.size) return { ok: false, error: "Uploaded LFS object size does not match the declared size" };
  if ((await lfsOidOf(bytes)) !== object.oid) return { ok: false, error: "Uploaded LFS object hash does not match its oid" };
  return { ok: true };
}
