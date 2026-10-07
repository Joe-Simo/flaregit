import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";

const immutablePath = /^assets\/[A-Za-z0-9_.-]+-[a-z0-9]{8}\.(?:js|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif|ico)$/;
const manifestSchema = z.array(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), files: z.array(z.object({ path: z.string().regex(immutablePath), digest: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() })) }));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Retain complete immutable asset generations, never HTML, maps, public files or credentials. */
export async function retainWebAssets(outputDir: string, outputPaths: readonly string[], cacheDir: string, options = { priorGenerations: 3, maxBytes: 64 * 1024 * 1024 }) {
  if (!Number.isInteger(options.priorGenerations) || options.priorGenerations < 0 || options.priorGenerations > 10 || !Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) throw Error("Invalid immutable asset retention limits");
  await mkdir(cacheDir, { recursive: true });
  const manifestPath = join(cacheDir, "generations.json");
  let previous: z.infer<typeof manifestSchema> = [];
  try { previous = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8"))); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const files = [];
  for (const output of outputPaths) {
    const path = relative(outputDir, output).replaceAll("\\", "/");
    if (!immutablePath.test(path)) continue;
    const bytes = await readFile(output);
    files.push({ path, digest: digest(bytes), bytes: bytes.byteLength });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const id = digest(Buffer.from(JSON.stringify(files)));
  const current = { id, files };
  const generations = [current, ...previous.filter(value => value.id !== id)].slice(0, options.priorGenerations + 1);
  const size = () => new Map(generations.flatMap(value => value.files.map(file => [file.path, file.bytes] as const))).values().reduce((sum, bytes) => sum + bytes, 0);
  while (generations.length > 1 && size() > options.maxBytes) generations.pop();
  if (size() > options.maxBytes) throw Error("Current immutable assets exceed retention budget");
  const known = new Map<string, string>();
  for (const generation of generations) for (const file of generation.files) {
    const old = known.get(file.path);
    if (old && old !== file.digest) throw Error(`Immutable asset collision: ${file.path}`);
    known.set(file.path, file.digest);
  }
  for (const file of files) {
    const target = join(cacheDir, id, file.path);
    await mkdir(join(cacheDir, id, "assets"), { recursive: true });
    await cp(join(outputDir, file.path), target);
  }
  for (const generation of generations.slice(1)) for (const file of generation.files) {
    const source = join(cacheDir, generation.id, file.path);
    const bytes = await readFile(source);
    if (digest(bytes) !== file.digest || bytes.byteLength !== file.bytes) throw Error(`Retained asset integrity failed: ${file.path}`);
    if (!files.some(currentFile => currentFile.path === file.path)) await cp(source, join(outputDir, file.path));
  }
  await writeFile(`${manifestPath}.tmp`, JSON.stringify(generations));
  await rename(`${manifestPath}.tmp`, manifestPath);
  for (const entry of await readdir(cacheDir, { withFileTypes: true })) if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name) && !generations.some(value => value.id === entry.name)) await rm(join(cacheDir, entry.name), { recursive: true });
  return { generations: generations.length, retainedFiles: known.size, bytes: size() };
}

const releaseSchema = z.object({ version: z.literal(1), source: z.string().regex(/^[a-f0-9]{40}$/), files: manifestSchema.element.shape.files });
export type VerifiedWebAssetRelease = { manifestPath: string; manifestSha256: string; source: string; assetsDir: string };

/** Caller pins the manifest from an owned release receipt; a writable CI cache is not provenance. */
export async function importVerifiedWebAssetRelease(input: VerifiedWebAssetRelease, cacheDir: string) {
  if (!/^[a-f0-9]{64}$/.test(input.manifestSha256) || !/^[a-f0-9]{40}$/.test(input.source)) throw Error("Invalid prior release provenance");
  const raw = await readFile(input.manifestPath);
  if (digest(raw) !== input.manifestSha256) throw Error("Prior release manifest digest mismatch");
  const release = releaseSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
  if (release.source !== input.source) throw Error("Prior release source mismatch");
  const paths = new Set<string>();
  let bytes = 0;
  const verified = [];
  for (const file of release.files) {
    if (paths.has(file.path)) throw Error("Duplicate prior release asset");
    paths.add(file.path); bytes += file.bytes;
    if (bytes > 64 * 1024 * 1024 || release.files.length > 1000) throw Error("Prior release exceeds retention budget");
    const body = await readFile(join(input.assetsDir, file.path));
    if (body.byteLength !== file.bytes || digest(body) !== file.digest) throw Error(`Prior release asset integrity failed: ${file.path}`);
    verified.push({ file, body });
  }
  const files = release.files.toSorted((a, b) => a.path.localeCompare(b.path));
  const id = digest(Buffer.from(JSON.stringify(files)));
  await mkdir(join(cacheDir, id, "assets"), { recursive: true });
  for (const { file, body } of verified) await writeFile(join(cacheDir, id, file.path), body);
  const manifestPath = join(cacheDir, "generations.json");
  // Explicit verified input replaces any restored untrusted cache history.
  await writeFile(`${manifestPath}.tmp`, JSON.stringify([{ id, files }]));
  await rename(`${manifestPath}.tmp`, manifestPath);
  return { source: release.source, generation: id, files: files.length, bytes };
}

/** Export only the current Bun output inventory, suitable for an owned deployment receipt. */
export async function exportWebAssetRelease(outputDir: string, outputPaths: readonly string[], source: string, manifestPath: string) {
  if (!/^[a-f0-9]{40}$/.test(source)) throw Error("Invalid release source");
  const files = [];
  for (const output of outputPaths) {
    const path = relative(outputDir, output).replaceAll("\\", "/");
    if (!immutablePath.test(path)) continue;
    const body = await readFile(output);
    files.push({ path, digest: digest(body), bytes: body.byteLength });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const raw = JSON.stringify({ version: 1, source, files });
  await writeFile(manifestPath, raw);
  return { source, manifestSha256: digest(Buffer.from(raw)), files: files.length };
}
