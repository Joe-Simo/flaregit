import { createHash } from 'node:crypto';

/** Cached private bundles only. The protected builder proves closure and digest; multipart R2 metadata binds those receipts.
 * R2 SHA256 is optional for multipart uploads. The streamed bytes are rehashed before the final chunk is released. */
import type { PrivateRecoveryReceipt } from './private-recovery';
import { recoveryBranchFields, recoveryBranchMetadataMatches } from './private-recovery-branch';
export type RecoverySnapshot = Pick<PrivateRecoveryReceipt, 'projectId' | 'incarnation' | 'commit' | 'tree' | 'journalId' | 'objectScope' | 'acceptedRef' | 'acceptedRootVersion'>;
export interface RecoveryObject {
  body: ReadableStream<Uint8Array>;
  size: number;
  customMetadata?: Record<string, string>;
  checksums: { sha256?: ArrayBuffer };
}
export interface PrivateRecoveryDownloadOptions {
  snapshot: RecoverySnapshot;
  receipt: PrivateRecoveryReceipt;
  objectKey: string;
  /** Must perform fresh durable authorization; never cache a positive answer. */
  authorize: (snapshot: Readonly<RecoverySnapshot>) => Promise<boolean>;
  getObject: (key: string) => Promise<RecoveryObject | null>;
}
const fields = ['projectId', 'incarnation', 'commit', 'tree', 'journalId', 'objectScope'] as const;
const limit = 512 * 1024 * 1024;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const error = (status: number) => new Response('Private recovery download unavailable', { status, headers });
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('');
export async function downloadPrivateRecovery(request: Request, options: PrivateRecoveryDownloadOptions): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(405);
  if (request.headers.has('Range') || request.headers.has('X-HTTP-Method-Override')) return error(400);
  const snapshot = Object.freeze({ ...options.snapshot });
  const receipt = Object.freeze({ ...options.receipt });
  try { recoveryBranchFields(snapshot); recoveryBranchFields(receipt); } catch { return error(409); }
  if (fields.some(field => !snapshot[field] || snapshot[field] !== receipt[field]) ||
      snapshot.acceptedRef !== receipt.acceptedRef || snapshot.acceptedRootVersion !== receipt.acceptedRootVersion ||
      !/^[a-f0-9]{40,64}$/.test(snapshot.commit) || !/^[a-f0-9]{40,64}$/.test(snapshot.tree) ||
      snapshot.objectScope !== 'exact-accepted-reachable-closure' || !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
      !options.objectKey || !Number.isSafeInteger(receipt.size) || receipt.size <= 0 || receipt.size > limit) return error(409);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stopped = false;
  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopped = true; request.signal.removeEventListener('abort', aborted);
    stopPromise = Promise.resolve(reader?.cancel()).then(() => {}, () => {});
    return stopPromise;
  };
  const aborted = () => { void stop(); };
  const authorized = async () => !stopped && !request.signal.aborted && await options.authorize(snapshot);
  try {
    if (!await authorized()) return error(403);
    const object = await options.getObject(options.objectKey);
    if (!object) return error(404);
    reader = object.body.getReader();
    request.signal.addEventListener('abort', aborted, { once: true });
    if (object.size !== receipt.size || (object.checksums.sha256 && hex(object.checksums.sha256) !== receipt.sha256) || object.customMetadata?.sha256 !== receipt.sha256 ||
        fields.some(field => object.customMetadata?.[field] !== receipt[field]) || !recoveryBranchMetadataMatches(snapshot, object.customMetadata)) { await stop(); return error(409); }
    if (!await authorized()) { await stop(); return error(403); }
    const responseHeaders = { ...headers, 'Content-Type': 'application/x-git-bundle', 'Content-Length': String(receipt.size),
      'X-FlareGit-SHA256': receipt.sha256,
      ...(snapshot.acceptedRef !== undefined ? { 'X-FlareGit-Accepted-Ref': snapshot.acceptedRef } : {}),
      ...(snapshot.acceptedRootVersion !== undefined ? { 'X-FlareGit-Accepted-Root-Version': String(snapshot.acceptedRootVersion) } : {}),
      'Content-Disposition': `attachment; filename="recovery-${receipt.commit}.bundle"` };
    if (request.method === 'HEAD') { await stop(); return new Response(null, { headers: responseHeaders }); }
    let pending: Uint8Array | undefined, offset = 0, sent = 0;
    const digest = createHash('sha256');
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (stopped || request.signal.aborted) throw new Error();
          if (!pending || offset === pending.byteLength) {
            const next = await reader!.read();
            if (next.done) {
              if (sent !== receipt.size || !await authorized()) throw new Error();
              await stop(); controller.close(); return;
            }
            pending = next.value; offset = 0;
            if (sent + pending.byteLength > receipt.size) throw new Error();
          }
          const part = pending.subarray(offset, Math.min(offset + 65_536, pending.byteLength));
          if (!await authorized()) throw new Error();
          digest.update(part);
          offset += part.byteLength; sent += part.byteLength;
          if (sent === receipt.size) {
            const terminal = await reader!.read();
            if (!terminal.done || digest.digest('hex') !== receipt.sha256 || !await authorized()) throw new Error();
            await stop(); controller.enqueue(part); controller.close(); return;
          }
          controller.enqueue(part);
        } catch { await stop(); controller.error(new Error('Private recovery download interrupted')); }
      },
      cancel: stop,
    }, { highWaterMark: 0 });
    return new Response(body, { headers: responseHeaders });
  } catch { await stop(); return error(503); }
}
