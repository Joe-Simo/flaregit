import { mkdir, rm } from "node:fs/promises";
import type { GitHistoryInventory } from "../server/migration-receipt";

// Deliberately fixed to the goal owner's disposable hosted acceptance repository.
const namespace = "flaregit-default", repository = "flaregit-pbd425298ee02";
const candidateRef = "refs/flaregit/candidates/cand_0e1f19cf-3";
process.umask(0o077);
const directory = `/tmp/flaregit-read-inspect-${crypto.randomUUID()}`;
await mkdir(directory, { mode: 0o700 });
const safeEnv = { ...process.env, WRANGLER_LOG: "error", WRANGLER_LOG_PATH: `${directory}/wrangler.log`, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
async function command(argv: string[], env = safeEnv): Promise<string> {
  const child = Bun.spawn(argv, { env, stdout: "pipe", stderr: "ignore" });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(`Read-only inspection command failed: ${argv[0]}`);
  return output;
}
try {
  const wrangler = ["bunx", "--no-install", "wrangler", "artifacts", "repos"];
  const meta = JSON.parse(await command([...wrangler, "get", repository, "--namespace", namespace, "--json"])) as { name?: string; remote?: string };
  if (meta.name !== repository || typeof meta.remote !== "string") throw new Error("Unexpected repository metadata");
  const remote = new URL(meta.remote);
  if (remote.protocol !== "https:" || remote.username || remote.password || remote.search || remote.hash) throw new Error("Unsafe canonical remote");
  const tokenFile = `${directory}/token.json`;
  await Bun.write(tokenFile, await command([...wrangler, "issue-token", repository, "--namespace", namespace, "--scope", "read", "--ttl", "600", "--json"]));
  const token = await Bun.file(tokenFile).json() as { plaintext?: string; scope?: string; expires_at?: string };
  await Bun.file(tokenFile).delete();
  if (token.scope !== "read" || typeof token.plaintext !== "string" || !token.expires_at || Date.parse(token.expires_at) > Date.now() + 610_000) throw new Error("Unexpected scoped token metadata");
  const repoPath = `${directory}/repository.git`;
  const gitEnv = { ...safeEnv, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${remote.origin}/.extraHeader`, GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token.plaintext}` };
  const advertised: Record<string, string> = {};
  for (const line of (await command(["git", "ls-remote", "--", remote.toString()], gitEnv)).trim().split("\n")) {
    const [hash, ref] = line.split(/\s+/);
    if (hash && ref && /^[a-f0-9]{40}$/.test(hash)) advertised[ref] = hash;
  }
  await command(["git", "clone", "--quiet", "--bare", "--", remote.toString(), repoPath], gitEnv);
  await command(["git", "--git-dir", repoPath, "fetch", "--quiet", "--no-tags", "--", remote.toString(), `${candidateRef}:${candidateRef}`], gitEnv);
  token.plaintext = "";
  const git = (...args: string[]) => command(["git", "--git-dir", repoPath, ...args]);
  const refs: Record<string, string> = {};
  for (const line of (await git("for-each-ref", "--format=%(objectname) %(refname)")).trim().split("\n")) {
    const [hash, ref] = line.split(" ");
    if (hash && ref && /^[a-f0-9]{40}$/.test(hash)) refs[ref] = hash;
  }
  const commits: GitHistoryInventory["commits"] = {};
  for (const line of (await git("log", "--all", "--format=%H %T %P")).trim().split("\n")) {
    const [hash, tree, ...parents] = line.trim().split(" ");
    if (hash && tree && /^[a-f0-9]{40}$/.test(hash) && /^[a-f0-9]{40}$/.test(tree)) commits[hash] = { tree, parents };
  }
  const inventory: GitHistoryInventory = { refs, commits, shallow: (await git("rev-parse", "--is-shallow-repository")).trim() === "true", capturedAt: new Date().toISOString() };
  const fsck = await command(["git", "--git-dir", repoPath, "fsck", "--full", "--no-reflogs"]);
  const candidateCommit = refs[candidateRef];
  if (!candidateCommit || !candidateCommit.startsWith("2bb6c8e")) throw new Error("Candidate ref did not match verified review SHA prefix");
  const ancestors = new Set<string>();
  const pending = [candidateCommit];
  while (pending.length) {
    const commit = pending.pop()!;
    if (ancestors.has(commit)) continue;
    ancestors.add(commit);
    pending.push(...(commits[commit]?.parents ?? []));
  }
  const candidate = { ref: candidateRef, commit: candidateCommit, ...commits[candidateCommit], descendsFromCurrentMain: ancestors.has(refs["refs/heads/main"] ?? "") };
  const receipt = { namespace, repository, advertisedRefs: advertised, candidate, method: "Official Wrangler read-scoped token; native Git bare clone without checkout", inventory, objectIntegrity: "git fsck --full completed successfully", fsckDiagnosticsPresent: fsck.trim().length > 0, currentMain: refs["refs/heads/main"] ?? null, scope: "Read-only repository snapshot; no human approval, publication, deployment or source-comparison claim" };
  const output = `/tmp/flaregit-hosted-git-receipt-${Date.now()}.json`;
  await Bun.write(output, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ receipt: output, currentMain: receipt.currentMain, candidate, advertisedRefs: Object.keys(advertised).length, refs: Object.keys(refs).length, commits: Object.keys(commits).length, shallow: inventory.shallow, objectIntegrity: receipt.objectIntegrity }));
} finally { await rm(directory, { recursive: true, force: true }); }
