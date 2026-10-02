import { expect, test } from "bun:test";
import { validateImportSource } from "../src/server/import-source.js";

test.each(["https://github.com/owner/repo.git", "https://git.example.com/team/project", "https://code.example.org:8443/scm/team/repo.git", "https://git.example.com./team/project"])("supports public custom Git hosts: %s", (url) => {
  expect(validateImportSource(url).protocol).toBe("https:");
});

test.each([
  "http://git.example.com/repo", "https://user:password@git.example.com/repo", "https://git.example.com/repo?token=privatecredential",
  "https://git.example.com/repo#privatecredential", "https://localhost/repo", "https://localhost./repo", "https://service.internal./repo",
  "https://127.0.0.1/repo", "https://2130706433/repo", "https://0x7f000001/repo", "https://[::1]/repo", "https://git/repo",
  "https://git.example.com/", "https://git.example.com/repo%00.git", "https://git.example.com/%E0%A4%A",
  "https://git.example.com/ghp_abcdefghijklmnopqrstuvwxyz/repo", "https://git.example.com/%61rt_v1_abcdefghijklmnopqrstuvwxyz/repo",
  "https://git.example.com/repo\\secret", "https://git.example.com/repo\n", "https://git.home/repo",
])("rejects credential-bearing or non-public-looking source: %s", (url) => {
  expect(() => validateImportSource(url)).toThrow();
});

test("validation errors never echo supplied credentials", () => {
  const credential = "secret-value-not-for-logs";
  try { validateImportSource(`https://user:${credential}@git.example.com/repo`); }
  catch (error) { expect(String(error)).not.toContain(credential); }
});

test("shared repository commands reject credential literals and preserve environment references", async () => {
  const { validateRepositoryCommand } = await import("../src/server/import-source.js");
  expect(() => validateRepositoryCommand('API_KEY="credential-value-123456" bun test')).toThrow(/credentials/);
  expect(() => validateRepositoryCommand("API_KEY=credential-value-123456 bun test")).toThrow(/credentials/);
  expect(() => validateRepositoryCommand("CUSTOM_TOKEN=credential-value-123456 bun test")).toThrow(/credentials/);
  expect(() => validateRepositoryCommand("curl -H 'Authorization: Bearer credential-value-123456' https://example.com")).toThrow(/credentials/);
  expect(() => validateRepositoryCommand(42)).toThrow(/strings/);
  expect(() => validateRepositoryCommand("x".repeat(301))).toThrow(/300/);
  expect(validateRepositoryCommand('bun test --token "$PROJECT_TEST_TOKEN"')).toBe('bun test --token "$PROJECT_TEST_TOKEN"');
  expect(validateRepositoryCommand("API_KEY=${PROJECT_TEST_KEY} bun test")).toBe("API_KEY=${PROJECT_TEST_KEY} bun test");
  expect(validateRepositoryCommand(" bun test ")).toBe("bun test");
});
