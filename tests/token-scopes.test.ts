import {expect, test} from "bun:test";
import {allows, parseScopes} from "../src/core/token-scopes";

test("write implies read of the same resource only", () => {
  expect(allows(["issues:write"], "issues:read")).toBe(true);
  expect(allows(["issues:write"], "code:read")).toBe(false);
  expect(allows(["issues:read"], "issues:write")).toBe(false);
});

test("unknown or empty scope lists are refused and duplicates collapse", () => {
  expect(parseScopes([]).ok).toBe(false);
  expect(parseScopes(["admin:all"]).ok).toBe(false);
  const parsed = parseScopes(["code:read", "code:read"]);
  expect(parsed.ok && parsed.scopes).toEqual(["code:read"]);
});
