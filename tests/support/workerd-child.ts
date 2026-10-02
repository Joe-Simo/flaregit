import { expect } from "bun:test";

/** Bun/Miniflare emulator shutdown can stall later emulator instances in the same
 * test process. Each real workerd fixture gets its own process and event loop.
 */
export async function workerdChild(file: string): Promise<boolean> {
  if (process.env.FLAREGIT_WORKERD_TEST_FILE === file) return false;
  const child = Bun.spawn([process.execPath, "test", file], {
    env: { ...process.env, FLAREGIT_WORKERD_TEST_FILE: file }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`Owned workerd fixture failed:\n${stdout}\n${stderr}`);
  expect(code).toBe(0);
  return true;
}
