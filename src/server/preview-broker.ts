import { lookupRepositoryPreviewOrigin } from "./preview-registry.js";
import type { Env } from "./env.js";
import { buildPrefix, generationBuildPrefix, verifyPreview, verifyPreviewGeneration } from "./preview-access.js";
import { projectOf } from "./projects.js";

const securityHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const failure = (status: number) => new Response(status === 503 ? "Preview service temporarily unavailable. Try again shortly." : status === 403 ? "Preview unavailable or expired" : "Not found", { status, headers: securityHeaders });

/** Bound service entrypoint: identity and audience must match the operator's origin map. */
export async function handlePreviewAsset(request: Request, env: Env, repositoryId: string): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { ...securityHeaders, Allow: "GET, HEAD" } });
  }
  const generationMatch = /^\/preview-v3\/([0-9a-f]{40})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9]+)\/([0-9a-f]{64})\/(.*)$/.exec(url.pathname);
  const legacyMatch = /^\/preview\/([0-9a-f]{40})\/([0-9]+)\/([0-9a-f]{64})\/(.*)$/.exec(url.pathname);
  if (!generationMatch && !legacyMatch) return failure(404);
  const commit = (generationMatch ?? legacyMatch)![1]!;
  const incarnation = generationMatch?.[2];
  const generation = generationMatch?.[3];
  const expiry = generationMatch ? generationMatch[4]! : legacyMatch![2]!;
  const signature = generationMatch ? generationMatch[5]! : legacyMatch![3]!;
  const rawAsset = generationMatch ? generationMatch[6]! : legacyMatch![4]!;
  let asset: string;
  try { asset = decodeURIComponent(rawAsset!); } catch { return failure(404); }
  // Reject ambiguous separators, traversal, control bytes and repeated decoding before touching R2.
  if (/[\\%\u0000-\u001f\u007f]/.test(asset) || asset.startsWith("/") || asset.split("/").some((part) => part === "." || part === ".." || part === "" && asset !== "")) return failure(404);
  if (!env.PREVIEW_SIGNING_KEY) return failure(503);
  if (!(generationMatch ? await verifyPreviewGeneration(env, repositoryId, commit, incarnation!, generation!, url.origin, Number(expiry), signature) : await verifyPreview(env, repositoryId, commit, url.origin, Number(expiry), signature))) return failure(403);
  const registration = await lookupRepositoryPreviewOrigin(env, repositoryId);
  if (registration.status === "unavailable") return failure(503);
  if (registration.status !== "active" || registration.origin !== url.origin) return failure(404);
  const repository = projectOf(env, repositoryId);
  const available = () => generationMatch ? repository.previewGenerationForRead(commit, incarnation!, generation!) : Promise.all([repository.previewAvailable(), repository.previewLegacyGenerationAllowed(commit)]).then(([active, legacyAllowed]) => active && legacyAllowed);
  try { if (!await available()) return failure(404); }
  catch { return failure(503); }
  let object: R2ObjectBody | null;
  try { object = await env.EVIDENCE_BUCKET.get(`${generationMatch ? generationBuildPrefix(repositoryId, commit, incarnation!, generation!) : buildPrefix(repositoryId, commit)}/${asset || "index.html"}`); }
  catch { return failure(503); }
  if (!object) return failure(404);
  const discard = async () => { try { await object.body.cancel?.(); } catch { /* No private response is returned even if storage cancellation fails. */ } };
  let generationBody: ArrayBuffer | null = null;
  if (generationMatch && request.method !== "HEAD") {
    try { generationBody = await object.arrayBuffer(); }
    catch { await discard(); return failure(503); }
  }
  try { if (!await available()) { await discard(); return failure(404); } }
  catch { await discard(); return failure(503); }
  const allowedParents = (env.CLERK_AUTHORIZED_PARTIES ?? "").split(",").map((origin) => origin.trim()).filter((origin) => {
    try { const parsed = new URL(origin); return parsed.origin === origin && parsed.protocol === "https:"; } catch { return false; }
  });
  const headers = new Headers({
    ...securityHeaders,
    "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
    "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors " + (allowedParents.join(" ") || "'none'"),
  });
  return new Response(request.method === "HEAD" ? null : generationBody ?? object.body, { headers });
}
