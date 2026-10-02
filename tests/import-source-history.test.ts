import { expect, test } from "bun:test";
import { capturePublicSourceHistory } from "../src/server/import-source-history";
test("arbitrary import host never dispatches unrestricted sandbox Git network traffic", async () => {
  let calls = 0;
  expect(await capturePublicSourceHistory({ exec: async () => { calls++; return { success: true, stdout: "", stderr: "" }; } }, "https://code.example.org/team/repo.git", "main")).toBeNull();
  expect(calls).toBe(0);
});
test("trusted provider capture disables redirects/hooks and always removes owned temporary clone", async () => {
  const commands: string[] = [];
  const head = "a".repeat(40), tree = "b".repeat(40);
  const result = await capturePublicSourceHistory({ exec: async (command) => {
    commands.push(command);
    return { success: true, stderr: "", stdout: command.includes("rev-parse --verify") ? head : command.includes("is-shallow") ? "false" : command.includes("log --max-count") ? `${head} ${tree}` : "" };
  } }, "https://github.com/owner/repository.git", "main");
  expect(result?.shallow).toBe(false);
  expect(commands[0]).toContain("http.followRedirects=false");
  expect(commands[0]).toContain("core.hooksPath=/dev/null");
  expect(commands.at(-1)).toMatch(/^rm -rf -- '\/tmp\/flaregit-import-history-/);
});

test("cleanup failure preserves captured inventory", async () => {
  const head = "a".repeat(40), tree = "b".repeat(40);
  const result = await capturePublicSourceHistory({ exec: async (command) => {
    if (command.startsWith("rm ")) throw new Error("sensitive provider error");
    return { success: true, stderr: "", stdout: command.includes("rev-parse --verify") ? head : command.includes("is-shallow") ? "false" : command.includes("log --max-count") ? `${head} ${tree}` : "" };
  } }, "https://github.com/owner/repository.git", "main", head);
  expect(result?.refs["refs/heads/main"]).toBe(head);
});
