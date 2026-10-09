import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePostLandRebase, type PostLandRebaseItem } from "../src/server/post-land-rebase";
import { localCoordinationRuntime, sh } from "./support/local-coordination-runtime";

let root = "";
const ids: Record<string, string> = {};
// Protected check: the landed helper and this change's file must both be present and the helper must be intact.
const policy = { kind: "command", test: "test -f src/feature.ts && ! { grep -q 'landed = 2' src/landed.ts && grep -q legacy src/feature.ts; }" };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "flaregit-post-land-"));
  const seed = join(root, "seed");
  await sh(root, "git init --quiet -b main seed && mkdir -p seed/src");
  await Bun.write(join(seed, "src/shared.ts"), "export const shared = 1;\n");
  await Bun.write(join(seed, "src/landed.ts"), "export const placeholder = 0;\n");
  await sh(seed, "git add -A && git commit --quiet -m base");
  ids.base = await sh(seed, "git rev-parse HEAD");
  // Work that lands on the canonical branch.
  await Bun.write(join(seed, "src/landed.ts"), "export const landed = 2;\n");
  await Bun.write(join(seed, "src/shared.ts"), "export const shared = 2;\n");
  await sh(seed, "git commit --quiet -am landed");
  ids.landed = await sh(seed, "git rev-parse HEAD");
  // An agent change that touches different files: replays cleanly.
  await sh(seed, `git checkout --quiet -b task/clean ${ids.base}`);
  await Bun.write(join(seed, "src/feature.ts"), "export const feature = true;\n");
  await sh(seed, "git add -A && git commit --quiet -m clean");
  ids.clean = await sh(seed, "git rev-parse HEAD");
  // An agent change that edits the same line as the landed work: conflicts.
  await sh(seed, `git checkout --quiet -b task/conflict ${ids.base}`);
  await Bun.write(join(seed, "src/shared.ts"), "export const shared = 3;\n");
  await sh(seed, "git commit --quiet -am conflict");
  ids.conflict = await sh(seed, "git rev-parse HEAD");
  // A change that replays cleanly but relies on behavior the landed work replaced: checks fail on the new base.
  await sh(seed, `git checkout --quiet -b task/breaks ${ids.base}`);
  await Bun.write(join(seed, "src/feature.ts"), "export const legacy = 1;\n");
  await sh(seed, "git add -A && git commit --quiet -m breaks");
  ids.breaks = await sh(seed, "git rev-parse HEAD");
  await sh(seed, `git branch task/human ${ids.breaks}`);
  await sh(seed, "git checkout --quiet main");
  await sh(root, "git clone --quiet --bare seed canonical.git && git clone --quiet --bare seed workspace.git");
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const item = (branch: string, fromCommit: string, agent = true): PostLandRebaseItem => ({ taskId: branch.replace("task/", "change-"), landedCommit: ids.landed!, fromCommit, fromBase: ids.base!, canonicalRepoName: "canonical", workspaceRepoName: "workspace", branch, agent, policyJson: JSON.stringify(policy), policyVersion: 1, status: "pending" });

test("a clean change is replayed onto the landed commit, re-verified and its agent branch updated", async () => {
  const runtime = localCoordinationRuntime(join(root, "work-clean"), { canonical: join(root, "canonical.git"), workspace: join(root, "workspace.git") });
  const result = await executePostLandRebase(runtime, item("task/clean", ids.clean!));
  if (result.kind !== "updated") throw new Error(JSON.stringify(result));
  expect(result.verification.status).toBe("passed");
  expect(result.pushed).toBe(true);
  expect(result.overlappingFiles).toEqual([]);
  const workspace = join(root, "workspace.git");
  expect(await sh(workspace, "git rev-parse task/clean")).toBe(result.newCommit);
  expect(await sh(workspace, `git rev-parse ${result.newCommit}^`)).toBe(ids.landed!);
  expect(runtime.commands.some((command) => command.includes("src/core/verification/cli.ts"))).toBe(true);
}, 120_000);

test("a replay that fails protected checks reports the failing check", async () => {
  const runtime = localCoordinationRuntime(join(root, "work-breaks"), { canonical: join(root, "canonical.git"), workspace: join(root, "workspace.git") });
  const result = await executePostLandRebase(runtime, item("task/breaks", ids.breaks!));
  if (result.kind !== "updated") throw new Error(JSON.stringify(result));
  expect(result.verification.status).toBe("failed");
  expect(result.verification.failures.map((failure) => failure.testId)).toContain("STEP-TEST");
}, 120_000);

test("a conflicting agent change keeps its work and restarts on the landed commit", async () => {
  const runtime = localCoordinationRuntime(join(root, "work-conflict"), { canonical: join(root, "canonical.git"), workspace: join(root, "workspace.git") });
  const result = await executePostLandRebase(runtime, item("task/conflict", ids.conflict!));
  if (result.kind !== "conflict") throw new Error(JSON.stringify(result));
  expect(result.conflictingFiles).toEqual(["src/shared.ts"]);
  expect(result.overlappingFiles).toEqual(["src/shared.ts"]);
  expect(result.landedDiff).toContain("+export const shared = 2;");
  expect(result.previousDiff).toContain("+export const shared = 3;");
  expect(result.reset).toBe(true);
  const workspace = join(root, "workspace.git");
  expect(await sh(workspace, "git rev-parse task/conflict")).toBe(ids.landed!);
  expect(await sh(workspace, `git rev-parse refs/flaregit/preserved/${ids.conflict}`)).toBe(ids.conflict!);
}, 120_000);

test("a person's branch is never rewritten; the change moved meanwhile is skipped", async () => {
  const runtime = localCoordinationRuntime(join(root, "work-human"), { canonical: join(root, "canonical.git"), workspace: join(root, "workspace.git") });
  const human = await executePostLandRebase(runtime, item("task/human", ids.breaks!, false));
  expect(human.kind).toBe("updated");
  expect(human.kind === "updated" && human.pushed).toBe(false);
  expect(await sh(join(root, "workspace.git"), "git rev-parse task/human")).toBe(ids.breaks!);
  const moved = await executePostLandRebase(runtime, item("task/human", ids.clean!));
  expect(moved).toEqual({ kind: "skipped", reason: "The change's branch has newer work; it is updated after that work is saved" });
}, 120_000);
