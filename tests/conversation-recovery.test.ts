import { expect, test } from "bun:test";
import { commentContent, readConversationDraft, saveConversationDraft } from "../src/web/conversation-recovery";
test("recovery keeps exact unknown-send key and anchor and rejects other sessions or subjects", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const scope = { identity: "user:session", projectId: "p1", subject: "candidate:c1" };
  const anchor = { path: "src/test.ts", line: 3, commit: "a".repeat(40) };
  const draft = { body: "Review text", anchor, intent: { key: crypto.randomUUID(), payload: JSON.stringify(commentContent(scope.subject, "Review text", anchor)) } };
  expect(saveConversationDraft(storage, scope, draft)).toBe(true);
  expect(readConversationDraft(storage, scope)).toEqual(draft);
  expect(readConversationDraft(storage, { ...scope, identity: "other:session" })).toBeNull();
  expect(readConversationDraft(storage, { ...scope, subject: "candidate:c2" })).toBeNull();
  expect(readConversationDraft(storage, { ...scope, projectId: "p2" })).toBeNull();
  saveConversationDraft(storage, scope, { ...draft, body: "  Review text \n" });
  expect(readConversationDraft(storage, scope)?.intent).toEqual(draft.intent);
  saveConversationDraft(storage, scope, { ...draft, body: "Changed content" });
  expect(readConversationDraft(storage, scope)).toBeNull();
});
