import { expect, test } from "bun:test";
import { safeSignInReturn } from "../src/web/sign-in-return";
test("preserves participation and forum reply intent without retaining signin routing", () => {
  expect(safeSignInReturn("#/participate/pabcdef012345?signin=1")).toBe("/participate/pabcdef012345");
  expect(safeSignInReturn("#/community-post?topic=forum_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&signin=1")).toBe("/community-post?topic=forum_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  expect(safeSignInReturn("#/?signin=1")).toBe("/");
});
test("rejects external redirects, unknown routes and malformed intent", () => {
  for (const destination of ["https://evil.example", "//evil.example", "/\\evil", "/%2f%2fevil", "/community-post?redirect_url=https://evil.example", "/participate/not-a-repository", "/community-post?topic=https://evil.example", "/community-post?topic=forum_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&topic=x", "/sign-in/sso-callback", "/account#https://evil.example"]) expect(safeSignInReturn(destination)).toBeNull();
});
test("preserves validated private review locations and discards credential-bearing query fields", () => {
  expect(safeSignInReturn("/p/abcdef012345/review?task=change-1&signin=1")).toBe("/p/abcdef012345/review?task=change-1");
  expect(safeSignInReturn("/p/abcdef012345/review?token=secret")).toBeNull();
});
