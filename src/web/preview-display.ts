export interface AvailablePreview { ready: true; url: string; expiresAt?: string; generationId?: string }

/** Polling metadata must not reload a still-valid application and discard its UI state. */
export function preservePreviewLink<T extends AvailablePreview>(previous: AvailablePreview | null, next: T, forceRefresh: boolean, now = Date.now()): T {
  if (!previous || forceRefresh || previous.generationId !== next.generationId) return next;
  const expires = Date.parse(previous.expiresAt ?? "");
  if (!Number.isFinite(expires) || expires <= now + 30_000) return next;
  try { if (new URL(previous.url).origin !== new URL(next.url).origin) return next; }
  catch { return next; }
  return { ...next, url: previous.url, expiresAt: previous.expiresAt };
}
