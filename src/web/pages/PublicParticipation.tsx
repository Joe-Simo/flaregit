import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { navigate } from "../router";
import type { PublicCommunityData } from "../components/PublicCommunityPosts";
import type { ContributionRequest, PublicPost } from "@/server/public-community";
interface EditablePost extends PublicPost { canEdit: boolean; canRemove: boolean; version: number }
const field = "w-full border border-input rounded-md bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function PublicParticipation({ projectId }: { projectId: string }) {
  const [community, setCommunity] = useState<PublicCommunityData | null>(null);
  const [requests, setRequests] = useState<ContributionRequest[] | null>(null);
  const [editablePosts, setEditablePosts] = useState<EditablePost[] | null>(null);
  const [authorDisplayName, setAuthorDisplayName] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [removeConfirmed, setRemoveConfirmed] = useState<Record<string, number | null>>({});
  const [accessActive, setAccessActive] = useState<boolean | null>(null);
  const [scope, setScope] = useState<"discussions" | "issues">("discussions");
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [purpose, setPurpose] = useState("");
  const postDraft = useRef<{ payload: string; key: string } | null>(null);
  const requestDraft = useRef<{ payload: string; key: string } | null>(null);
  const generation = useRef(0);
  const mutating = useRef(false);
  const [loading, setLoading] = useState(false);
  const [errorOperation, setErrorOperation] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (mutating.current) return;
    const requestGeneration = ++generation.current;
    setLoading(true); setAccessActive(null);
    const [posts, mine, editable] = await Promise.allSettled([apiJson<PublicCommunityData>(`/public/${projectId}/community`), apiJson<{ requests: ContributionRequest[]; accessActive: boolean }>(`/public/${projectId}/community/requests`), apiJson<{ posts: EditablePost[]; authorDisplayName: string }>(`/public/${projectId}/community/posts`)]);
    if (requestGeneration !== generation.current) return;
    setLoading(false); setErrorOperation(null);
    if (editable.status === "fulfilled") { setEditablePosts(editable.value.posts); setAuthorDisplayName(editable.value.authorDisplayName); } else { setEditablePosts(null); setAuthorDisplayName(null); }
    if (posts.status === "fulfilled") setCommunity(posts.value); else setCommunity(null);
    if (mine.status === "fulfilled") { setRequests(mine.value.requests); setAccessActive(mine.value.accessActive); } else { setAccessActive(null); setRequests(null); }
    setError(posts.status === "rejected" || mine.status === "rejected" || editable.status === "rejected" ? "Some participation data is unavailable. Refresh before relying on current access." : null);
  }, [projectId]);
  useEffect(() => { setCommunity(null); setRequests(null); setAccessActive(null); postDraft.current = null; requestDraft.current = null; setTitle(""); setBody(""); setPurpose(""); setNotice(null); setBusy(null); setEditablePosts(null); setAuthorDisplayName(null); setEditing(null); setRemoveConfirmed({}); mutating.current = false; void load(); return () => { generation.current++; }; }, [load]);
  const act = async (operation: string, action: (requestGeneration: number) => Promise<void>) => {
    if (mutating.current) return false;
    const requestGeneration = ++generation.current; mutating.current = true;
    setLoading(false); setBusy(operation); setError(null); setErrorOperation(null); setNotice(null);
    try { await action(requestGeneration); return requestGeneration === generation.current; }
    catch (cause) { if (requestGeneration === generation.current) { setError(cause instanceof Error ? cause.message : "Request result is unknown. Refresh server state before continuing."); setErrorOperation(operation); } return false; }
    finally { if (requestGeneration === generation.current) { mutating.current = false; setBusy(null); } }
  };
  const postScopes = community?.policy.enabled ? community.policy.scopes.filter((value): value is "discussions" | "issues" => value === "discussions" || value === "issues") : [];
  const postScope = postScopes.includes(scope) ? scope : postScopes[0];
  return <div className="max-w-3xl mx-auto px-5 sm:px-8 py-8 space-y-6">
    <div className="flex flex-wrap gap-3 items-center justify-between"><h1 className="text-xl font-medium">Public participation</h1><Button size="sm" variant="outline" onClick={() => navigate(`/public/${projectId}?view=community`)}>Public repository</Button></div>
    <p className="text-sm text-muted-foreground">Posts here and your profile display name are public. The server supplies your author identity; existing posts keep their recorded attribution. Contribution requests are visible to you and the maintainer; repository access requires a separate decision.</p>
    {error && <div role="alert" className="text-sm text-destructive"><p>{error}</p><p className="mt-1 text-xs">{errorOperation === "post" || errorOperation === "request" ? "Unchanged draft retries reuse the same request key." : errorOperation?.startsWith("edit:") || errorOperation?.startsWith("remove:") ? "Refresh the post and review its current version before retrying. This action is not automatically resubmitted." : "Refresh to read the current server state."}</p></div>}{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <Button size="sm" variant="ghost" disabled={busy !== null || loading} onClick={() => void load()}>{loading ? "Refreshing access…" : "Refresh participation and access"}</Button>
    {accessActive === true && <Button size="sm" variant="outline" onClick={() => navigate(`/p/${projectId}`)}>Open contributor workspace</Button>}
    {!community && !error && <p role="status" className="text-sm text-muted-foreground">Loading public scopes…</p>}
    {community && !community.policy.enabled && <p className="text-sm text-muted-foreground">The maintainer has not enabled public participation.</p>}
    {postScope && <form className="space-y-3 border-t border-border pt-5" onSubmit={(event) => { event.preventDefault(); void act("post", async (requestGeneration) => {
      const payload = { scope: postScope, title: title.trim(), body: body.trim() }; const serialized = JSON.stringify(payload);
      if (postDraft.current?.payload !== serialized) postDraft.current = { payload: serialized, key: crypto.randomUUID() };
      const post = await apiJson<PublicPost>(`/public/${projectId}/community/posts`, { method: "POST", json: { ...payload, idempotencyKey: postDraft.current.key } });
      if (requestGeneration !== generation.current) return;
      setCommunity((previous) => previous ? { ...previous, posts: [post, ...previous.posts.filter((item) => item.id !== post.id)] } : previous); setTitle(""); setBody(""); postDraft.current = null; setNotice("Public post saved.");
    }).then((saved) => { if (saved) void load(); }); }}><h2 className="text-sm font-semibold">Publish a public post</h2><p className="text-xs text-muted-foreground">{authorDisplayName ? `Your posts publish the display name “${authorDisplayName}”.` : "Your profile display name is public on every post."}</p><label className="block text-sm">Scope<select className={field} disabled={busy !== null} value={postScope} onChange={(event) => setScope(event.target.value === "issues" ? "issues" : "discussions")}>{postScopes.map((value) => <option key={value} value={value}>{value === "issues" ? "Public issue" : "Discussion"}</option>)}</select></label><label className="block text-sm">Title<input className={field} required maxLength={200} disabled={busy !== null} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="block text-sm">Public content<textarea className={field} required rows={4} maxLength={8000} disabled={busy !== null} value={body} onChange={(event) => setBody(event.target.value)} /></label><Button type="submit" size="sm" variant="outline" disabled={busy !== null || !title.trim() || !body.trim()}>{busy === "post" ? "Saving…" : "Publish post"}</Button></form>}
    {community?.policy.enabled && community.policy.scopes.includes("contribution-requests") && accessActive === false && <form className="space-y-3 border-t border-border pt-5" onSubmit={(event) => { event.preventDefault(); void act("request", async (requestGeneration) => {
      const payload = { purpose: purpose.trim() }; const serialized = JSON.stringify(payload);
      if (requestDraft.current?.payload !== serialized) requestDraft.current = { payload: serialized, key: crypto.randomUUID() };
      const request = await apiJson<ContributionRequest>(`/public/${projectId}/community/requests`, { method: "POST", json: { ...payload, idempotencyKey: requestDraft.current.key } });
      if (requestGeneration !== generation.current) return;
      setRequests((previous) => [request, ...(previous ?? []).filter((item) => item.id !== request.id)]); setPurpose(""); requestDraft.current = null; setNotice("Contribution request saved. No repository access has been granted yet.");
    }); }}><h2 className="text-sm font-semibold">Request contribution access</h2><label className="block text-sm">What would you contribute?<textarea className={field} rows={3} minLength={10} maxLength={2000} required disabled={busy !== null} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label><Button type="submit" size="sm" variant="outline" disabled={busy !== null || purpose.trim().length < 10}>{busy === "request" ? "Saving…" : "Send contribution request"}</Button></form>}
    {requests && <section className="border-t border-border pt-5"><h2 className="text-sm font-semibold">Contribution request history</h2><ul className="divide-y divide-border">{requests.map((request) => <li key={request.id} className="py-3 text-sm"><p className="font-medium">{request.requesterName} · {request.status}</p><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{request.purpose}</p>{request.status === "approved" && request.registrationStatus === "pending" && accessActive !== true && <p className="mt-2 text-xs text-muted-foreground">Approval is saved; contributor registration is pending. Refresh access after registration completes.</p>}{request.status === "approved" && request.registrationStatus === "revoked" && <p className="mt-2 text-xs text-muted-foreground">The prior access grant was revoked. Approval history does not restore it.</p>}{request.status === "approved" && request.registrationStatus !== "pending" && accessActive !== true && <p className="mt-2 text-xs text-muted-foreground">Approval is recorded, but current repository access is {accessActive === null ? "unknown" : "not active"}. Refresh access to check the present permission.</p>}</li>)}{requests.length === 0 && <li className="py-3 text-sm text-muted-foreground">No contribution requests.</li>}</ul></section>}
    {community?.policy.enabled && <section className="border-t border-border pt-5"><h2 className="text-sm font-semibold">Public posts</h2><ul className="divide-y divide-border">{(editablePosts ?? community.posts).map((post) => {
      const permissions = editablePosts?.find((item) => item.id === post.id);
      const staleEdit = editing === post.id && editVersion !== permissions?.version;
      return <li key={post.id} className="py-3 space-y-2"><h3 className="text-sm font-medium break-words">{post.title}</h3><p className="text-xs text-muted-foreground">{post.author} · {post.scope}</p><p className="text-sm whitespace-pre-wrap break-words">{post.body}</p>
        {editing === post.id && permissions?.canEdit && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void act(`edit:${post.id}`, async (requestGeneration) => {
          const saved = await apiJson<PublicPost>(`/public/${projectId}/community/posts/${post.id}`, { method: "PATCH", json: { title: editTitle.trim(), body: editBody.trim(), expectedVersion: editVersion } });
          if (requestGeneration !== generation.current) return;
          setCommunity((previous) => previous ? { ...previous, posts: previous.posts.map((item) => item.id === saved.id ? saved : item) } : previous); setEditablePosts((previous) => previous?.map((item) => item.id === saved.id ? { ...item, ...saved } : item) ?? null); setEditing(null); setNotice("Public post updated. Original attribution is preserved.");
        }); }}><label className="block text-sm">Public title<input className={field} required maxLength={200} value={editTitle} disabled={busy !== null} onChange={(event) => setEditTitle(event.target.value)} /></label><label className="block text-sm">Public content<textarea className={field} rows={4} required maxLength={8000} value={editBody} disabled={busy !== null} onChange={(event) => setEditBody(event.target.value)} /></label>{staleEdit && <p role="alert" className="text-xs text-destructive">This post changed while you were editing. Your draft is preserved. Compare the latest post above, then cancel and reopen the editor before saving.</p>}<div className="flex gap-2"><Button type="submit" size="sm" variant="outline" disabled={busy !== null || loading || staleEdit || !editTitle.trim() || !editBody.trim()}>{busy === `edit:${post.id}` ? "Saving…" : "Save public edit"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel edit</Button></div></form>}
        <div className="flex flex-wrap gap-2 items-center">{permissions?.canEdit && editing !== post.id && <Button size="sm" variant="ghost" disabled={busy !== null || loading} aria-label={`Edit public post ${post.title}`} onClick={() => { setEditing(post.id); setEditVersion(permissions.version); setEditTitle(post.title); setEditBody(post.body); }}>Edit post</Button>}{permissions?.canRemove && <><label className="flex gap-2 items-center text-xs"><input type="checkbox" disabled={busy !== null} checked={removeConfirmed[post.id] === permissions.version} onChange={(event) => setRemoveConfirmed({ ...removeConfirmed, [post.id]: event.target.checked ? permissions.version : null })} />Confirm removal from public community</label><Button size="sm" variant="outline" disabled={busy !== null || loading || removeConfirmed[post.id] !== permissions.version} aria-label={`Remove public post ${post.title}`} onClick={() => void act(`remove:${post.id}`, async (requestGeneration) => {
          await apiJson<{ removed: true }>(`/public/${projectId}/community/posts/${post.id}`, { method: "DELETE", json: { expectedVersion: permissions.version } });
          if (requestGeneration !== generation.current) return;
          setCommunity((previous) => previous ? { ...previous, posts: previous.posts.filter((item) => item.id !== post.id) } : previous); setEditablePosts((previous) => previous?.filter((item) => item.id !== post.id) ?? null); setEditing((previous) => previous === post.id ? null : previous); setNotice("Post removed. Retrying the original publish request cannot restore this record.");
        })}>{busy === `remove:${post.id}` ? "Removing…" : "Remove post"}</Button></>}</div>
      </li>;
    })}</ul></section>}
  </div>;
}
