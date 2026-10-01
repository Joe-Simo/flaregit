/**
 * Child-process entry used by the protected verifier. Contributor code is loaded only inside this
 * short-lived process, which receives a scrubbed environment (no tokens, no account identifiers).
 *
 * argv: <checksModule> <candidateDir>   stdin: JSON { nonce, policy }
 * stdout: a single line "<nonce>:<json results>" — the nonce is read before any candidate code is
 * imported, so candidate output cannot forge a result line.
 */
import type { TestResultItem } from "../types.js";

const [, , checksModule, candidateDir] = process.argv;
if (!checksModule || !candidateDir) {
  console.error("usage: runner <checksModule> <candidateDir>");
  process.exit(2);
}

const input = JSON.parse(await Bun.stdin.text()) as { nonce: string; policy: Record<string, unknown> };
const nonce = input.nonce;
const policy = input.policy;

const mod = (await import(checksModule)) as {
  runChecks: (dir: string, policy: Record<string, unknown>) => Promise<TestResultItem[]>;
};
const items = await mod.runChecks(candidateDir, policy);
const line = `${nonce}:${JSON.stringify(items)}\n`;
await Bun.write(Bun.stdout, line);
process.exit(0);
