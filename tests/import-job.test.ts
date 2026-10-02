import { expect, test } from "bun:test";
import { inspectImport, startImport, type ImportJob } from "../src/server/import-job";

const job: ImportJob = { id: "pabcdef123456", ownerId: "subject", name: "Import unit fixture", canonicalRepoName: "import-unit", source: "https://git.example.com/team/repo", branch: "main", verificationPolicy: { kind: "command", test: "bun test", protectedPaths: [], allowedScope: ["*"] }, status: "requested", historyIntent: "provider-default-no-depth-requested", createdAt: "2026-10-02", updatedAt: "2026-10-02", detail: "Fixture" };

test("Artifacts IMPORT_IN_PROGRESS preserves existing repository and never reimports on readiness retry", async () => {
  let imports = 0, deletes = 0;
  const binding = {
    import: async () => { imports++; return { id: "repo", name: job.canonicalRepoName, description: null, defaultBranch: "main", remote: "https://git.example.com/imported", token: "synthetic" }; },
    get: async () => { throw Object.assign(new Error("Synthetic importing response"), { code: "IMPORT_IN_PROGRESS" }); },
    delete: async () => { deletes++; return true; },
  };
  expect((await startImport(binding, job)).status).toBe("pending");
  expect((await inspectImport(binding, job.canonicalRepoName)).status).toBe("pending");
  expect(imports).toBe(1); expect(deletes).toBe(0);
});

test("import readiness retries request no shallow limit and later recover exact commit", async () => {
  let ready = false, sourceDepth: number | undefined = 999;
  const binding = {
    import: async (request: Parameters<Artifacts["import"]>[0]) => { sourceDepth = request.source.depth; return { id: "repo", name: job.canonicalRepoName, description: null, defaultBranch: "main", remote: "https://git.example.com/imported", token: "synthetic" }; },
    get: async () => {
      if (!ready) throw Object.assign(new Error("Synthetic 409"), { code: "IMPORT_IN_PROGRESS" });
      return { info: async () => ({ defaultBranch: "main", remote: "https://git.example.com/imported" }), log: async () => [{ hash: "a".repeat(40) }], [Symbol.dispose]: () => {} };
    },
  };
  await startImport(binding, job); expect(sourceDepth).toBeUndefined();
  ready = true;
  expect(await inspectImport(binding, job.canonicalRepoName)).toEqual({ status: "ready", head: "a".repeat(40), defaultBranch: "main", remote: "https://git.example.com/imported" });
});

test("documented provider refusal is visibly failed without deleting the saved source", async () => {
  let reads = 0;
  const binding = { import: async () => { throw Object.assign(new Error("Synthetic refusal"), { code: "REMOTE_AUTH_REQUIRED" }); }, get: async () => { reads++; throw new Error("Must not inspect rejected import"); } };
  expect((await startImport(binding, job)).status).toBe("failed");
  expect(reads).toBe(0);
});
