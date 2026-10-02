import type { ArtifactsBinding } from "../artifacts/cloudflare.js";
import type { CommandPolicy } from "../core/command-policy.js";
import { validateImportSource } from "./import-source.js";

export interface ImportJob {
  id: string; ownerId: string; name: string; canonicalRepoName: string; source: string; branch: string;
  verificationPolicy: CommandPolicy; status: "requested" | "pending" | "ready" | "failed";
  historyIntent: "provider-default-no-depth-requested";
  createdAt: string; updatedAt: string; detail: string;
}
interface ImportReader {
  info(): Promise<{ defaultBranch: string; remote: string }>;
  log(options: { limit: number }): Promise<Array<{ hash: string }>>;
  [Symbol.dispose](): void;
}
interface ImportInspector { get(name: string): Promise<ImportReader> }
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Provider response timed out")), 5000); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
export type ImportReadiness = { status: "failed"; detail: string } | { status: "pending"; detail: string } | { status: "ready"; head: string; defaultBranch: string; remote: string };
/** One bounded provider lookup per resume. No deletion or second import request.
 * Artifacts documents IMPORT_IN_PROGRESS; other ambiguous errors also preserve
 * the job and canonical name for inspection rather than assuming work was lost.
 */
export async function inspectImport(binding: ImportInspector, name: string): Promise<ImportReadiness> {
  try {
    return await bounded((async (): Promise<ImportReadiness> => {
    using repository = await binding.get(name);
    const [info, commits] = await Promise.all([repository.info(), repository.log({ limit: 1 })]);
    const head = commits[0]?.hash;
    if (!head) return { status: "pending", detail: "The imported repository has no readable commit yet; retry this saved import" };
    if (!/^[0-9a-f]{40}$/.test(head)) return { status: "pending", detail: "The imported commit could not be verified; retry this saved import" };
    return { status: "ready", head, defaultBranch: info.defaultBranch, remote: info.remote };
    })());
  } catch (error) {
    const importing = typeof error === "object" && error !== null && "code" in error && error.code === "IMPORT_IN_PROGRESS";
    return { status: "pending", detail: importing ? "Artifacts is still importing this repository; retry this saved import" : "Import readiness is unavailable; the saved import and repository have been preserved" };
  }
}
export async function startImport(binding: ImportInspector & Pick<ArtifactsBinding, "import">, job: ImportJob): Promise<ImportReadiness> {
  const source = validateImportSource(job.source);
  try {
    // Optional depth is documented as shallow-clone depth. We impose no shallow
    // limit; provider defaults and selected-branch scope are not full-history proof.
    await bounded(binding.import({ source: { url: source.toString(), ...(job.branch ? { branch: job.branch } : {}) }, target: { name: job.canonicalRepoName, opts: { description: `Imported from ${source.host}${source.pathname}` } } }));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (["INVALID_INPUT", "INVALID_REPO_NAME", "INVALID_URL", "REMOTE_AUTH_REQUIRED"].includes(String(code))) return { status: "failed", detail: code === "REMOTE_AUTH_REQUIRED" ? "The source requires authentication; only public HTTPS sources are supported. The import record is preserved." : "Artifacts refused this import request. The import record is preserved; inspect the source before creating a corrected request." };
    return { status: "pending", detail: "Import request outcome is uncertain; retry this saved import to inspect its repository without creating another import" };
  }
  return inspectImport(binding, job.canonicalRepoName);
}
