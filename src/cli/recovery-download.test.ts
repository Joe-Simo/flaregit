import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadRecoveryBundle, recoveryDownloadUrl } from "./recovery-download.js";
const ids = { origin: "https://flaregit.com", repositoryId: "p123456789abc", snapshotId: "12345678-1234-1234-1234-123456789abc", token: "private-token" };
test("download URL rejects unsafe credential destinations", () => {
  for (const origin of ["http://flaregit.com", "https://token@flaregit.com", "https://flaregit.com/path", "https://flaregit.com?token=secret"]) expect(() => recoveryDownloadUrl(origin, ids.repositoryId, ids.snapshotId)).toThrow();
});
test("streams chunks and verifies before publishing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flaregit-download-"));
  try {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    const digest = createHash("sha256").update(chunks[0]!).update(chunks[1]!).digest("hex");
    const fetcher: NonNullable<Parameters<typeof downloadRecoveryBundle>[0]["fetcher"]> = async (_url, options) => {
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer private-token");
      return new Response(new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }), { headers: { "Content-Length": "4", "X-FlareGit-SHA256": digest } });
    };
    const result = await downloadRecoveryBundle({ ...ids, output: join(dir, "repo.bundle"), fetcher });
    expect(result.bytes).toBe(4);
    expect([...await readFile(result.output)]).toEqual([1, 2, 3, 4]);
    expect(await readdir(dir)).toEqual(["repo.bundle"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("truncation, bad digest and abort leave no partial file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flaregit-download-"));
  try {
    for (const mode of ["truncated", "digest", "aborted"]) {
      const controller = new AbortController();
      const fetcher: NonNullable<Parameters<typeof downloadRecoveryBundle>[0]["fetcher"]> = async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array([1])); if (mode === "aborted") controller.abort(); stream.close(); } }), { headers: { "Content-Length": mode === "truncated" ? "2" : "1", "X-FlareGit-SHA256": "0".repeat(64) } });
      await expect(downloadRecoveryBundle({ ...ids, output: join(dir, "repo.bundle"), signal: controller.signal, fetcher })).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("concurrent destination is preserved and invalid header stream is cancelled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flaregit-download-"));
  const output = join(dir, "repo.bundle");
  try {
    const digest = createHash("sha256").update(new Uint8Array([1])).digest("hex");
    const fetcher: NonNullable<Parameters<typeof downloadRecoveryBundle>[0]["fetcher"]> = async () => {
      await writeFile(output, "other file");
      return new Response(new Uint8Array([1]), { headers: { "Content-Length": "1", "X-FlareGit-SHA256": digest } });
    };
    await expect(downloadRecoveryBundle({ ...ids, output, fetcher })).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("other file");
    expect(await readdir(dir)).toEqual(["repo.bundle"]);
    let cancelled = false;
    const invalid: NonNullable<Parameters<typeof downloadRecoveryBundle>[0]["fetcher"]> = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    await expect(downloadRecoveryBundle({ ...ids, output: join(dir, "second.bundle"), fetcher: invalid })).rejects.toThrow();
    expect(cancelled).toBe(true);
    expect(await readdir(dir)).toEqual(["repo.bundle"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
