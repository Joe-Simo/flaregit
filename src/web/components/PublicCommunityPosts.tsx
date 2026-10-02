import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { timeAgo } from "../router";
import type { PublicPost, PublicCommunityPolicy } from "@/server/public-community";
export interface PublicCommunityData { policy: PublicCommunityPolicy; posts: PublicPost[] }
export function PublicCommunityPosts({ projectId }: { projectId: string }) {
  const [data, setData] = useState<PublicCommunityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; const controller = new AbortController(); setData(null); setError(null);
    void fetch(`/api/public/${projectId}/community`, { credentials: "omit", cache: "no-store", signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error("Public community is unavailable. Source browsing remains independent."); return response.json() as Promise<PublicCommunityData>; }).then((value) => { if (active) setData(value); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load public community"); });
    return () => { active = false; controller.abort(); };
  }, [projectId, revision]);
  return <section aria-label="Public community" className="space-y-4">
    {error && <div role="alert" className="text-sm text-destructive"><p>{error}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => setRevision((value) => value + 1)}>Retry community</Button></div>}
    {!data && !error && <p role="status" className="text-sm text-muted-foreground">Loading public community…</p>}
    {data && !data.policy.enabled && <p className="text-sm text-muted-foreground">Public participation is not enabled for this repository.</p>}
    {data?.policy.enabled && <><p className="text-xs text-muted-foreground">Public posts are separate from private repository conversations.</p><ul className="divide-y divide-border">{data.posts.map((post) => <li key={post.id} className="py-4"><h2 className="text-sm font-medium break-words">{post.title}</h2><p className="mt-1 text-xs text-muted-foreground">{post.scope === "issues" ? "Public issue" : "Discussion"} · {post.author} · {timeAgo(post.createdAt)}</p><p className="mt-3 text-sm whitespace-pre-wrap break-words">{post.body}</p></li>)}{data.posts.length === 0 && <li className="py-3 text-sm text-muted-foreground">No public posts yet.</li>}</ul><a href={`/#/participate/${projectId}`} className="inline-block text-sm underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Sign in to participate</a></>}
  </section>;
}
