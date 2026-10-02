import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { strict as assert } from "node:assert";

/** Real Git protocol demonstration. Contributors are deterministic scripts, not coding agents. */
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "flaregit-proof-"));
  const canonical = path.join(root, "canonical.git");
  const env = { ...process.env, GIT_AUTHOR_NAME: "FlareGit protocol proof", GIT_AUTHOR_EMAIL: "proof@localhost", GIT_COMMITTER_NAME: "FlareGit protocol proof", GIT_COMMITTER_EMAIL: "proof@localhost" };
  async function git(cwd: string, args: string[], allowFailure = false) {
    const proc = Bun.spawn(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code && !allowFailure) throw new Error(`git ${args[0]}: ${stderr.trim()}`);
    return { code, stdout: stdout.trim(), stderr: stderr.trim() };
  }
  await git(root, ["init", "--bare", "--initial-branch=main", canonical]);
  const seed = path.join(root, "seed");
  await git(root, ["clone", canonical, seed]);
  await fs.writeFile(path.join(seed, "refund.txt"), "Refund window: 24 hours\n");
  await git(seed, ["add", "."]);
  await git(seed, ["commit", "-m", "Initial refund policy"]);
  await git(seed, ["push", "origin", "main"]);
  const base = (await git(seed, ["rev-parse", "HEAD"])).stdout;
  const started = new Date().toISOString();
  const contributions = await Promise.all([48, 72].map(async (hours) => {
    const dir = path.join(root, `contributor-${hours}`);
    await git(root, ["clone", canonical, dir]);
    await git(dir, ["checkout", "-b", `change-${hours}`]);
    await fs.writeFile(path.join(dir, "refund.txt"), `Refund window: ${hours} hours\n`);
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "--author", `Deterministic contributor ${hours} <contributor-${hours}@localhost>`, "-m", `Request ${hours} hour window`]);
    await git(dir, ["push", "origin", `change-${hours}`]);
    return { hours, dir, head: (await git(dir, ["rev-parse", "HEAD"])).stdout };
  }));
  const [a, b] = contributions;
  assert(a && b);
  const integration = path.join(root, "integration");
  await git(root, ["clone", canonical, integration]);
  await git(integration, ["checkout", "-b", "candidate", a.head]);
  const conflict = await git(integration, ["merge", "--no-edit", b.head], true);
  assert.notEqual(conflict.code, 0);
  const conflictFiles = (await git(integration, ["diff", "--name-only", "--diff-filter=U"])).stdout;
  assert.equal(conflictFiles, "refund.txt");
  console.log("REAL GIT; deterministic scripted contributors, no AI model, no hosted Artifacts. No human-review claim.");
  console.log(`Parallel contributions: ${a.head}, ${b.head}; conflict: ${conflictFiles}`);
  // Explicit predetermined decision for this protocol demonstration; never claimed as a human review.
  await fs.writeFile(path.join(integration, "refund.txt"), "Refund window: 48 hours\n");
  await git(integration, ["add", "refund.txt"]);
  await git(integration, ["commit", "-m", "Recorded demo decision: use 48 hours"]);
  const candidate = (await git(integration, ["rev-parse", "HEAD"])).stdout;
  await git(integration, ["push", "origin", `${candidate}:refs/flaregit/candidates/proof`]);
  // Advance main independently, then show the old candidate cannot overwrite it.
  await fs.writeFile(path.join(seed, "maintainer.txt"), "Independent accepted contribution\n");
  await git(seed, ["add", "."]);
  await git(seed, ["commit", "-m", "Independent maintainer contribution"]);
  await git(seed, ["push", "origin", "main"]);
  const newer = (await git(seed, ["rev-parse", "HEAD"])).stdout;
  const stale = await git(integration, ["push", `--force-with-lease=refs/heads/main:${base}`, "origin", `${candidate}:refs/heads/main`], true);
  assert.notEqual(stale.code, 0);
  assert.equal((await git(root, ["--git-dir", canonical, "rev-parse", "main"])).stdout, newer);
  await git(integration, ["fetch", "origin", "main"]);
  await git(integration, ["merge", "--no-edit", "origin/main"]);
  const rebasedCandidate = (await git(integration, ["rev-parse", "HEAD"])).stdout;
  await git(integration, ["push", "origin", `${rebasedCandidate}:refs/flaregit/candidates/proof-v2`]);
  const journal = path.join(root, "journal.json");
  await fs.writeFile(journal, JSON.stringify({ state: "PREPARED", expectedBase: newer, candidate: rebasedCandidate }));
  await git(integration, ["push", `--force-with-lease=refs/heads/main:${newer}`, "origin", `${rebasedCandidate}:refs/heads/main`]);
  // Simulate an interruption after ref publication and before journal completion, deleting the workspace.
  await fs.rm(integration, { recursive: true, force: true });
  const recovered = path.join(root, "recovered");
  await git(root, ["clone", canonical, recovered]);
  const persisted = JSON.parse(await fs.readFile(journal, "utf8")) as { state: string; expectedBase: string; candidate: string };
  const accepted = (await git(recovered, ["rev-parse", "HEAD"])).stdout;
  assert.equal(accepted, persisted.candidate);
  assert.equal(await fs.readFile(path.join(recovered, "maintainer.txt"), "utf8"), "Independent accepted contribution\n");
  assert.equal(await fs.readFile(path.join(recovered, "refund.txt"), "utf8"), "Refund window: 48 hours\n");
  persisted.state = "ACCEPTED";
  await fs.writeFile(journal, JSON.stringify(persisted, null, 2));
  const receipt = { kind: "local-real-git-deterministic-proof", started, finished: new Date().toISOString(), base, contributions: contributions.map(({ hours, head }) => ({ hours, head })), conflictFiles, decision: "Predetermined script selects 48 hours; not human review", staleRefusalExitCode: stale.code, preservedIndependentCommit: newer, accepted, recovery: "Workspace deleted after ref publication; PREPARED journal reconciled using fresh clone", hosted: false, realAgents: false };
  await fs.writeFile(path.join(root, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(`Stale push refused; independent commit preserved: ${newer}`);
  console.log(`Fresh-clone recovery verified accepted commit: ${accepted}`);
  console.log(`Retained repository, journal, and receipt: ${root}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
