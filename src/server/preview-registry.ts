import type { Env } from "./env.js";
import { globalOf } from "./projects.js";

/** Durable reservations override legacy config, including terminal retirement. */
export async function resolveRepositoryPreviewOrigin(env: Env, repository: string, appOrigin?: string): Promise<string | null> {
  try {
    const registration = await globalOf(env).previewOrigin(repository, appOrigin);
    return registration?.status === "active" ? registration.origin : null;
  } catch {
    return null;
  }
}
