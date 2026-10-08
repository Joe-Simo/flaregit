import {expect, test} from "bun:test";
import {closePoll, results, vote, type Poll} from "../src/core/polls";

const poll: Poll = {id: "p1", options: ["a", "b"], closed: false, votes: {}};

function must(result: ReturnType<typeof vote>): Poll {
  if (!result.ok) throw new Error(result.error);
  return result.poll;
}

test("changing a vote moves it instead of double counting", () => {
  const first = must(vote(poll, "u1", "a"));
  const changed = must(vote(first, "u1", "b"));
  expect(results(changed)).toEqual({a: 0, b: 1});
});

test("unknown options are rejected and counts include zero options", () => {
  expect(vote(poll, "u1", "z").ok).toBe(false);
  expect(results(poll)).toEqual({a: 0, b: 0});
});

test("closed polls reject votes and keep results", () => {
  const voted = must(vote(poll, "u1", "a"));
  const closed = closePoll(voted);
  expect(vote(closed, "u2", "b").ok).toBe(false);
  expect(vote(closed, "u1", "b").ok).toBe(false);
  expect(results(closed)).toEqual({a: 1, b: 0});
});
