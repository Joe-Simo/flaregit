import { expect, test } from "bun:test";
import { redactSecrets } from "../src/agents/prompt.js";

test.each([
  '{"api_key":"credential-value-123456"}',
  '{"access_token": "credential-value-123456"}',
  "const password = 'credential-value-123456';",
  "API_KEY=credential-value-123456",
  "Authorization: Bearer credential-value-123456",
  "art_v1_abcdefghijklmnopqrstuvwxyz012345?expires=1234567890",
])("redacts supported embedded credentials: %s", (input) => {
  const output = redactSecrets(input);
  expect(output).toContain("[REDACTED]");
  expect(output).not.toContain("credential-value-123456");
  expect(output).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
});

test.each([
  "const password = input.password;",
  "const secret = process.env.SECRET;",
  "const data = { password: input.password, api_key: config.apiKey };",
  '{"api_key": input.apiKey}',
  "function authenticate(access_token: string) { return access_token; }",
])("preserves credential variable references: %s", (input) => {
  expect(redactSecrets(input)).toBe(input);
});
