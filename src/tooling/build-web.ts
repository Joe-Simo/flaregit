import { cp, readdir, rm, rename } from "node:fs/promises";
import tailwind from "./tailwind";
import { retainWebAssets, importVerifiedWebAssetRelease, exportWebAssetRelease } from "./retained-web-assets";
import { join, resolve, relative } from "node:path";

const args = Bun.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const prior = option("--prior-assets-manifest");
if (prior) {
  const manifestSha256 = option("--prior-assets-sha256"), source = option("--prior-assets-source"), assetsDir = option("--prior-assets-dir");
  if (!manifestSha256 || !source || !assetsDir) throw Error("Prior assets require pinned manifest digest, source and directory");
  await importVerifiedWebAssetRelease({ manifestPath: resolve(prior), manifestSha256, source, assetsDir: resolve(assetsDir) }, resolve(".cache/web-assets"));
}
await rm(".cache/web-build", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["./index.html", "./src/web/diff.worker.ts"],
  outdir: "./.cache/web-build",
  target: "browser",
  minify: true,
  splitting: true,
  env: "disable",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  naming: { entry: "[name].[ext]", chunk: "assets/[name]-[hash].[ext]", asset: "assets/[name]-[hash].[ext]" },
  plugins: [tailwind],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const releaseSource = option("--source-sha");
if (releaseSource) {
  const receipt = await exportWebAssetRelease(resolve(".cache/web-build"), result.outputs.map(output => output.path), releaseSource, resolve(".cache/web-release.json"));
  console.log(JSON.stringify(receipt));
}
await retainWebAssets(resolve(".cache/web-build"), result.outputs.map(output => output.path), resolve(".cache/web-assets"));
// Copy each public entry explicitly: Bun 1.4.2 rejects copying a directory onto the existing build output directory, while any real name collision still fails here.
for (const entry of await readdir("public")) await cp(join("public", entry), join(".cache/web-build", entry), { recursive: true, force: false, errorOnExist: true });
const outputs = result.outputs.map(output => ({ path: resolve("dist", relative(resolve(".cache/web-build"), output.path)), size: output.size }));
await rm("dist", { recursive: true, force: true });
await rename(".cache/web-build", "dist");
for (const output of outputs) console.log(`${output.path} (${output.size} bytes)`);
