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

test("sign-in preserves a saved canonical comparison and its recovery navigation", () => {
  const commit = "c".repeat(40), base = "b".repeat(40);
  expect(safeSignInReturn(`/p/pabcdef012345/review?commit=${commit}&base=${base}&from=recovery&signin=1`)).toBe(`/p/pabcdef012345/review?commit=${commit}&base=${base}&from=recovery`);
  expect(safeSignInReturn("/p/pabcdef012345/review?candidate=candidate_1&input=task_1&signin=1")).toBe("/p/pabcdef012345/review?candidate=candidate_1&input=task_1");
  for (const query of [`commit=${commit.slice(0, 7)}&base=${base}`, `commit=${commit}&base=${base}&from=https://other.example`, `task=task-1&base=${base}`, "input=task_1", `commit=${commit}&base=${base}&input=task_1`, `commit=${commit}&from=recovery`]) expect(safeSignInReturn(`/p/pabcdef012345/review?${query}`)).toBeNull();
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


test("community sign-in retains social section intent without broadening return URLs", () => {
  for (const view of ["activity", "following", "repositories", "people", "help"]) {
    expect(safeSignInReturn(`#/community?view=${view}&signin=1`)).toBe(`/community?view=${view}`);
    expect(safeSignInReturn(`/community?view=${view}&repo=pabcdef012345`)).toBeNull();
    expect(safeSignInReturn(`/community?view=${view}&view=help`)).toBeNull();
    expect(safeSignInReturn(`/community?view=${view}&redirect_url=https://evil.example`)).toBeNull();
  }
  for (const view of ["activity", "following", "repositories", "people"]) {
    expect(safeSignInReturn(`/community?view=${view}&topic=forum_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`)).toBeNull();
    expect(safeSignInReturn(`/community?view=${view}&topic=discussion_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`)).toBeNull();
  }
  for (const value of ["/community?view=https%3A%2F%2Fevil.example", "/community?view=people&signin=2", "/community?view=people&token=secret", "/community?view=people&handle=https://evil.example", "/community?view=following&cursor=1", "/community?view=people&signin=1&signin=1"]) expect(safeSignInReturn(value)).toBeNull();
});
