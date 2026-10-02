import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { repairCandidate, type RepairOptions } from "../src/core/pipeline/repair.js";

const options = (repoDir: string): RepairOptions => ({
  repoDir, candidate: { frozenRequirements: [] } as unknown as RepairOptions["candidate"], tasks: [],
  round: 1, conflictType: "text_conflict", editableFiles: ["source.ts"],
  fileContents: { "source.ts": "original" }, protectedPaths: [],
  model: async () => '<file path="source.ts">\nreplacement\n</file>',
});

test("repair refuses credential-bearing files before calling the model", async () => {
  let called = false;
  const opts = options("");
  opts.fileContents["source.ts"] = "const token = 'ghp_" + "a".repeat(36) + "'";
  opts.model = async () => { called = true; return ""; };
  const result = await repairCandidate(opts);
  expect(result.success).toBe(false);
  expect(result.error).toContain("contains credentials");
  expect(called).toBe(false);
});

test("repair refuses symlink writes and preserves the outside file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repair-guard-"));
  try {
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    const outside = path.join(root, "outside.ts");
    fs.writeFileSync(outside, "untouched");
    fs.symlinkSync(outside, path.join(repo, "source.ts"));
    const result = await repairCandidate(options(repo));
    expect(result.success).toBe(false);
    expect(result.error).toContain("symbolic link");
    expect(fs.readFileSync(outside, "utf8")).toBe("untouched");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
