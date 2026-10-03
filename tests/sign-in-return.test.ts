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

test("repository discussion sign-in preserves only validated local context", () => {
 expect(safeSignInReturn("#/community-post?repo=pabcdef012345&topic=discussion_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&signin=1")).toBe("/community-post?repo=pabcdef012345&topic=discussion_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
 for (const value of ["/community-post?repo=https://evil.example", "/community-post?repo=pabcdef012345&topic=forum_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "/community-post?topic=discussion_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "/community-post?repo=pabcdef012345&repo=pabcdef012346"]) expect(safeSignInReturn(value)).toBeNull();
});

test("private discussions keep local topic intent", () => { expect(safeSignInReturn("#/p/pabcdef012345/discussions?topic=discussion_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&signin=1")).toBe("/p/pabcdef012345/discussions?topic=discussion_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"); expect(safeSignInReturn("#/p/pabcdef012345/discussions?topic=https://evil.example")).toBeNull(); });

test("community sign-in resumes exact public repository or help conversation", () => {
  expect(safeSignInReturn("#/community?signin=1")).toBe("/community");
  expect(safeSignInReturn("#/community?repo=pabcdef012345&topic=discussion_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&signin=1")).toBe("/community?repo=pabcdef012345&topic=discussion_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  expect(safeSignInReturn("#/community?view=help&topic=forum_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&signin=1")).toBe("/community?view=help&topic=forum_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  for (const value of ["/community?redirect_url=https://evil.example", "/community?repo=private-url", "/community?view=help&repo=pabcdef012345", "/community?view=anything", "/community?topic=forum_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "/community?repo=pabcdef012345&topic=forum_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "/community?view=help&topic=discussion_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "/community?repo=pabcdef012345&repo=pabcdef012346"]) expect(safeSignInReturn(value)).toBeNull();
});
