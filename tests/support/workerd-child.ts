import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Bun/Miniflare emulator shutdown can stall later emulator instances in the same
 * test process. Each real workerd fixture gets its own process and event loop.
 */
export async function workerdChild(file: string, testName?: string): Promise<boolean> {
  if (testName !== undefined && (!testName || testName.length > 1000 || testName.includes("\0"))) throw new Error("Invalid exact native test name");
  if (process.env.FLAREGIT_WORKERD_TEST_FILE === file) {
    if (testName !== undefined) {
      const directory = process.env.TMPDIR;
      if (process.env.FLAREGIT_WORKERD_TEST_CASE !== testName || !directory || !/^flaregit-workerd-child-[A-Za-z0-9]+$/.test(directory.split(/[\\/]/).at(-1) ?? "")) throw new Error("Exact child case does not match its owned temp scope");
      await Bun.write(join(directory, "case-entered.json"), JSON.stringify({ file, testName }));
    }
    return false;
  }
  const ownedDirectory = await mkdtemp(join(tmpdir(), "flaregit-workerd-child-"));
  let stdout = "", stderr = "";
  try {
    const pattern = testName?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const child = Bun.spawn([process.execPath, "test", file, ...(pattern !== undefined ? ["--test-name-pattern", `^${pattern}$`] : [])], {
      env: { ...process.env, TMPDIR: ownedDirectory, FLAREGIT_WORKERD_TEST_FILE: file, FLAREGIT_WORKERD_TEST_CASE: testName }, stdout: "pipe", stderr: "pipe",
    });
    const result = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    [stdout, stderr] = result;
    if (result[2] !== 0) throw new Error("Child exit was unsuccessful");
    expect(result[2]).toBe(0);
    if (testName !== undefined) {
      const entered = await Bun.file(join(ownedDirectory, "case-entered.json")).json() as { file?: unknown; testName?: unknown };
      if (entered.file !== file || entered.testName !== testName) throw new Error("The exact native test case did not execute");
    }
    // Only this successfully exited child owns this directory. Never sweep the
    // parent's temp root or another fixture's cache; failures retain evidence.
    await rm(ownedDirectory, { recursive: true, force: true });
    return true;
  } catch {
    throw new Error(`Owned workerd fixture failed or cleanup is unconfirmed. Retained artifacts: ${ownedDirectory}\n${stdout}\n${stderr}`);
  }
}
