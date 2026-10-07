import { expect, test } from "bun:test";
import { dispatchRecoverableComment,commentContent, readConversationDraft, saveConversationDraft } from "../src/web/conversation-recovery";
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

test("selecting another review line preserves the body and new exact anchor across reload without reusing the old send", async () => {
  const { reanchorConversationDraft } = await import("../src/web/conversation-recovery");
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const scope = { identity: "user:session", projectId: "p1", subject: "change:t1" };
  const original = { path: "src/test.ts", line: 3, commit: "a".repeat(40) };
  const intent = { key: crypto.randomUUID(), payload: JSON.stringify(commentContent(scope.subject, "Review text", original)) };
  const draft = { body: "Review text", anchor: original, intent };
  expect(reanchorConversationDraft(scope.subject, draft, { ...original }).intent).toEqual(intent);
  const selected = { ...original, line: 8, commit: "b".repeat(40) };
  const updated = reanchorConversationDraft(scope.subject, draft, selected);
  expect(updated.intent).toBeNull();
  expect(saveConversationDraft(storage, scope, updated)).toBe(true);
  expect(readConversationDraft(storage, scope)).toEqual({ body: "Review text", anchor: selected, intent: null });
});

test("a comment cannot dispatch unless its original request is recoverable", async () => {
  const { dispatchRecoverableComment } = await import("../src/web/conversation-recovery");
  let dispatches = 0;
  const dispatch = async () => { dispatches++; return "confirmed"; };
  await expect(dispatchRecoverableComment(() => false, dispatch)).rejects.toThrow("no comment was sent");
  expect(dispatches).toBe(0);
  await expect(dispatchRecoverableComment(() => true, dispatch)).resolves.toBe("confirmed");
  expect(dispatches).toBe(1);
});

test('silent comment recovery loss cannot dispatch and exact retained request survives lost acknowledgement',async()=>{
 const scope={identity:'owner',projectId:'project',subject:'issue:1'},body='Original human comment',key=crypto.randomUUID(),draft={body,anchor:null,intent:{key,payload:JSON.stringify(commentContent(scope.subject,body,null))}};let posts=0;
 for(const value of [null,'altered'])await expect(dispatchRecoverableComment(()=>saveConversationDraft({getItem:()=>value,setItem:()=>{},removeItem:()=>{}},scope,draft),async()=>{posts++;})).rejects.toThrow('no comment was sent');
 expect(posts).toBe(0);
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 await expect(dispatchRecoverableComment(()=>saveConversationDraft(storage,scope,draft),async()=>{posts++;throw Error('Lost ACK');})).rejects.toThrow('Lost ACK');
 expect(readConversationDraft(storage,scope)).toEqual(draft);expect(posts).toBe(1);
});
