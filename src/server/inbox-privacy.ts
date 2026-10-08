import type {InboxRow} from './durable-object';

/** Stored notifications are private history, not continuing authority to read a repository. */
export async function projectInbox(
  rows: readonly InboxRow[],
  filter: 'direct' | 'activity' | 'snoozed' | 'archived',
  canRead: (projectId: string) => Promise<boolean>,
  beforeRelease: () => Promise<void> = async () => {},
) {
  const projects = [...new Set(rows.map(row => row.project_id))];
  const permitted = new Set<string>();
  await Promise.all(projects.map(async id => {
    try { if (await canRead(id)) permitted.add(id); } catch { /* Unconfirmed authority never releases stored titles. */ }
  }));
  await beforeRelease();
  // A slow lookup must not preserve an earlier permission after revocation.
  await Promise.all([...permitted].map(async id => {
    try { if (!await canRead(id)) permitted.delete(id); } catch { permitted.delete(id); }
  }));
  const visible = rows.filter(row => permitted.has(row.project_id));
  const byState = filter === 'snoozed' || filter === 'archived';
  return {
    items: visible.filter(row => byState ? row.state === filter : row.state === 'unread' && row.kind === filter).slice(0, 100),
    unread: {
      direct: visible.filter(row => row.state === 'unread' && row.kind === 'direct').length,
      activity: visible.filter(row => row.state === 'unread' && row.kind === 'activity').length,
    },
  };
}
