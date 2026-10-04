/** Parse an ID or a trusted FlareGit route without fetching the pasted URL. */
export function storageRepositoryId(input: string, currentOrigin: string): string | null {
  const value = input.trim();
  if (/^[a-z0-9]{12,16}$/.test(value)) return value;
  if (!value || value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value, currentOrigin); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (url.origin !== currentOrigin && url.origin !== 'https://flaregit.com' && url.origin !== 'https://www.flaregit.com') return null;
  const route = url.hash ? url.hash.slice(1) : url.pathname;
  const match = /^\/p\/([a-z0-9]{12,16})(?:\/[a-z-]+)?\/?(?:\?.*)?$/.exec(route);
  return match?.[1] ?? null;
}
