import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Bun/Miniflare emulator shutdown can stall later emulator instances in the same
 * test process. Each real workerd fixture gets its own process and event loop.
 */
export async function workerdChild(file: string): Promise<boolean> {
  if (process.env.FLAREGIT_WORKERD_TEST_FILE === file) return false;
  const ownedDirectory = await mkdtemp(join(tmpdir(), "flaregit-workerd-child-"));
  let stdout = "", stderr = "";
  try {
    const child = Bun.spawn([process.execPath, "test", file], {
      env: { ...process.env, TMPDIR: ownedDirectory, FLAREGIT_WORKERD_TEST_FILE: file }, stdout: "pipe", stderr: "pipe",
    });
    const result = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    [stdout, stderr] = result;
    if (result[2] !== 0) throw new Error("Child exit was unsuccessful");
    expect(result[2]).toBe(0);
    // Only this successfully exited child owns this directory. Never sweep the
    // parent's temp root or another fixture's cache; failures retain evidence.
    await rm(ownedDirectory, { recursive: true, force: true });
    return true;
  } catch {
    throw new Error(`Owned workerd fixture failed or cleanup is unconfirmed. Retained artifacts: ${ownedDirectory}\n${stdout}\n${stderr}`);
  }
}
