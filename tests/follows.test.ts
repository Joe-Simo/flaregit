import {expect, test} from "bun:test";
import {emptyGraph, follow, followerCount, unfollow} from "../src/core/follows";

function must(result: ReturnType<typeof follow>) {
  if (!result.ok) throw new Error(result.error);
  return result.graph;
}

test("self-follow is rejected", () => {
  expect(follow(emptyGraph, "a", "a").ok).toBe(false);
});

test("follow and unfollow are idempotent", () => {
  const once = must(follow(emptyGraph, "a", "b"));
  const twice = must(follow(once, "a", "b"));
  expect(followerCount(twice, "b", new Set())).toBe(1);
  const gone = unfollow(unfollow(twice, "a", "b"), "a", "b");
  expect(followerCount(gone, "b", new Set())).toBe(0);
});

test("flagged synthetic accounts are excluded from counts", () => {
  const graph = must(follow(must(follow(emptyGraph, "real", "t")), "bot", "t"));
  expect(followerCount(graph, "t", new Set(["bot"]))).toBe(1);
});
