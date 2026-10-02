import { spawn, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TestResultItem, VerificationEvidence } from "../types.js";
import type { ProtectedVerifier, VerifierContext } from "../verifier.js";
import { createExecutionBoundary, executionEnv, type ExecutionBoundary } from "./execution.js";

import { DEFAULT_PROTECTED_PATHS, isCommandPolicy, type CommandPolicy } from "../command-policy.js";

export { DEFAULT_PROTECTED_PATHS, isCommandPolicy, type CommandPolicy };

const MAX_OUTPUT = 4000;

function runStep(id: string, description: string, command: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, boundary: ExecutionBoundary): Promise<TestResultItem> {
  const started = performance.now();
  return new Promise((resolve) => {
    const invocation = boundary.command("sh", ["-c", command]);
    const child = spawn(invocation.executable, invocation.args, { ...boundary.options(env), cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const take = (d: Buffer) => {
      out = (out + d.toString()).slice(-MAX_OUTPUT * 4);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const passed = code === 0;
      resolve({
        testId: id,
        description,
        passed,
        message: passed ? undefined : (signal ? `terminated by ${signal} (timeout ${Math.round(timeoutMs / 1000)}s)\n` : `exit ${code}\n`) + out.trim().slice(-MAX_OUTPUT),
        durationMs: Math.round(performance.now() - started),
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ testId: id, description, passed: false, message: err.message, durationMs: Math.round(performance.now() - started) });
    });
  });
}

export function createCommandVerifier(policy: CommandPolicy): ProtectedVerifier {
  const identity = "flaregit-command-verifier-v2";
  return {
    identity,
    protectedPaths: policy.protectedPaths ?? DEFAULT_PROTECTED_PATHS,
    defaultPolicy: { ...policy },
    async verify(ctx: VerifierContext): Promise<VerificationEvidence> {
      const p = isCommandPolicy(ctx.policy) ? ctx.policy : policy;
      const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-cmd-"));
      const dir = path.join(work, "candidate");
      const home = path.join(work, "home");
      fs.mkdirSync(home);
      let boundary: ExecutionBoundary | undefined;
      try {
        const clone = spawnSync("git", ["clone", "--quiet", "--no-hardlinks", ctx.repoDir, dir], { encoding: "utf-8" });
        if (clone.status !== 0) throw new Error(`Verification clone failed: ${clone.stderr}`);
        const co = spawnSync("git", ["-C", dir, "checkout", "--quiet", "--detach", ctx.candidateCommit], { encoding: "utf-8" });
        if (co.status !== 0) throw new Error(`Candidate commit unavailable: ${co.stderr}`);
        const head = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf-8" }).stdout.trim();
        if (head !== ctx.candidateCommit) throw new Error(`Checkout ${head} does not match candidate ${ctx.candidateCommit}`);
        const tree = spawnSync("git", ["-C", dir, "rev-parse", "HEAD^{tree}"], { encoding: "utf-8" }).stdout.trim();

        boundary = createExecutionBoundary(work, [dir, home], ctx.repoDir);
        const env = executionEnv(home);
        const timeoutMs = Math.min(Math.max(p.timeoutSec ?? 300, 10), 900) * 1000;
        const items: TestResultItem[] = [];
        const steps: Array<[string, string, string | undefined]> = [
          ["STEP-INSTALL", "Install dependencies", p.install],
          ["STEP-BUILD", "Build", p.build],
          ["STEP-TEST", "Protected test suite", p.test],
        ];
        for (const [id, description, command] of steps) {
          if (!command) continue;
          const item = await runStep(id, `${description}: ${command}`, command, dir, env, timeoutMs, boundary);
          items.push(item);
          if (!item.passed) break; // later steps would only add noise
        }

        const failed = items.filter((i) => !i.passed).length;
        return {
          id: `ev_${crypto.randomUUID().slice(0, 12)}`,
          candidateCommit: ctx.candidateCommit,
          candidateTree: tree,
          expectedAcceptedBase: ctx.expectedBase,
          requirementsVersion: ctx.requirementsVersion,
          testBundleDigest: crypto.createHash("sha256").update(JSON.stringify({ i: p.install, b: p.build, t: p.test })).digest("hex"),
          toolchainDigest: `command-${process.versions.bun ? `bun-${process.versions.bun}` : `node-${process.version}`}`,
          builtOutputDigest: crypto.createHash("sha256").update(`tree:${tree}:cmd:${p.test}`).digest("hex"),
          verifierIdentity: boundary.isolated ? identity : `${identity}-local-unprivileged-boundary-unverified`,
          policy: ctx.policy,
          testResults: [{ suite: "CustomerProtectedSuite", passed: failed === 0, passedCount: items.length - failed, failedCount: failed, items }],
          timestamp: new Date().toISOString(),
          status: failed === 0 && items.length > 0 ? "passed" : "failed",
        };
      } finally {
        boundary?.dispose();
        fs.rmSync(work, { recursive: true, force: true });
      }
    },
  };
}
