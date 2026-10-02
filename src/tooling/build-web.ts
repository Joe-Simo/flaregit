import { cp, rm } from "node:fs/promises";
import tailwind from "./tailwind";

await rm("dist", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["./index.html", "./src/web/diff.worker.ts"],
  outdir: "./dist",
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
await cp("public", "dist", { recursive: true });
for (const output of result.outputs) console.log(`${output.path} (${output.size} bytes)`);
