import { expect, test } from "bun:test";
import { preservePreviewLink } from "../src/web/preview-display";

const now = Date.parse("2026-10-04T00:00:00Z");
const previous = { ready: true as const, generationId: "active", url: "https://repo.preview.workers.dev/old-capability/", expiresAt: "2026-10-04T01:00:00Z" };
test("replacement polling updates status without reloading the active application", () => {
  const next = { ...previous, url: "https://repo.preview.workers.dev/new-capability/", replacement: { status: "building" } };
  expect(preservePreviewLink(previous, next, false, now)).toEqual({ ...next, url: previous.url });
  expect(preservePreviewLink(previous, next, true, now)).toEqual(next);
});
test("new active generation, origin, missing scope and expiring links use fresh capabilities", () => {
  const next = { ...previous, url: "https://repo.preview.workers.dev/new-capability/" };
  expect(preservePreviewLink(null, next, false, now)).toEqual(next);
  expect(preservePreviewLink(previous, { ...next, generationId: "replacement" }, false, now).url).toBe(next.url);
  const differentOrigin = { ...next, url: "https://other.preview.workers.dev/new-capability/" };
  expect(preservePreviewLink(previous, differentOrigin, false, now)).toEqual(differentOrigin);
  expect(preservePreviewLink(previous, next, false, Date.parse(previous.expiresAt) - 20_000)).toEqual(next);
  expect(preservePreviewLink({ ...previous, expiresAt: undefined }, next, false, now)).toEqual(next);
});
