import type { Env } from "./env.js";
import { globalOf } from "./projects.js";

export type PreviewOriginLookup = { status: "active"; origin: string } | { status: "unregistered" | "unavailable" };

/** Never cache positive assignments: retirement must affect the next asset read. */
export async function lookupRepositoryPreviewOrigin(env: Env, repository: string, appOrigin?: string): Promise<PreviewOriginLookup> {
  try {
    const origin = await globalOf(env).activePreviewOrigin(repository, appOrigin);
    return origin ? { status: "active", origin } : { status: "unregistered" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function resolveRepositoryPreviewOrigin(env: Env, repository: string, appOrigin?: string): Promise<string | null> {
  const result = await lookupRepositoryPreviewOrigin(env, repository, appOrigin);
  return result.status === "active" ? result.origin : null;
}
