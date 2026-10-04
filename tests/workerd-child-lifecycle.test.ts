import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerdChild } from "./support/workerd-child.js";

const exists = async (path: string) => stat(path).then(() => true, () => false);
test("actual Bun fixture gets an owned temp scope; success cleans it and failure retains only its evidence", async () => {
  const parentTemp = process.env.TMPDIR;
  const root = await mkdtemp(join(tmpdir(), "flaregit-child-lifecycle-proof-"));
  const sibling = join(root, "unrelated");
  await mkdir(sibling); await Bun.write(join(sibling, "keep.txt"), "keep");
  const paths: string[] = [];
  try {
    for (const successful of [true, false]) {
      const receipt = join(root, successful ? "success.json" : "failure.json");
      const file = join(root, successful ? "success.test.ts" : "failure.test.ts");
      await Bun.write(file, `import { test, expect } from "bun:test";\nimport { mkdir } from "node:fs/promises";\nimport { join } from "node:path";\ntest("owned child", async()=>{const directory=process.env.TMPDIR!;await mkdir(join(directory,"miniflare-cache"));await Bun.write(join(directory,"miniflare-cache","evidence.txt"),"evidence");await Bun.write(${JSON.stringify(receipt)},JSON.stringify({directory,fixture:process.env.FLAREGIT_WORKERD_TEST_FILE}));expect(${successful}).toBe(true);});\n`);
      let failure: unknown;
      try { expect(await workerdChild(file)).toBeTrue(); } catch (error) { failure = error; }
      const observed = await Bun.file(receipt).json() as { directory: string; fixture: string };
      paths.push(observed.directory);
      expect(observed.fixture).toBe(file);
      expect(observed.directory).not.toBe(parentTemp);
      expect(observed.directory.split("/").at(-1)).toStartWith("flaregit-workerd-child-");
      expect(process.env.TMPDIR).toBe(parentTemp);
      if (successful) { expect(failure).toBeUndefined(); expect(await exists(observed.directory)).toBeFalse(); }
      else { expect(failure).toBeInstanceOf(Error); expect(String(failure)).toContain(observed.directory); expect(await Bun.file(join(observed.directory,"miniflare-cache","evidence.txt")).text()).toBe("evidence"); }
      expect(await Bun.file(join(sibling,"keep.txt")).text()).toBe("keep");
    }
    expect(paths[0]).not.toBe(paths[1]);
  } finally {
    // These are synthetic directories recorded by this test's own child only.
    for (const path of paths) await rm(path, {recursive:true,force:true});
    await rm(root, {recursive:true,force:true});
  }
});

test("exact-case isolation escapes test names, runs one body, and refuses a zero-case success", async () => {
  const root = await mkdtemp(join(tmpdir(), "flaregit-child-filter-proof-"));
  const file = join(root, "filtered.test.ts"), receipt = join(root, "entered.json"), siblingReceipt = join(root, "sibling.json");
  const name = "native (case).+?";
  const helper = join(import.meta.dirname, "support", "workerd-child.ts");
  const retained: string[] = [];
  try {
    await Bun.write(file, `import {test,expect} from "bun:test";\nimport {workerdChild} from ${JSON.stringify(helper)};\nconst file=${JSON.stringify(file)},name=${JSON.stringify(name)};\ntest(name,async()=>{if(await workerdChild(file,name))return;await Bun.write(${JSON.stringify(receipt)},JSON.stringify({directory:process.env.TMPDIR,caseName:process.env.FLAREGIT_WORKERD_TEST_CASE}));expect(true).toBe(true);});\ntest("native caseXYZ",async()=>{await Bun.write(${JSON.stringify(siblingReceipt)},"unexpected sibling execution");expect(true).toBe(false);});\n`);
    expect(await workerdChild(file, name)).toBeTrue();
    const observed = await Bun.file(receipt).json() as { directory: string; caseName: string };
    expect(observed.caseName).toBe(name); expect(await exists(observed.directory)).toBeFalse();
    expect(await exists(siblingReceipt)).toBeFalse();
    let failure: unknown;
    try { await workerdChild(file, "nonexistent exact case"); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    const directory = /Retained artifacts: ([^\n]+)/.exec(String(failure))?.[1];
    expect(directory).toBeDefined();
    if (directory) { retained.push(directory); expect(await exists(directory)).toBeTrue(); }
    expect(await exists(siblingReceipt)).toBeFalse();
  } finally {
    // The deliberate missing-case failure is this proof's own synthetic evidence.
    for (const directory of retained) await rm(directory, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
