import type {InboxRow} from './durable-object';

/** Stored notifications are private history, not continuing authority to read a repository. */
export async function projectInbox(
  rows: readonly InboxRow[],
  filter: 'direct' | 'activity' | 'snoozed' | 'archived',
  canRead: (projectId: string) => Promise<boolean>,
  beforeRelease: () => Promise<void> = async () => {},
  sourceEvent: (row: InboxRow) => Promise<InboxRow | null> = async () => null,
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
  const visible: InboxRow[] = [];
  const sourceRows = new Map<InboxRow,InboxRow>();
  for (const row of rows) {
    // Public discussion authority applies only to this exact source event, never
    // to private notifications from the same repository. Legacy rows stay private.
    if (/^discussion\.reply\.public\.discussion_[a-f0-9-]{36}\.discussion_[a-f0-9-]{36}$/.test(row.type) || (row.type.startsWith('thread.comment.')||row.type.startsWith('thread.mention.'))) {
      try {
        if (await sourceEvent(row)) {
          const current = await sourceEvent(row);
          if (current) { visible.push(current); sourceRows.set(current,row); }
        }
      } catch { /* Unconfirmed source events are withheld. */ }
    } else if (permitted.has(row.project_id)) visible.push(row);
  }
  // Public lookups can be slow; revalidate member history after those awaits too.
  await Promise.all([...permitted].map(async id => {
    try { if (!await canRead(id)) permitted.delete(id); } catch { permitted.delete(id); }
  }));
  await beforeRelease();
  // Later source lookups may withdraw an earlier event. Release the latest
  // projection, never a cached source check or historical notification prose.
  const latest=await Promise.all(visible.map(async row=>{
    try{
      const source=sourceRows.get(row);
      if(source)return await sourceEvent(source);
      return permitted.has(row.project_id)&&await canRead(row.project_id)?row:null;
    }catch{return null;}
  }));
  await beforeRelease();
  const released=latest.filter(row=>row!==null);
  const byState = filter === 'snoozed' || filter === 'archived';
  return {
    items: released.filter(row => byState ? row.state === filter : row.state === 'unread' && row.kind === filter).slice(0, 100),
    unread: {
      direct: released.filter(row => row.state === 'unread' && row.kind === 'direct').length,
      activity: released.filter(row => row.state === 'unread' && row.kind === 'activity').length,
    },
  };
}
