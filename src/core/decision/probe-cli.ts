/**
 * Contradiction probe entrypoint baked into the integrator image:
 *   bun src/core/decision/probe-cli.ts <repoDir> <commit> '<{"probe":{...},"input":{...}}>'
 * Supervisor only: it snapshots the exact commit into a disposable directory, runs the untrusted
 * probe-runner.ts there under the same execution boundary as protected verification (separate Linux
 * identity, no credentials, minimal environment, hard timeout) and prints one JSON outcome line.
 */
import { spawn, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { createExecutionBoundary, executionEnv, type ExecutionBoundary } from "../verification/execution.js";
import { requirementProbeSchema, type ProbeOutcome } from "./contradiction-proof.js";

const RUNNER = path.join(import.meta.dirname, "probe-runner.ts");
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 256_000;
const requestSchema = z.object({ probe: requirementProbeSchema, input: z.record(z.string(), z.unknown()) }).strict();

function runChild(dir: string, request: z.infer<typeof requestSchema>, env: NodeJS.ProcessEnv, boundary: ExecutionBoundary): Promise<ProbeOutcome> {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return new Promise((resolve) => {
    const invocation = boundary.command(process.execPath, [RUNNER, dir]);
    const child = spawn(invocation.executable, invocation.args, { ...boundary.options(env), cwd: dir, env, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "", overflow = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > MAX_OUTPUT) { overflow = true; child.kill("SIGKILL"); } });
    child.on("close", (_code, signal) => {
      clearTimeout(timer);
      if (overflow) return resolve({ ok: false, error: "The code printed too much output" });
      if (signal) return resolve({ ok: false, error: `The code did not finish within ${TIMEOUT_MS / 1000} seconds` });
      const line = stdout.split("\n").find((value) => value.startsWith(`${nonce}:`));
      if (!line) return resolve({ ok: false, error: "The code stopped without a result" });
      try {
        const parsed = JSON.parse(line.slice(nonce.length + 1)) as ProbeOutcome;
        resolve(parsed.ok === true ? { ok: true, output: parsed.output } : { ok: false, error: String((parsed as { error?: unknown }).error ?? "The code reported an error").slice(0, 500) });
      } catch { resolve({ ok: false, error: "The code reported an unreadable result" }); }
    });
    child.on("error", () => { clearTimeout(timer); resolve({ ok: false, error: "The code could not be started" }); });
    child.stdin.end(JSON.stringify({ nonce, ...request }));
  });
}

async function main(): Promise<ProbeOutcome> {
  const [repoDir, commit, raw] = process.argv.slice(2);
  if (!repoDir || !commit || !/^[a-f0-9]{40}$/.test(commit) || !raw) return { ok: false, error: "Probe request is incomplete" };
  const request = requestSchema.safeParse(JSON.parse(raw));
  if (!request.success) return { ok: false, error: "Probe request is invalid" };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-probe-"));
  const dir = path.join(work, "candidate"), home = path.join(work, "home");
  fs.mkdirSync(home);
  let boundary: ExecutionBoundary | undefined;
  try {
    if (spawnSync("git", ["clone", "--quiet", "--no-hardlinks", "--no-checkout", repoDir, dir]).status !== 0) return { ok: false, error: "The commit could not be copied for running" };
    if (spawnSync("git", ["-C", dir, "-c", "core.hooksPath=/dev/null", "-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", commit]).status !== 0) return { ok: false, error: "The commit is unavailable" };
    if (spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf-8" }).stdout.trim() !== commit) return { ok: false, error: "The checkout does not match the commit" };
    fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
    boundary = createExecutionBoundary(work, [dir, home], repoDir);
    return await runChild(dir, request.data, executionEnv(home), boundary);
  } finally {
    boundary?.dispose();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

let outcome: ProbeOutcome;
try { outcome = await main(); } catch { outcome = { ok: false, error: "The code could not be run in isolation" }; }
console.log(JSON.stringify(outcome));
