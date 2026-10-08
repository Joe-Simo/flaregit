import {expect, test} from "bun:test";
import {
  createRedirectTable,
  deleteResource,
  exportRedirects,
  importRedirects,
  lookupMissing,
  MAX_REDIRECT_DEPTH,
  recordRename,
  registerRepository,
  resolve,
  type RedirectRecord,
  type RedirectResult,
  type RedirectTable,
} from "../src/core/redirects";

const DAY = 24 * 60 * 60 * 1000;
const name = (index: number) => `repo-${index}`;

function unwrap(result: RedirectResult): RedirectTable {
  if (!result.ok) throw new Error(result.error);
  return result.table;
}

function refusal(result: RedirectResult): string {
  if (result.ok) throw new Error("Expected the change to be refused");
  return result.error;
}

test("a rename keeps the old name as a permanent redirect", () => {
  const time = {now: 0};
  let table = unwrap(registerRepository(createRedirectTable(() => time.now), "alpha"));
  table = unwrap(recordRename(table, "alpha", "beta", "alice"));

  expect(resolve(table, "alpha")).toEqual({ok: true, name: "beta", redirectedFrom: ["alpha"]});
  expect(resolve(table, "beta")).toEqual({ok: true, name: "beta", redirectedFrom: []});
  expect(resolve(table, "ghost")).toEqual({ok: false, reason: "not-found", name: "ghost", redirectedFrom: []});
});

test("renames refuse self-renames, unknown old names, claimed names and redirect names", () => {
  const time = {now: 0};
  const base = unwrap(registerRepository(createRedirectTable(() => time.now), "alpha"));

  expect(refusal(recordRename(base, "alpha", "alpha", "alice"))).toContain("own name");
  expect(refusal(recordRename(base, "ghost", "beta", "alice"))).toContain("not a current repository name");
  expect(refusal(recordRename(base, "alpha", "beta", ""))).toContain("needs an actor");
  expect(refusal(registerRepository(base, "alpha"))).toContain("already claimed as a current name by another repository");

  const withGamma = unwrap(registerRepository(base, "gamma"));
  expect(refusal(recordRename(withGamma, "alpha", "gamma", "alice"))).toContain("already claimed as a current name");

  const renamed = unwrap(recordRename(withGamma, "alpha", "beta", "alice"));
  expect(refusal(recordRename(renamed, "gamma", "alpha", "alice"))).toContain("permanent redirect");
});

test("renames refuse to close a redirect loop", () => {
  let table = unwrap(registerRepository(createRedirectTable(() => 0), "alpha"));
  table = unwrap(recordRename(table, "alpha", "beta", "alice"));
  expect(refusal(recordRename(table, "beta", "alpha", "alice"))).toContain("loop");

  table = unwrap(recordRename(table, "beta", "gamma", "alice"));
  expect(refusal(recordRename(table, "gamma", "alpha", "alice"))).toContain("loop");
  expect(resolve(table, "alpha")).toEqual({ok: true, name: "gamma", redirectedFrom: ["alpha", "beta"]});
});

test("redirect chains stop at the depth limit", () => {
  let table = unwrap(registerRepository(createRedirectTable(() => 0), name(0)));
  for (let index = 0; index < MAX_REDIRECT_DEPTH; index += 1) {
    table = unwrap(recordRename(table, name(index), name(index + 1), "alice"));
  }
  const fromFirst = Array.from({length: MAX_REDIRECT_DEPTH}, (_, index) => name(index));
  expect(resolve(table, name(0))).toEqual({ok: true, name: name(MAX_REDIRECT_DEPTH), redirectedFrom: fromFirst});
  expect(refusal(recordRename(table, name(MAX_REDIRECT_DEPTH), name(MAX_REDIRECT_DEPTH + 1), "alice"))).toContain("exceed");
});

test("resolve reports too-deep for a chain longer than the limit", () => {
  const redirects = new Map<string, RedirectRecord>();
  for (let index = 0; index <= MAX_REDIRECT_DEPTH; index += 1) {
    redirects.set(name(index), {to: name(index + 1), actorId: "alice", renamedAt: 0});
  }
  const table: RedirectTable = {clock: () => 0, current: new Set([name(MAX_REDIRECT_DEPTH + 1)]), redirects, tombstones: new Map()};
  expect(resolve(table, name(0)).ok).toBe(false);
  expect(resolve(table, name(0))).toMatchObject({reason: "too-deep"});
  expect(resolve(table, name(1))).toMatchObject({ok: true, name: name(MAX_REDIRECT_DEPTH + 1)});
});

test("a deleted name stays reserved for 90 days", () => {
  const time = {now: 0};
  let table = unwrap(registerRepository(createRedirectTable(() => time.now), "alpha"));
  table = unwrap(registerRepository(table, "beta"));

  time.now = 10 * DAY;
  table = unwrap(deleteResource(table, "repository", "alpha", "  owner removed it  "));
  expect(resolve(table, "alpha")).toMatchObject({
    ok: false,
    reason: "gone",
    name: "alpha",
    tombstone: {kind: "repository", id: "alpha", deletedAt: 10 * DAY, reason: "owner removed it"},
  });

  time.now = 10 * DAY + 89 * DAY;
  expect(refusal(registerRepository(table, "alpha"))).toContain("cannot be reused until");
  expect(refusal(recordRename(table, "beta", "alpha", "alice"))).toContain("cannot be reused until");

  time.now = 10 * DAY + 90 * DAY;
  const reclaimed = unwrap(registerRepository(table, "alpha"));
  expect(resolve(reclaimed, "alpha")).toEqual({ok: true, name: "alpha", redirectedFrom: []});
});

test("a deleted name that a redirect still targets is never reclaimed", () => {
  const time = {now: 0};
  let table = unwrap(registerRepository(createRedirectTable(() => time.now), "alpha"));
  table = unwrap(recordRename(table, "alpha", "beta", "alice"));
  table = unwrap(deleteResource(table, "repository", "beta", "retired"));

  time.now = 365 * DAY;
  expect(refusal(registerRepository(table, "beta"))).toContain("still the target of a permanent redirect");
  expect(resolve(table, "alpha")).toMatchObject({ok: false, reason: "gone", name: "beta", redirectedFrom: ["alpha"]});
});

test("deleted issues answer gone while never-seen issues answer not-found", () => {
  const time = {now: 7 * DAY};
  const table = unwrap(deleteResource(createRedirectTable(() => time.now), "issue", "42", "spam"));

  expect(lookupMissing(table, "issue", "42")).toEqual({
    status: "gone",
    tombstone: {kind: "issue", id: "42", deletedAt: 7 * DAY, reason: "spam"},
  });
  expect(lookupMissing(table, "issue", "43")).toEqual({status: "not-found"});
  expect(refusal(deleteResource(table, "issue", "42", "again"))).toContain("already deleted");
  expect(refusal(deleteResource(table, "issue", "44", "   "))).toContain("needs a reason");
  expect(refusal(deleteResource(table, "repository", "ghost", "gone"))).toContain("not a current repository name");
});

test("exported redirects are sorted and import back to the same answers", () => {
  const time = {now: 5 * DAY};
  let table = unwrap(registerRepository(createRedirectTable(() => time.now), "zeta"));
  table = unwrap(recordRename(table, "zeta", "omega", "bob"));
  table = unwrap(registerRepository(table, "alpha"));
  table = unwrap(recordRename(table, "alpha", "beta", "alice"));

  const exported = exportRedirects(table);
  expect(exported).toEqual([
    {from: "alpha", to: "beta", actorId: "alice", renamedAt: 5 * DAY},
    {from: "zeta", to: "omega", actorId: "bob", renamedAt: 5 * DAY},
  ]);

  const imported = unwrap(importRedirects(JSON.parse(JSON.stringify(exported)), () => time.now));
  expect(exportRedirects(imported)).toEqual(exported);
  expect(resolve(imported, "zeta")).toEqual(resolve(table, "zeta"));
  expect(resolve(imported, "alpha")).toEqual(resolve(table, "alpha"));
  expect(refusal(registerRepository(imported, "omega"))).toContain("already claimed as a current name");
});

test("invalid redirect imports are refused", () => {
  const clock = () => 0;
  const entry = (from: string, to: string, actorId = "alice") => ({from, to, actorId, renamedAt: 0});

  expect(refusal(importRedirects("alpha", clock))).toContain("must be a list");
  expect(refusal(importRedirects(["alpha->beta"], clock))).toContain("must be an object");
  expect(refusal(importRedirects([entry("", "beta")], clock))).toContain("non-empty from and to");
  expect(refusal(importRedirects([entry("alpha", "alpha")], clock))).toContain("points to itself");
  expect(refusal(importRedirects([{from: "alpha", to: "beta", renamedAt: 0}], clock))).toContain("needs an actor");
  expect(refusal(importRedirects([{from: "alpha", to: "beta", actorId: "alice"}], clock))).toContain("renamedAt");
  expect(refusal(importRedirects([entry("alpha", "beta"), entry("alpha", "gamma")], clock))).toContain("more than once");
  expect(refusal(importRedirects([entry("alpha", "beta"), entry("beta", "alpha")], clock))).toContain("loop");

  const chain = Array.from({length: MAX_REDIRECT_DEPTH + 1}, (_, index) => entry(name(index), name(index + 1)));
  expect(refusal(importRedirects(chain, clock))).toContain("exceed");
  expect(importRedirects(chain.slice(0, MAX_REDIRECT_DEPTH), clock).ok).toBe(true);
});
