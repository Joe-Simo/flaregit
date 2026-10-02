import { expect, test } from "bun:test";
import { fileBytes, MAX_FILE_BYTES } from "../src/server/file-bytes";

test("binary sandbox reads preserve PNG signature and invalid UTF-8 bytes", () => {
  const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255, 0, 128]);
  expect(fileBytes({ stdout: original.buffer, exitCode: 0 }, "asset.png")).toEqual(original);
});

test("asset byte limit accepts the boundary and rejects bounded overread", () => {
  expect(fileBytes({ stdout: new ArrayBuffer(MAX_FILE_BYTES), exitCode: 0 }, "font.woff2").byteLength).toBe(MAX_FILE_BYTES);
  expect(() => fileBytes({ stdout: new ArrayBuffer(MAX_FILE_BYTES + 1), exitCode: 0 }, "large.bin")).toThrow("16 MiB asset limit");
  expect(() => fileBytes({ stdout: new ArrayBuffer(0), exitCode: 1 }, "missing.png")).toThrow("read missing.png failed");
});
