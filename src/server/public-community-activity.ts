import type { DirectoryRegistration, DirectoryState } from "./public-directory.js";
import type { DiscussionTopic } from "./repository-discussions.js";
import { safeSearchText } from "./metadata-search.js";

interface ActivityRepository {
  directoryState(): Promise<DirectoryState>;
  publicGrant(): Promise<{ name: string; version: number; acceptedCommit: string } | null>;
  publicDiscussionActivity(query: string, ids?: string[]): Promise<DiscussionTopic[]>;
  publicDiscussionActivitySnapshot(ids: string[]): Promise<{directory:DirectoryState;grant:{name:string;version:number;acceptedCommit:string}|null;topics:DiscussionTopic[]}>;
}
export interface PublicCommunityActivity {
  kind: "discussion";
  repository: { id: string; name: string; href: string; acceptedCommit: string };
  discussion: Pick<DiscussionTopic, "id" | "title" | "body" | "author" | "version" | "createdAt" | "updatedAt" | "category" | "replyCount" | "locked" | "resolved">;
  href: string;
}
const projectTopic = (topic: DiscussionTopic): PublicCommunityActivity["discussion"] => ({
  id: topic.id, title: topic.title, body: topic.body, author: topic.author, version: topic.version,
  createdAt: topic.createdAt, updatedAt: topic.updatedAt, category: topic.category,
  replyCount: topic.replyCount, locked: topic.locked, resolved: topic.resolved,
});

/** A bounded projection of already explicitly public content, never member activity. */
export async function projectPublicCommunityActivity(input: { rows: DirectoryRegistration[]; query: string; repository(id: string): ActivityRepository }) {
  const pending: Array<{ item: PublicCommunityActivity; directoryVersion: number; publicationVersion: number }> = [];
  let incomplete = false;
  const query = input.query.normalize("NFKC").toLocaleLowerCase("en-US").trim();
  for (const row of input.rows.slice(0, 20)) {
    if (!row.enabled) continue;
    try {
      const repository = input.repository(row.projectId);
      const [directory, grant] = await Promise.all([repository.directoryState(), repository.publicGrant()]);
      if (!directory.enabled || directory.version !== row.version || !grant) continue;
      const name = safeSearchText(grant.name, 160);
      const topics = await repository.publicDiscussionActivity(name.normalize("NFKC").toLocaleLowerCase("en-US").includes(query) ? "" : query);
      for (const topic of topics.filter(topic => !topic.removed).slice(0, 3)) {
        pending.push({ directoryVersion: directory.version, publicationVersion: grant.version, item: {
          kind: "discussion", repository: { id: row.projectId, name, href: `/#/public/${row.projectId}`, acceptedCommit: grant.acceptedCommit },
          discussion: projectTopic(topic), href: `/community#repo=${row.projectId}&topic=${topic.id}`,
        } });
      }
    } catch { incomplete = true; }
  }
  const items: PublicCommunityActivity[] = [];
  // Re-read each repository once after all initial reads: moderation, scope removal,
  // edited content, withdrawn listing and changed publication all fail closed.
  for (const id of new Set(pending.map(value => value.item.repository.id))) {
    try {
      const repository = input.repository(id);
      const {topics,directory,grant} = await repository.publicDiscussionActivitySnapshot(pending.filter(value => value.item.repository.id === id).map(value => value.item.discussion.id));
      for (const value of pending.filter(value => value.item.repository.id === id)) {
        const topic = topics.find(topic => topic.id === value.item.discussion.id && !topic.removed);
        if (!directory.enabled || directory.version !== value.directoryVersion || !grant || grant.version !== value.publicationVersion || grant.acceptedCommit !== value.item.repository.acceptedCommit || safeSearchText(grant.name, 160) !== value.item.repository.name || !topic || JSON.stringify(projectTopic(topic)) !== JSON.stringify(value.item.discussion)) { incomplete = true; continue; }
        items.push(value.item);
      }
    } catch { incomplete = true; }
  }
  items.sort((a, b) => b.discussion.updatedAt.localeCompare(a.discussion.updatedAt) || a.href.localeCompare(b.href));
  return { items, incomplete, checked: Math.min(input.rows.length, 20), scope: "Up to 3 public discussions from each of 20 listed repositories on this page; not a global activity history" };
}
