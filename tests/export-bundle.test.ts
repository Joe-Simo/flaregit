import {expect, test} from "bun:test";
import {buildManifest, verifyManifest, type ExportObject} from "../src/core/export-bundle";

const objects: ExportObject[] = [
  {kind: "issue", id: "1", body: "public", private: false},
  {kind: "issue", id: "2", body: "secret", private: true},
];

test("private objects are excluded without access", async () => {
  expect((await buildManifest(objects, false)).map((entry) => entry.id)).toEqual(["1"]);
  expect((await buildManifest(objects, true)).length).toBe(2);
});

test("tampered or missing content is reported", async () => {
  const manifest = await buildManifest(objects, true);
  expect(await verifyManifest(manifest, objects)).toEqual([]);
  expect(await verifyManifest(manifest, [{...objects[0]!, body: "changed"}])).toEqual(["1", "2"]);
});
