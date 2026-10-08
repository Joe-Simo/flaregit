import {expect, test} from "bun:test";
import {markAnswer, moderate, reply, type Discussion} from "../src/core/discussions";

const question: Discussion = {
  category: "question",
  authorId: "asker",
  locked: false,
  pinned: false,
  comments: [{id: "c1", authorId: "helper", body: "Try this"}],
};

test("moderation needs a maintainer and is audited", () => {
  expect(moderate(question, "rando", false, "lock").ok).toBe(false);
  const locked = moderate(question, "maint", true, "lock");
  if (!locked.ok) throw new Error(locked.error);
  expect(locked.audit).toEqual({actorId: "maint", action: "lock"});
  expect(reply(locked.discussion, {id: "c2", authorId: "x", body: "hi"}).ok).toBe(false);
});

test("answers are marked only by the asker or a maintainer on existing comments", () => {
  expect(markAnswer(question, "rando", false, "c1").ok).toBe(false);
  expect(markAnswer(question, "asker", false, "missing").ok).toBe(false);
  const marked = markAnswer(question, "asker", false, "c1");
  expect(marked.ok && marked.discussion.answerId).toBe("c1");
  expect(markAnswer({...question, category: "general"}, "asker", false, "c1").ok).toBe(false);
});

test("empty replies are refused", () => {
  expect(reply(question, {id: "c2", authorId: "x", body: "  "}).ok).toBe(false);
});
