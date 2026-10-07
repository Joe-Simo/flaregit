import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { ImportHistoryInspection, type HistoryInspectionScope } from "../src/server/import-history-inspection";
import { captureArtifactsHistoryChunk } from "../src/server/import-history";
import { readSourceHistoryTraversalChunk, type HistoryExecutor } from "../src/server/import-source-history";

const environment = { ...process.env, GIT_AUTHOR_NAME: "Synthetic migration", GIT_AUTHOR_EMAIL: "synthetic@localhost", GIT_COMMITTER_NAME: "Synthetic migration", GIT_COMMITTER_EMAIL: "synthetic@localhost" };
async function native(args: string[], input?: string): Promise<string> {
  const child = Bun.spawn(["git", ...args], { env: environment, stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (input !== undefined) { if (!child.stdin) throw new Error("Missing Git input"); child.stdin.write(input); child.stdin.end(); }
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(stderr);
  return stdout.trim();
}
function storage(db: Database): DurableObjectStorage {
  return { sql: { exec(query: string, ...bindings: Array<string | number>) {
    if (query.includes("CREATE TABLE")) { db.exec(query); return { toArray: () => [] }; }
    const rows = db.query(query).all(...bindings);
    return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error("Expected one SQL row"); return rows[0]; } };
  } }, transactionSync<T>(callback: () => T): T { return db.transaction(callback)(); } } as unknown as DurableObjectStorage;
}

test("durable inspection resumes real 1103-commit Git history and compares both completed frontiers", async () => {
  const directory = `/tmp/flaregit-import-history-${crypto.randomUUID()}`, database = `/tmp/flaregit-history-${crypto.randomUUID()}.sqlite`;
  let db = new Database(database), inspection = new ImportHistoryInspection(storage(db));
  try {
    await native(["init", "--bare", directory]);
    const git = (args: string[], input?: string) => native(["--git-dir", directory, ...args], input);
    let input = "";
    for (let index = 1; index <= 1101; index++) {
      const message = `Synthetic ${index}`;
      input += `commit refs/heads/main\nmark :${index}\ncommitter Synthetic <synthetic@localhost> ${1700000000 + index} +0000\ndata ${message.length}\n${message}\n${index > 1 ? `from :${index - 1}\n` : ""}\n`;
    }
    await git(["fast-import", "--quiet"], input);
    const tip = await git(["rev-parse", "main"]), tree = await git(["mktree"], "");
    const side = await git(["commit-tree", tree, "-p", tip, "-m", "Synthetic side"]), head = await git(["commit-tree", tree, "-p", tip, "-p", side, "-m", "Synthetic merge"]);
    await git(["update-ref", "refs/heads/main", head]);
    const scope: HistoryInspectionScope = { operationId: `import-history-${crypto.randomUUID()}`, projectId: "p123456789abc", incarnation: crypto.randomUUID(), ownerId: "synthetic-owner", accountKey: "123456abcdef", canonicalRepoName: "synthetic-import", source: "https://github.com/synthetic/example.git", branch: "main", head };
    inspection.begin(scope);
    const executor: HistoryExecutor = { exec: async command => {
      const child = Bun.spawn(["sh", "-c", command], { env: environment, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { success: code === 0, stdout, stderr };
    } };
    let sourceBatches = 0;
    while (true) {
      const batch = inspection.batch(scope.operationId, "source"); if (batch.complete) break;
      const chunk = await readSourceHistoryTraversalChunk(executor, directory, batch.requested);
      expect(chunk.shallow).toBe(false);
      const value = { ...batch, commits: Object.entries(chunk.commits).map(([hash, record]) => ({ hash, ...record })) };
      const request = { batchId: value.batchId, revision: value.revision, requested: value.requested, commits: value.commits };
      await inspection.commit(scope.operationId, "source", request); sourceBatches++;
      if (sourceBatches === 1) {
        db.close(); db = new Database(database); inspection = new ImportHistoryInspection(storage(db));
        expect((await inspection.commit(scope.operationId, "source", request)).kind).toBe("duplicate");
        expect(inspection.get(scope.operationId)?.source.count).toBe(256);
      }
    }
    expect(sourceBatches).toBe(5);
    // The selected branch can advance while the persisted inspection remains pinned.
    const advanced = await git(["commit-tree", tree, "-p", head, "-m", "Later branch commit"]);
    await git(["update-ref", "refs/heads/main", advanced]);
    // Capture actual immutable objects once; the synthetic SDK still reads every
    // requested object while avoiding one operating-system process per commit.
    const records = new Map((await git(["log", "--format=%H %T %P", head])).split("\n").map(line => {
      const [hash, treeHash, ...parents] = line.split(" ");
      if (!hash || !treeHash) throw new Error("Malformed native Git metadata");
      return [hash, { hash, treeHash, parents }] as const;
    }));
    const binding = { get: async () => ({ [Symbol.dispose]() {}, log: async () => [], readCommit: async (hash: string) => {
      const record = records.get(hash);
      if (!record) return null;
      return { ...record, parents: [...record.parents] };
    } }) };
    let destinationBatches = 0;
    while (true) {
      const batch = inspection.batch(scope.operationId, "destination", 128); if (batch.complete) break;
      const chunk = await captureArtifactsHistoryChunk(binding, scope.canonicalRepoName, batch.requested, async () => {}, batch.knownHashes, async () => {});
      await inspection.commit(scope.operationId, "destination", { batchId: batch.batchId, revision: batch.revision, requested: batch.requested, commits: Object.entries(chunk.commits).map(([hash, record]) => ({ hash, ...record })), unavailable: chunk.missing });
      destinationBatches++;
    }
    const saved = inspection.finish(scope.operationId);
    expect(saved.status).toBe("verified"); expect(saved.result?.scope).toBe("selected-ref-reachable-commit-history");
    expect(saved.result?.commitsCompared).toBe(1103); expect(saved.scope.head).toBe(head);
    expect(destinationBatches).toBe(9); expect(saved.source.pending + saved.destination.pending).toBe(0);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); await rm(database, { force: true }); }
}, 30_000);
