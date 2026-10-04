import { isSafeRef } from "../core/sanitize";
import { q } from "./shell";

export type GitMigrationObjectType = "commit" | "tree" | "blob" | "tag";
export interface GitMigrationRef { ref: string; object: string; type: GitMigrationObjectType; peeledObject: string; peeledType: Exclude<GitMigrationObjectType, "tag"> }
export interface GitMigrationInventory {
  scope: "owned-native-heads-tags-reachable-git-objects";
  status: "complete" | "incomplete"; reason?: "ref_capacity" | "object_capacity" | "metadata_unavailable";
  refs: GitMigrationRef[]; objects: Record<string, GitMigrationObjectType>; observedExternalGitlinks: string[];
  excluded: readonly ["other-refs", "lfs-object-bytes", "submodule-repositories"];
  capturedAt: string; providerVerified: false;
}
export interface GitMigrationInventoryExecutor {
  exec(command: string, env: Record<string, string>): Promise<{success:boolean;stdout:string;truncated?:boolean}>;
  beforeCommand(): Promise<void>;
}
const sha = /^[a-f0-9]{40}$/;
const types = new Set<string>(["commit", "tree", "blob", "tag"]);
class InventoryUnavailable extends Error {}
class InventoryCallbackFailure { constructor(readonly original: unknown) {} }

/** Read an already acquired owner-controlled bare repository. The caller owns
 * acquisition authorization, network/disk/time budgets and positive native cleanup.
 * No fetch, push, hooks, checkout or provider writes execute here. A positive random
 * completion sentinel rejects omitted/truncated stdout, including empty inventories.
 */
export async function captureGitMigrationInventory(executor: GitMigrationInventoryExecutor, directory: string, limits: {maxRefs?:number;maxObjects?:number} = {}): Promise<GitMigrationInventory> {
  if (!directory.startsWith("/") || directory === "/" || /[\x00-\x1f\x7f]/.test(directory)) throw new Error("Owned bare repository required");
  const maxRefs = limits.maxRefs ?? 200, maxObjects = limits.maxObjects ?? 10000;
  if (!Number.isSafeInteger(maxRefs) || maxRefs < 1 || maxRefs > 1000 || !Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 25000) throw new Error("Invalid migration inventory limits");
  const inventory: GitMigrationInventory = { scope: "owned-native-heads-tags-reachable-git-objects", status: "incomplete", refs: [], objects: {}, observedExternalGitlinks: [], excluded: ["other-refs", "lfs-object-bytes", "submodule-repositories"], capturedAt: new Date().toISOString(), providerVerified: false };
  const env = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null" };
  const run = async (command: string, byteLimit = 1024 * 1024): Promise<string> => {
    const sentinel = `FLAREGIT_INVENTORY_${crypto.randomUUID().replaceAll("-", "")}`;
    try { await executor.beforeCommand(); } catch (error) { throw new InventoryCallbackFailure(error); }
    const result = await executor.exec(`${command} && printf %s ${q(`\n${sentinel}\n`)}`, env);
    try { await executor.beforeCommand(); } catch (error) { throw new InventoryCallbackFailure(error); }
    if (!result.success || result.truncated || typeof result.stdout !== "string" || new TextEncoder().encode(result.stdout).length > byteLimit || !result.stdout.trimEnd().endsWith(`\n${sentinel}`)) throw new InventoryUnavailable();
    return result.stdout.trimEnd().slice(0, -sentinel.length).trim();
  };
  const git = (args: string, cap?: number) => run(`git --git-dir ${q(directory)} ${args}`, cap);
  const objects = new Set<string>(), externalGitlinks = new Set<string>();
  const add = (object: string) => { if (!sha.test(object) || /^0{40}$/.test(object)) throw new InventoryUnavailable(); objects.add(object); if (objects.size > maxObjects) throw new Error("object_capacity"); };
  try {
    if (await git("rev-parse --is-bare-repository") !== "true" || await git("rev-parse --is-shallow-repository") !== "false") throw new InventoryUnavailable();
    const output = await git(`for-each-ref --count=${maxRefs + 1} --format=${q("%(objectname)\t%(objecttype)\t%(refname)")} refs/heads/ refs/tags/`);
    const rows = output ? output.split("\n") : [];
    if (rows.length > maxRefs) { inventory.reason = "ref_capacity"; return inventory; }
    const commitTips: string[] = [], treeTips: string[] = [], seen = new Set<string>();
    for (const row of rows) {
      const [object, rawType, ref, extra] = row.split("\t");
      if (!object || !rawType || !ref || extra !== undefined || !sha.test(object) || !types.has(rawType) || !isSafeRef(ref) || (!ref.startsWith("refs/heads/") && !ref.startsWith("refs/tags/")) || seen.has(ref)) throw new InventoryUnavailable();
      seen.add(ref); add(object);
      const type = rawType as GitMigrationObjectType;
      if (ref.startsWith("refs/heads/") && type !== "commit") throw new InventoryUnavailable();
      let peeledObject = object, peeledType = type;
      for (let depth = 0; peeledType === "tag"; depth++) {
        if (depth >= 16) throw new InventoryUnavailable();
        const header = (await git(`cat-file -p ${q(peeledObject)}`, 65536)).split("\n")[0];
        const parent = /^object ([a-f0-9]{40})$/.exec(header ?? "")?.[1];
        if (!parent) throw new InventoryUnavailable(); add(parent); peeledObject = parent;
        const value = await git(`cat-file -t ${q(parent)}`);
        if (!types.has(value)) throw new InventoryUnavailable(); peeledType = value as GitMigrationObjectType;
      }
      inventory.refs.push({ ref, object, type, peeledObject, peeledType });
      if (peeledType === "commit") commitTips.push(peeledObject);
      else if (peeledType === "tree") treeTips.push(peeledObject);
    }
    if (commitTips.length) {
      const reachable = await git(`rev-list --objects --no-object-names ${[...new Set(commitTips)].map(q).join(" ")} --`);
      for (const object of reachable.split("\n").filter(Boolean)) add(object);
    }
    for (const tree of new Set(treeTips)) {
      const entries = await git(`ls-tree -r -t --format=${q("%(objectname)\t%(objecttype)")} ${q(tree)}`);
      for (const row of entries.split("\n").filter(Boolean)) {
        const [object, type, extra] = row.split("\t");
        if (!object || !sha.test(object) || extra !== undefined || !["blob", "tree", "commit"].includes(type ?? "")) throw new InventoryUnavailable();
        if (type === "commit") externalGitlinks.add(object); else add(object);
      }
    }
    const sorted = [...objects].sort();
    for (let index = 0; index < sorted.length; index += 256) {
      const batch = sorted.slice(index, index + 256), result = await run(`printf '%s\n' ${batch.map(q).join(" ")} | git --git-dir ${q(directory)} cat-file --batch-check=${q("%(objectname) %(objecttype)")}`);
      const lines = result.split("\n");
      if (lines.length !== batch.length) throw new InventoryUnavailable();
      for (let position = 0; position < lines.length; position++) {
        const [object, type, extra] = lines[position]!.split(" ");
        if (!object || object !== batch[position] || !type || !types.has(type) || extra !== undefined) throw new InventoryUnavailable();
        inventory.objects[object] = type as GitMigrationObjectType;
      }
    }
    await git("fsck --full --no-reflogs --no-dangling");
    inventory.refs.sort((first, second) => first.ref.localeCompare(second.ref)); inventory.observedExternalGitlinks = [...externalGitlinks].sort(); inventory.status = "complete";
  } catch (error) { if (error instanceof InventoryCallbackFailure) throw error.original; inventory.reason = error instanceof Error && error.message === "object_capacity" ? "object_capacity" : "metadata_unavailable"; }
  return inventory;
}
export interface GitMigrationComparison { status:"matched"|"different"|"incomplete"; scope:GitMigrationInventory["scope"]; missingRefs:string[]; differentRefs:string[]; missingObjects:string[]; differentObjects:string[]; additionalRefs:string[]; additionalObjects:number; comparisonScope:"source-ref-and-reachable-object-preservation"; excluded:GitMigrationInventory["excluded"]; providerVerified:false }
/** Complete here means these captured native heads/tags and their Git objects.
 * Destination additions are reported and never deleted. Missing objects means
 * absent from the captured reachable closure, not a probe of unreachable storage.
 * A selected branch, pointer blob, or readable head never proves whole-platform migration. */
export function compareGitMigrationInventories(source: GitMigrationInventory, destination: GitMigrationInventory): GitMigrationComparison {
  const result: GitMigrationComparison = { status: "incomplete", scope: source.scope, missingRefs: [], differentRefs: [], missingObjects: [], differentObjects: [], additionalRefs: [], additionalObjects: 0, comparisonScope: "source-ref-and-reachable-object-preservation", excluded: source.excluded, providerVerified: false };
  if (source.status !== "complete" || destination.status !== "complete" || source.scope !== destination.scope) return result;
  const copied = new Map(destination.refs.map(ref => [ref.ref, ref]));
  for (const original of source.refs) { const target = copied.get(original.ref); if (!target) result.missingRefs.push(original.ref); else if (target.object !== original.object || target.type !== original.type || target.peeledObject !== original.peeledObject || target.peeledType !== original.peeledType) result.differentRefs.push(original.ref); }
  for (const [object, type] of Object.entries(source.objects)) { if (!destination.objects[object]) result.missingObjects.push(object); else if (destination.objects[object] !== type) result.differentObjects.push(object); }
  const sourceRefs = new Set(source.refs.map(ref => ref.ref));
  result.additionalRefs = destination.refs.filter(ref => !sourceRefs.has(ref.ref)).map(ref => ref.ref);
  result.additionalObjects = Object.keys(destination.objects).filter(object => !source.objects[object]).length;
  result.status = result.missingRefs.length || result.differentRefs.length || result.missingObjects.length || result.differentObjects.length ? "different" : "matched";
  return result;
}
