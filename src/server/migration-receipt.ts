/** Inventories must be captured from real Git/provider reads. This comparison performs no import or writes. */
export interface GitHistoryInventory {
  refs: Record<string, string>;
  commits: Record<string, { tree: string; parents: string[] }>;
  shallow: boolean;
  capturedAt: string;
}
export interface MigrationReceipt {
  status: "verified" | "incomplete" | "mismatch";
  scope: "selected-ref-reachable-commit-history";
  refs: string[];
  sourceCapturedAt: string;
  destinationCapturedAt: string;
  commitsCompared: number;
  missingCommits: string[];
  differentCommits: string[];
  differentRefs: string[];
  detail: string;
}
const HASH = /^[a-f0-9]{40}$/;
const REF = /^refs\/(heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
function safeRef(ref: string) { return REF.test(ref) && !ref.includes("..") && !ref.includes("//") && !ref.endsWith("/") && !ref.endsWith(".lock"); }
/** Annotated tag object identity and non-commit tag targets are deliberately outside this receipt.
 * A captured source may change later; verified means equality at these snapshots only.
 */
export function compareMigrationHistory(source: GitHistoryInventory, destination: GitHistoryInventory, selectedRefs: string[]): MigrationReceipt {
  if (!selectedRefs.length || selectedRefs.length > 100 || new Set(selectedRefs).size !== selectedRefs.length || selectedRefs.some((ref) => !safeRef(ref))) throw new Error("Explicit unique branch or peeled tag refs required");
  if (!Number.isFinite(Date.parse(source.capturedAt)) || !Number.isFinite(Date.parse(destination.capturedAt))) throw new Error("Capture timestamps required");
  const refs = [...selectedRefs].sort();
  const receipt: MigrationReceipt = { status: "incomplete", scope: "selected-ref-reachable-commit-history", refs, sourceCapturedAt: source.capturedAt, destinationCapturedAt: destination.capturedAt, commitsCompared: 0, missingCommits: [], differentCommits: [], differentRefs: [], detail: "" };
  let incomplete = source.shallow || destination.shallow;
  const queue: string[] = [];
  for (const ref of refs) {
    const sourceTip = source.refs[ref];
    if (!sourceTip || !HASH.test(sourceTip)) { incomplete = true; continue; }
    if (sourceTip !== destination.refs[ref]) receipt.differentRefs.push(ref);
    queue.push(sourceTip);
  }
  const visited = new Set<string>();
  while (queue.length) {
    const hash = queue.pop()!;
    if (visited.has(hash)) continue;
    visited.add(hash);
    if (visited.size > 100_000) { incomplete = true; break; }
    const original = source.commits[hash];
    if (!original || !HASH.test(original.tree) || original.parents.some((parent) => !HASH.test(parent))) { incomplete = true; continue; }
    queue.push(...original.parents);
    const copied = destination.commits[hash];
    if (!copied) { receipt.missingCommits.push(hash); continue; }
    if (copied.tree !== original.tree || JSON.stringify(copied.parents) !== JSON.stringify(original.parents)) receipt.differentCommits.push(hash);
    else receipt.commitsCompared++;
  }
  receipt.missingCommits.sort(); receipt.differentCommits.sort();
  receipt.status = receipt.differentRefs.length || receipt.missingCommits.length || receipt.differentCommits.length ? "mismatch" : incomplete ? "incomplete" : "verified";
  receipt.detail = receipt.status === "verified" ? "Selected refs and every inventoried reachable commit agree at the captured snapshots. Blob transfer, annotated tag objects and unselected refs are not verified." : receipt.status === "mismatch" ? "Selected refs or reachable commit history differ; do not report this migration as verified." : "A shallow or incomplete inventory prevents complete selected-ref history verification.";
  return receipt;
}
