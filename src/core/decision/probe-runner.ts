/**
 * Untrusted child of probe-cli.ts. Reads {nonce, probe, input} from stdin, imports the probed module from the
 * disposable checkout it runs in, calls the export once and reports `<nonce>:<json>`. It exits right after
 * reporting so later timers in the probed code cannot run. All judging happens in the supervisor.
 */
import * as path from "node:path";
import { z } from "zod";
import { requirementProbeSchema, type ProbeOutcome } from "./contradiction-proof.js";

const requestSchema = z.object({ nonce: z.string().regex(/^[a-f0-9]{32}$/), probe: requirementProbeSchema, input: z.record(z.string(), z.unknown()) }).strict();

async function main(): Promise<void> {
  const dir = process.argv[2];
  const request = requestSchema.parse(JSON.parse(await Bun.stdin.text()));
  const report = (outcome: ProbeOutcome): never => {
    let line: string;
    try { line = JSON.stringify(outcome); } catch { line = JSON.stringify({ ok: false, error: "The result cannot be represented as data" }); }
    process.stdout.write(`\n${request.nonce}:${line}\n`);
    process.exit(0);
  };
  if (!dir || !path.isAbsolute(dir)) report({ ok: false, error: "Probe checkout is unavailable" });
  const target = path.resolve(dir!, request.probe.module);
  if (!target.startsWith(path.resolve(dir!) + path.sep)) report({ ok: false, error: "Probe module is outside the checkout" });
  try {
    const loaded = (await import(target)) as Record<string, unknown>;
    const fn = loaded[request.probe.export];
    if (typeof fn !== "function") report({ ok: false, error: `${request.probe.module} does not export ${request.probe.export}` });
    const output: unknown = await (fn as (input: unknown) => unknown)(structuredClone(request.input));
    report({ ok: true, output: JSON.parse(JSON.stringify(output ?? null)) as unknown });
  } catch (error) {
    report({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
  }
}

await main();
