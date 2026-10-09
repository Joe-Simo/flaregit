import {expect, test} from "bun:test";
import {addRevision, canReadRaw, createSnippet, latest, listFor} from "../src/core/snippets";

const pub = createSnippet("1", "owner", "public", "v1");
const secret = createSnippet("2", "owner", "secret", "s");
const priv = createSnippet("3", "owner", "private", "p");

test("listing for others excludes non-public snippets, owner sees all", () => {
  const all = [pub, secret, priv];
  expect(listFor(all, "other", "owner").map((s) => s.id)).toEqual(["1"]);
  expect(listFor(all, undefined, "owner").map((s) => s.id)).toEqual(["1"]);
  expect(listFor(all, "owner", "owner").map((s) => s.id)).toEqual(["1", "2", "3"]);
});

test("raw access follows visibility rules", () => {
  expect(canReadRaw(pub, undefined, false)).toBe(true);
  expect(canReadRaw(secret, "other", false)).toBe(false);
  expect(canReadRaw(secret, "other", true)).toBe(true);
  expect(canReadRaw(priv, "other", true)).toBe(false);
  expect(canReadRaw(priv, "owner", false)).toBe(true);
});

test("revisions are append-only", () => {
  const next = addRevision(pub, "v2");
  expect(pub.revisions).toHaveLength(1);
  expect(next.revisions.map((r) => r.content)).toEqual(["v1", "v2"]);
  expect(latest(next).number).toBe(2);
});
