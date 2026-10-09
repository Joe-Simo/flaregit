import { expect, test } from "bun:test";
import { applyLifecycleAction, assertWritable, initialLifecycle } from "../src/core/repository-lifecycle";

const admin = { canAdmin: true };
const reader = { canAdmin: false };
const at = "2026-10-08T12:00:00.000Z";

test("administrator archives an active repository and records the time and a new version", () => {
  const result = applyLifecycleAction(initialLifecycle(), "archive", admin, at);
  expect(result).toEqual({ ok: true, next: { state: "archived", archivedAt: at, version: 2 } });
});

test("administrator unarchives and restores active state with no archive time", () => {
  const archived = applyLifecycleAction(initialLifecycle(), "archive", admin, at);
  if (!archived.ok) throw new Error("setup failed");
  const restored = applyLifecycleAction(archived.next, "unarchive", admin, "2026-10-09T12:00:00.000Z");
  expect(restored).toEqual({ ok: true, next: { state: "active", archivedAt: null, version: 3 } });
});

test("archiving twice and unarchiving an active repository are refused without changing state", () => {
  const archived = applyLifecycleAction(initialLifecycle(), "archive", admin, at);
  if (!archived.ok) throw new Error("setup failed");
  expect(applyLifecycleAction(archived.next, "archive", admin, at)).toEqual({ ok: false, status: 409, error: "Repository is already archived" });
  expect(applyLifecycleAction(initialLifecycle(), "unarchive", admin, at)).toEqual({ ok: false, status: 409, error: "Repository is not archived" });
});

test("non-administrators cannot archive or unarchive, even when the transition would be valid", () => {
  const denied = applyLifecycleAction(initialLifecycle(), "archive", reader, at);
  expect(denied).toEqual({ ok: false, status: 403, error: "Only repository administrators can change archive state" });
  const archived = applyLifecycleAction(initialLifecycle(), "archive", admin, at);
  if (!archived.ok) throw new Error("setup failed");
  expect(applyLifecycleAction(archived.next, "unarchive", reader, at).ok).toBe(false);
});

test("archived repositories refuse writes and active repositories accept them", () => {
  expect(() => assertWritable(initialLifecycle())).not.toThrow();
  const archived = applyLifecycleAction(initialLifecycle(), "archive", admin, at);
  if (!archived.ok) throw new Error("setup failed");
  expect(() => assertWritable(archived.next)).toThrow("Repository is archived and read-only");
});

test('versioned lifecycle transition refuses a stale snapshot after archive/unarchive cycle',()=>{
 const first=applyLifecycleAction(initialLifecycle(),'archive',admin,at,1);if(!first.ok)throw Error('Setup failed');const restored=applyLifecycleAction(first.next,'unarchive',admin,at,2);if(!restored.ok)throw Error('Setup failed');
 expect(applyLifecycleAction(restored.next,'archive',admin,at,1)).toMatchObject({ok:false,status:409});expect(restored.next).toEqual({state:'active',archivedAt:null,version:3});
});
