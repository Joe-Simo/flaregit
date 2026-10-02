/**
 * Child-process entry used by the protected verifier. Contributor code is loaded only inside this
 * short-lived process, which receives a scrubbed environment (no tokens, no account identifiers).
 *
 * argv: <observationModule> <candidateDir>   stdin: JSON { nonce, policy }
 * stdout: one framed JSON observation. The frame separates model logs from observations;
 * it is not a trust boundary. Only parent-owned checks assign pass/fail results.
 */

const [, , checksModule, candidateDir] = process.argv;
if (!checksModule || !candidateDir) {
  console.error("usage: runner <checksModule> <candidateDir>");
  process.exit(2);
}

const input = JSON.parse(await Bun.stdin.text()) as { nonce: string; policy: Record<string, unknown> };
const nonce = input.nonce;
const policy = input.policy;
// Capture reporting primitives before loading any candidate code. The child emits
// observations, never trusted check results.
const serialize = JSON.stringify.bind(JSON);
const write = Bun.write.bind(Bun);
const exit = process.exit.bind(process);

const mod = (await import(checksModule)) as {
  observe: (dir: string, policy: Record<string, unknown>) => Promise<unknown>;
};
const observations = await mod.observe(candidateDir, policy);
const line = `${nonce}:${serialize(observations)}\n`;
await write(Bun.stdout, line);
exit(0);
