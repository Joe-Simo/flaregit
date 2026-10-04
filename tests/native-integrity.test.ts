import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitOrThrow } from "../src/core/pipeline/git.js";
import { verifyNativeIntegrity, type NativeIntegrityInput } from "../src/core/verification/integrity.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "native-integrity-"));
  const git = (args: string[]) => gitOrThrow(dir, args);
  git(["init", "--initial-branch=main"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@localhost"]);
  await mkdir(join(dir, "src")); await mkdir(join(dir, "tests"));
  await Bun.write(join(dir, "src", "feature.ts"), "throw new Error('Never execute customer source');\n");
  await Bun.write(join(dir, "tests", "suite.ts"), "protected suite\n");
  git(["add", "."]); git(["commit", "-m", "base"]);
  const base = git(["rev-parse", "HEAD"]);
  await Bun.write(join(dir, "src", "feature.ts"), "throw new Error('New feature must not execute');\n");
  git(["commit", "-am", "contribution"]);
  const commit = git(["rev-parse", "HEAD"]);
  git(["update-ref", "refs/flaregit/tasks/one", commit]);
  const input: NativeIntegrityInput & { expectedBase: string } = { repoDir: dir, candidateCommit: commit, candidateTree: git(["rev-parse", "HEAD^{tree}"]), expectedBase: base, requirementsVersion: 1, policy: { mode: "external" }, protectedPaths: ["tests/"], allowedScope: ["src/"], contributors: [{ id: "one", commit, baseCommit: base, ref: "refs/flaregit/tasks/one", allowedScope: ["src/"] }], landing: "merge" };
  return { dir, git, input };
}

test("native integrity passes real Git without executing customer source and labels external CI pending", async () => {
  const f = await fixture();
  try {
    const evidence = await verifyNativeIntegrity(f.input);
    expect(evidence.status).toBe("passed"); expect(evidence.verifierIdentity).toBe("flaregit-native-integrity-v1");
    expect(evidence.testResults[0]?.suite).toBe("NativeGitIntegrityOnly");
    expect(evidence.testResults[0]?.items[0]?.description).toContain("application CI is external");
    const child = Bun.spawn(["bun", "src/core/verification/cli.ts", "--native-integrity", JSON.stringify(f.input)], { stdout: "pipe", stderr: "pipe" });
    const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(output).verifierIdentity).toBe("flaregit-native-integrity-v1");
    expect(JSON.parse(output).status).toBe("passed");
    const wrongTree = await verifyNativeIntegrity({ ...f.input, candidateTree: "a".repeat(40) });
    expect(wrongTree.status).toBe("failed");
    const wrongRef = await verifyNativeIntegrity({ ...f.input, contributors: [{ ...f.input.contributors[0]!, commit: f.input.expectedBase }] });
    expect(wrongRef.status).toBe("failed");
    const outsideScope = await verifyNativeIntegrity({ ...f.input, contributors: [{ ...f.input.contributors[0]!, allowedScope: ["lib/"] }] });
    expect(outsideScope.status).toBe("failed");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("wrong accepted ancestry and protected final integration edits cannot pass", async () => {
  const f = await fixture();
  try {
    f.git(["checkout", "--orphan", "unrelated"]); f.git(["commit", "-am", "independent root"]);
    const unrelated = f.git(["rev-parse", "HEAD"]);
    expect((await verifyNativeIntegrity({ ...f.input, expectedBase: unrelated })).status).toBe("failed");
    f.git(["checkout", "main"]);
    await Bun.write(join(f.dir, "tests", "suite.ts"), "weakened by integration\n"); f.git(["commit", "-am", "invalid final edit"]);
    const candidateCommit = f.git(["rev-parse", "HEAD"]), candidateTree = f.git(["rev-parse", "HEAD^{tree}"]);
    const evidence = await verifyNativeIntegrity({ ...f.input, candidateCommit, candidateTree, allowedScope: ["*"] });
    expect(evidence.status).toBe("failed"); expect(evidence.testResults[0]?.items[0]?.message).toContain("protected");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("corrupted candidate object fails native verification", async () => {
  const f = await fixture();
  try {
    const commit = f.input.candidateCommit;
    const object = join(f.dir, ".git", "objects", commit.slice(0, 2), commit.slice(2));
    await chmod(object, 0o600); const bytes = await readFile(object); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 255; await writeFile(object, bytes);
    expect((await verifyNativeIntegrity(f.input)).status).toBe("failed");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("ordinary README repository mode proves real Git and reports application checks unconfigured", async () => {
 const f=await fixture();
 try{
  await Bun.write(join(f.dir,"README.md"),"# Ordinary repository\nReviewed documentation contribution.\n");
  f.git(["add","README.md"]);f.git(["commit","-m","Document normal repository"]);
  const commit=f.git(["rev-parse","HEAD"]);f.git(["update-ref","refs/flaregit/tasks/one",commit]);
  const policy={kind:"git-integrity",allowedScope:["*"],protectedPaths:[".flaregit/"],landing:"merge"};
  const input:NativeIntegrityInput={...f.input,policy,candidateCommit:commit,candidateTree:f.git(["rev-parse","HEAD^{tree}"]),allowedScope:["*"],protectedPaths:policy.protectedPaths,contributors:[{...f.input.contributors[0]!,commit,allowedScope:["*"]}]};
  const evidence=await verifyNativeIntegrity(input);
  expect(evidence.status).toBe("passed");expect(evidence.candidateCommit).toBe(commit);
  expect(evidence.testResults[0]?.items[0]?.description).toContain("application behavior checks are not configured");
  expect(evidence.testResults[0]?.items).toHaveLength(1);
  const cli=Bun.spawn([process.execPath,"src/core/verification/cli.ts","--native-integrity",JSON.stringify(input)],{stdout:"pipe",stderr:"pipe"});
  const [output,code]=await Promise.all([new Response(cli.stdout).text(),cli.exited]);expect(code).toBe(0);
  expect(JSON.parse(output).candidateTree).toBe(input.candidateTree);
  await mkdir(join(f.dir,".flaregit"));await Bun.write(join(f.dir,".flaregit/policy.json"),"{}\n");
  f.git(["add",".flaregit/policy.json"]);f.git(["commit","-m","Unauthorized platform configuration"]);
  const changed=f.git(["rev-parse","HEAD"]);f.git(["update-ref","refs/flaregit/tasks/one",changed]);
  expect((await verifyNativeIntegrity({...input,candidateCommit:changed,candidateTree:f.git(["rev-parse","HEAD^{tree}"]),contributors:[{...input.contributors[0]!,commit:changed}]})).status).toBe("failed");
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
