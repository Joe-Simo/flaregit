import { createHash } from "node:crypto";
import { open, link, unlink, lstat } from "node:fs/promises";
import { resolve } from "node:path";

export function recoveryDownloadUrl(origin: string, repositoryId: string, snapshotId: string): string {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("Use a standard HTTPS FlareGit base URL without credentials, path, query or fragment");
  if (!/^p?[a-f0-9]{12}$/.test(repositoryId) || !/^[a-f0-9-]{36}$/.test(snapshotId)) throw new Error("Specify the exact repository and recovery snapshot IDs");
  return `${url.origin}/api/p/${repositoryId}/recovery/${snapshotId}/bundle`;
}

/** Writes one chunk at a time; a verified receipt is required before publication. */
export async function downloadRecoveryBundle(input: { origin: string; repositoryId: string; snapshotId: string; token: string; output: string; signal?: AbortSignal; fetcher?: (url: string, options: RequestInit) => Promise<Response> }) {
  const url = recoveryDownloadUrl(input.origin, input.repositoryId, input.snapshotId);
  if (!input.token) throw new Error("Sign in with a personal FlareGit API token before downloading");
  const output = resolve(input.output);
  try { await lstat(output); throw new Error("Output already exists; choose a new bundle filename"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const temporary = `${output}.${crypto.randomUUID()}.tmp`;
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await (input.fetcher ?? fetch)(url, { headers: { Authorization: `Bearer ${input.token}`, "Accept-Encoding": "identity" }, redirect: "error", signal: input.signal });
    if (!response.ok) throw new Error(`Recovery download failed (HTTP ${response.status})`);
    reader = response.body?.getReader();
    const lengthHeader = response.headers.get("Content-Length");
    const digest = response.headers.get("X-FlareGit-SHA256");
    const length = Number(lengthHeader);
    if (!lengthHeader || !/^\d+$/.test(lengthHeader) || !Number.isSafeInteger(length) || length < 1 || length > 512 * 1024 * 1024 || !digest || !/^[a-f0-9]{64}$/.test(digest) || !response.body || (response.headers.get("Content-Encoding") && response.headers.get("Content-Encoding") !== "identity")) throw new Error("Recovery download is missing valid size or SHA-256 integrity headers");
    file = await open(temporary, "wx", 0o600);
    if (!reader) throw new Error("Recovery response has no stream");
    const hash = createHash("sha256");
    let bytes = 0;
    while (true) {
      input.signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > length) throw new Error("Recovery download exceeds its recorded size");
      hash.update(chunk.value);
      let offset = 0;
      while (offset < chunk.value.byteLength) {
        input.signal?.throwIfAborted();
        const written = await file.write(chunk.value, offset, chunk.value.byteLength - offset);
        if (!written.bytesWritten) throw new Error("Recovery file write did not progress");
        offset += written.bytesWritten;
      }
    }
    input.signal?.throwIfAborted();
    if (bytes !== length || hash.digest("hex") !== digest) throw new Error("Recovery bundle integrity verification failed");
    await file.sync(); await file.close(); file = undefined;
    // Publishing a hard link is atomic and refuses any concurrently-created destination.
    // The verified temporary inode stays on the same filesystem as the output.
    await link(temporary, output);
    return { output, bytes, sha256: digest };
  } catch {
    throw new Error(input.signal?.aborted ? "Recovery download cancelled; partial file removed" : "Recovery download failed; check access, integrity headers and output location. Partial file removed.");
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
    await file?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}
