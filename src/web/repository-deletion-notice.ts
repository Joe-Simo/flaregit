/** Only explicit server lifecycle responses can expose owner recovery controls. */
export function repositoryDeletionNotice(message: string): { detail: string; canInspectStorage: boolean } | null {
  if (message.length > 4096) return null;
  let value: unknown;
  try { value = JSON.parse(message); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('status' in value) || value.status !== 'deleting' || !('detail' in value) || typeof value.detail !== 'string' || !value.detail.trim() || value.detail.length > 2000) return null;
  return { detail: value.detail, canInspectStorage: 'canInspectStorage' in value && value.canInspectStorage === true };
}
