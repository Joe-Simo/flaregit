import { expect, test } from "bun:test";
import { inspectNativeImport } from "../src/server/import-native-readiness";

const head = "a".repeat(40), tree = "b".repeat(40), directory = "/tmp/flaregit-import-ready-11111111-1111-4111-8111-111111111111";
const remote = "https://artifacts.example/owned.git", branch = "codex/docs-community-and-delivery";
function fixture(advertisement: string, fetched = head) {
  const commands: string[] = [];
  return { commands, exec: async (command: string) => {
    commands.push(command);
    return { success: true, stderr: "", stdout: command.includes("ls-remote") ? advertisement : command.includes("^{commit}") ? fetched : command.includes("^{tree}") ? tree : "" };
  } };
}
test("selected native branch is authoritative despite unrelated provider default or short tag", async () => {
  const native = fixture(`${head}\trefs/heads/${branch}\n${"c".repeat(40)}\trefs/tags/${branch}`);
  expect(await inspectNativeImport(native, remote, branch, directory)).toEqual({ head, branch, tree });
  expect(native.commands[0]).toContain(`refs/heads/${branch}`);
  expect(native.commands.some(command => /push|checkout|clone/.test(command))).toBe(false);
});
test("missing selected branch and branch movement fail closed", async () => {
  const missing = fixture(`${head}\trefs/tags/${branch}`);
  await expect(inspectNativeImport(missing, remote, branch, directory)).rejects.toThrow("Selected import branch is unavailable");
  expect(missing.commands.length).toBe(1);
  await expect(inspectNativeImport(fixture(`${head}\trefs/heads/${branch}`, "c".repeat(40)), remote, branch, directory)).rejects.toThrow("changed during inspection");
});
test("default discovery requires symbolic HEAD and exact refs/heads advertisement", async () => {
  const calls: string[] = [];
  const native = { exec: async (command: string) => {
    calls.push(command);
    return { success: true, stderr: "", stdout: command.includes("--symref") ? `ref: refs/heads/${branch}\tHEAD\n${head}\tHEAD` : command.includes("ls-remote") ? `${head}\trefs/heads/${branch}` : command.includes("^{commit}") ? head : command.includes("^{tree}") ? tree : "" };
  } };
  expect((await inspectNativeImport(native, remote, "", directory)).branch).toBe(branch);
  expect(calls[1]).toContain(`refs/heads/${branch}`);
  await expect(inspectNativeImport(fixture(`${head}\tHEAD`), remote, "", directory)).rejects.toThrow("not advertised");
});


test.each(["", "ref: refs/heads/main\tHEAD"])("default import recovers sole genuine non-main branch after absent or dangling HEAD: %s", async (advertisement) => {
  const calls: string[] = [];
  const native = { exec: async (command: string) => {
    calls.push(command);
    return { success: true, stderr: "", stdout: command.includes("--symref") ? advertisement : command.includes("--heads") ? `${head}\trefs/heads/${branch}` : command.includes("ls-remote") ? "" : command.includes("^{commit}") ? head : command.includes("^{tree}") ? tree : "" };
  } };
  expect(await inspectNativeImport(native, remote, "", directory)).toEqual({ head, branch, tree });
  expect(calls.some(command => command.includes("--heads") && command.includes("refs/heads/*"))).toBe(true);
  expect(calls.some(command => /push|checkout/.test(command))).toBe(false);
});

test.each(["", `${head}\trefs/heads/main\n${head}\trefs/heads/other`])("default import never guesses among missing or multiple native branches", async heads => {
  const calls: string[] = [];
  const native = { exec: async (command: string) => { calls.push(command); return { success: true, stderr: "", stdout: command.includes("--heads") ? heads : "" }; } };
  await expect(inspectNativeImport(native, remote, "", directory)).rejects.toThrow("not advertised unambiguously");
  expect(calls.some(command => command.includes("fetch"))).toBe(false);
});
