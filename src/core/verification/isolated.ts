import { spawn, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TestResultItem, VerificationEvidence } from "../types.js";
import type { VerifierContext } from "../verifier.js";
import { createExecutionBoundary, executionEnv, type ExecutionBoundary } from "./execution.js";

const PLATFORM_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const RUNNER = path.join(import.meta.dirname, "runner.ts");
const CHECK_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1_000_000;

export interface IsolatedVerificationSpec {
  identity: string;
  suite: string;
  /** Absolute path of the platform-owned checks module (exports runChecks). */
  checksModule: string;
  observationModule: string;
  toolchainDigest?: string;
}

function git(cwd: string, args: string[]) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8" });
}

/** Environment passed to anything that executes contributor code: no secrets, nothing inherited. */
export const scrubbedEnv = executionEnv;

function typecheckCandidate(dir: string, env: NodeJS.ProcessEnv, boundary: ExecutionBoundary): TestResultItem {
  const started = performance.now();
  const tsconfig = path.join(dir, ".flaregit-tsconfig.json");
  fs.writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        jsx: "react-jsx",
        module: "ESNext",
        moduleResolution: "bundler",
        target: "ESNext",
        lib: ["ESNext", "DOM"],
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      include: ["src"],
    })
  );
  const tsc = path.join(PLATFORM_ROOT, "node_modules", "typescript", "bin", "tsc");
  const invocation = boundary.command(process.execPath, [tsc, "-p", tsconfig]);
  const res = spawnSync(invocation.executable, invocation.args, {
    cwd: dir,
    env,
    encoding: "utf-8",
    timeout: CHECK_TIMEOUT_MS * 2,
  });
  const passed = res.status === 0;
  return {
    testId: "PLATFORM-TYPECHECK",
    description: "Merged candidate type-checks against its own module interfaces",
    passed,
    message: passed ? undefined : (res.stdout + res.stderr).trim().split("\n").slice(0, 12).join("\n"),
    durationMs: Math.round(performance.now() - started),
  };
}

/**
 * Check out the exact candidate commit into a fresh workspace, type-check it, then run the
 * platform-owned behavioral checks against it in a separate scrubbed process.
 */
export async function verifyInIsolation(
  spec: IsolatedVerificationSpec,
  ctx: VerifierContext
): Promise<VerificationEvidence> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-verify-"));
  const dir = path.join(work, "candidate");
  const home = path.join(work, "home");
  fs.mkdirSync(home);
  let boundary: ExecutionBoundary | undefined;
  try {
    const clone = spawnSync("git", ["clone", "--quiet", "--no-hardlinks", ctx.repoDir, dir], { encoding: "utf-8" });
    if (clone.status !== 0) throw new Error(`Verification clone failed: ${clone.stderr}`);
    const checkout = git(dir, ["checkout", "--quiet", "--detach", ctx.candidateCommit]);
    if (checkout.status !== 0) throw new Error(`Candidate commit ${ctx.candidateCommit} unavailable: ${checkout.stderr}`);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    if (head !== ctx.candidateCommit) {
      throw new Error(`Verification checkout ${head} does not match candidate ${ctx.candidateCommit}`);
    }
    const tree = git(dir, ["rev-parse", "HEAD^{tree}"]).stdout.trim();

    // Platform dependencies are exposed read-only-by-convention via symlink; contributor code
    // never supplies its own node_modules (it is not tracked in the repo).
    fs.symlinkSync(path.join(PLATFORM_ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");

    boundary = createExecutionBoundary(work, [dir, home], ctx.repoDir);
    const env = scrubbedEnv(home);
    const items: TestResultItem[] = [typecheckCandidate(dir, env, boundary)];
    const child = await runChecksChild(spec.observationModule, dir, ctx.policy, env, boundary);
    if ("failure" in child) items.push(...child.failure);
    else {
      try {
        const checks = await import(spec.checksModule) as { runChecks(dir: string, policy: Record<string, unknown>, observations: unknown): Promise<TestResultItem[]> };
        items.push(...await checks.runChecks(dir, ctx.policy, child.observations));
      } catch { items.push({ testId: "PLATFORM-CHECK-HARNESS", description: "Protected parent checks completed", passed: false, message: "Candidate observations could not be checked", durationMs: 0 }); }
    }

    const passedCount = items.filter((i) => i.passed).length;
    const failedCount = items.length - passedCount;
    const checksBytes = fs.readFileSync(spec.checksModule);

    return {
      id: `ev_${crypto.randomUUID().slice(0, 12)}`,
      candidateCommit: ctx.candidateCommit,
      candidateTree: tree,
      expectedAcceptedBase: ctx.expectedBase,
      requirementsVersion: ctx.requirementsVersion,
      testBundleDigest: crypto.createHash("sha256").update(checksBytes).update(fs.readFileSync(spec.observationModule)).digest("hex"),
      toolchainDigest: spec.toolchainDigest ?? `bun-${Bun.version}`,
      builtOutputDigest: crypto
        .createHash("sha256")
        .update(`tree:${tree}:policy:${JSON.stringify(ctx.policy)}`)
        .digest("hex"),
      verifierIdentity: boundary.isolated ? spec.identity : `${spec.identity}-local-unprivileged-boundary-unverified`,
      policy: ctx.policy,
      testResults: [{ suite: spec.suite, passed: failedCount === 0, passedCount, failedCount, items }],
      timestamp: new Date().toISOString(),
      status: failedCount === 0 ? "passed" : "failed",
    };
  } finally {
    boundary?.dispose();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function runChecksChild(
  checksModule: string,
  dir: string,
  policy: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  boundary: ExecutionBoundary
): Promise<{ observations: unknown } | { failure: TestResultItem[] }> {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return new Promise((resolve) => {
    const failure = (message: string): { failure: TestResultItem[] } => ({ failure: [
      { testId: "PLATFORM-CHECK-HARNESS", description: "Protected checks completed", passed: false, message, durationMs: 0 },
    ] });
    const invocation = boundary.command(process.execPath, [RUNNER, checksModule, dir]);
    const child = spawn(invocation.executable, invocation.args, { ...boundary.options(env), cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), CHECK_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (overflow) return resolve(failure("Candidate produced excessive output"));
      if (signal) return resolve(failure(`Checks terminated by ${signal} (timeout ${CHECK_TIMEOUT_MS}ms)`));
      const line = stdout.split("\n").find((l) => l.startsWith(`${nonce}:`));
      if (code !== 0 || !line) return resolve(failure(`Checks crashed (exit ${code}): ${stderr.trim().slice(-800)}`));
      try {
        resolve({ observations: JSON.parse(line.slice(nonce.length + 1)) as unknown });
      } catch {
        resolve(failure("Checks produced unparseable result"));
      }
    });
    child.stdin.end(JSON.stringify({ nonce, policy }));
  });
}
