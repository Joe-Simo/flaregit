import {expect, test} from "bun:test";
import {requestReview} from "../src/core/review-requests";

test("review requests respect authorship, access and duplicates", () => {
  const readers = (id: string) => id !== "outsider";
  expect(requestReview([], "a", "a", readers).ok).toBe(false);
  expect(requestReview([], "a", "outsider", readers).ok).toBe(false);
  const first = requestReview([], "a", "b", readers);
  expect(first.ok && first.pending).toEqual(["b"]);
  const again = requestReview(["b"], "a", "b", readers);
  expect(again.ok && again.pending).toEqual(["b"]);
});
