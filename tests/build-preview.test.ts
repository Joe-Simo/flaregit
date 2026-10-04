import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { buildPreview } from "../src/core/verification/build-preview";

test("committed React previews build for the browser without exposing supervisor environment", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-browser-build-"));
  const source = path.join(work, "source"), output = path.join(work, "output");
  const previous = process.env.FLAREGIT_PREVIEW_TEST_SECRET;
  try {
    process.env.FLAREGIT_PREVIEW_TEST_SECRET = "synthetic-preview-secret-must-not-be-bundled";
    fs.cpSync(path.resolve(import.meta.dirname, "../src/fixtures/ticket-booking/template"), source, { recursive: true });
    for (const args of [["init", "--quiet"], ["add", "."], ["-c", "user.name=Preview test", "-c", "user.email=preview@example.test", "commit", "--quiet", "-m", "Committed fixture"]]) {
      expect(spawnSync("git", ["-C", source, ...args], { encoding: "utf8" }).status).toBe(0);
    }
    buildPreview(source, output);
    const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
    const module = /src="\.\/([^"/]+\.js)"/.exec(html)?.[1];
    expect(module).toBeDefined();
    const javascript = fs.readFileSync(path.join(output, module!), "utf8");
    expect(javascript.includes("process.env")).toBe(false);
    expect(javascript.includes(process.env.FLAREGIT_PREVIEW_TEST_SECRET!)).toBe(false);
    // Load the real React module without Node globals; omit mounting into a DOM.
    expect(() => runInNewContext(javascript, { document: { getElementById: () => null }, console, setTimeout, clearTimeout }, { timeout: 5_000 })).not.toThrow();
  } finally {
    if (previous === undefined) delete process.env.FLAREGIT_PREVIEW_TEST_SECRET;
    else process.env.FLAREGIT_PREVIEW_TEST_SECRET = previous;
    fs.rmSync(work, { recursive: true, force: true });
  }
}, 30_000);
