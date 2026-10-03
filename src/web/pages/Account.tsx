import { StorageReconciliation } from "../components/StorageReconciliation";
import React, { useCallback, useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";

interface Token { id: string; label: string; created_at: string; last_used: string | null; scope: string; repo: string | null; expires_at: number | null }
interface Billing { plan: "free" | "pro"; runsToday: number; runsPerDay: number }
interface Profile { handle: string; displayName: string; bio: string; visibility: "private" | "public"; version: number; moderation?: { suppressed: boolean; reason: string; reportId: string; version: number } }
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";
const okCls = "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className={`${alertCls} flex flex-wrap items-center justify-between gap-2`}>
      <span>{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function Account() {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [visibilityUnknown, setVisibilityUnknown] = useState(false);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [visibilityNotice, setVisibilityNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedProfile, setSavedProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSave, setProfileSave] = useState<{ ok: boolean; text: string } | null>(null);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const [deletionStarted, setDeletionStarted] = useState(false);
  const [serverDeleted, setServerDeleted] = useState(false);
  const [deletionNotice, setDeletionNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { user } = useUser();
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = sessionStorage.getItem(`flaregit.account-deletion.${user.id}`);
      if (saved === "pending" || saved === "server-deleted") {
        setDeletionStarted(true); setServerDeleted(saved === "server-deleted"); setConfirm("delete my account");
        setDeletionNotice(saved === "server-deleted" ? "Repository deletion was confirmed. Sign-in deletion still needs to finish." : "A previous deletion request has an unresolved outcome. Retry to continue the same request.");
      }
    } catch { /* Server retry is authoritative even when browser persistence is unavailable. */ }
  }, [user?.id]);
  const retainDeletion = (state: "pending" | "server-deleted") => {
    if (!user?.id) return;
    try { sessionStorage.setItem(`flaregit.account-deletion.${user.id}`, state); }
    catch { setDeletionNotice("This browser could not retain deletion progress across reloads. The server preserves the deletion operation; keep this page open to retry."); }
  };

  const loadTokens = useCallback(async () => {
    setTokensError(null);
    try { setTokens(await apiJson<Token[]>("/tokens")); } catch (e) { setTokensError(errText(e, "Could not load tokens")); }
  }, []);
  const loadBilling = useCallback(async () => {
    setBillingError(null);
    try { setBilling(await apiJson<Billing>("/billing")); } catch (e) { setBillingError(errText(e, "Could not load your plan")); }
  }, []);
  const loadProfile = useCallback(async () => {
    setProfileError(null);
    try {
      const p = await apiJson<Profile>("/profile");
      setProfile(p); setSavedProfile(p); setVisibilityUnknown(false); setVisibilityNotice(null);
      setPublishConfirmed(false);
    } catch (e) { setProfileError(errText(e, "Could not load your profile")); }
  }, []);
  useEffect(() => {
    void loadTokens();
    void loadBilling();
    void loadProfile();
  }, [loadTokens, loadBilling, loadProfile]);

  const saveProfile = async () => {
    if (!profile) return;
    setBusy("profile");
    setProfileSave(null);
    try {
      await apiJson("/profile", { method: "PUT", json: { handle: profile.handle, displayName: profile.displayName, bio: profile.bio, expectedVersion: savedProfile?.version } });
      setProfileSave({ ok: true, text: "Profile saved." });
      await loadProfile();
    } catch (e) {
      setProfileSave({ ok: false, text: `${errText(e, "Profile save response unavailable")}. The saved state is not confirmed. Your draft is retained; reload the saved profile to inspect its current state.` });
    } finally {
      setBusy(null);
    }
  };

  const tokenAction = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setTokenError(null);
    setTokenNotice(null);
    try {
      setTokenNotice(await fn());
      await loadTokens();
    } catch (e) {
      setTokenError(errText(e, "Something went wrong"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4 min-w-0">
      <h1 className="text-xl font-bold">Account</h1>
      {deletionStarted && <p role="status" className="rounded-md border border-border p-3 text-sm">Account deletion has started or its outcome is uncertain. The account details below are retained from before this request and may be stale. Continue deletion below; other account changes are disabled.</p>}
      <fieldset disabled={deletionStarted} className="space-y-4 min-w-0">
      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">How you appear on changes, reviews, issues and comments.</p>
          {profileError && <LoadError message={profileError} onRetry={() => void loadProfile()} />}
          {!profile && !profileError && <p role="status" className="text-sm text-muted-foreground">Loading profile…</p>}
          {profile && (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void saveProfile(); }}>
              {profile.visibility === "public" && !profile.moderation?.suppressed && <p className="text-xs text-muted-foreground">This profile is public. Saving changes updates the public name, handle and biography.</p>}
              <label className="block text-xs text-muted-foreground">Handle<input className={field} disabled={busy !== null || visibilityUnknown} value={profile.handle} maxLength={39} onChange={(e) => setProfile({ ...profile, handle: e.target.value })} placeholder="ada" /></label>
              <label className="block text-xs text-muted-foreground">Display name<input className={field} disabled={busy !== null || visibilityUnknown} value={profile.displayName} maxLength={60} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} placeholder="Ada Lovelace" /></label>
              <label className="block text-xs text-muted-foreground">Bio<textarea className={field} disabled={busy !== null || visibilityUnknown} rows={2} value={profile.bio} maxLength={300} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} /></label>
              {profileSave && (profileSave.ok
                ? <div role="status" className={okCls}>{profileSave.text}</div>
                : <div role="alert" className={alertCls}>{profileSave.text}</div>)}
              <div className="flex flex-wrap gap-2"><Button type="submit" variant="orange" disabled={busy !== null || visibilityUnknown}>{busy === "profile" ? "Saving…" : "Save profile"}</Button><Button type="button" variant="outline" disabled={busy !== null} onClick={() => void loadProfile()}>Reload saved profile (discard draft)</Button></div>
            </form>
          )}
          {profile && <div className="space-y-3 border-t border-border pt-4 mt-4">
            <h2 className="text-sm font-medium">Public profile</h2>
            {profile.moderation?.suppressed && <div role="status" className="rounded-md border border-border p-3 space-y-2 text-sm"><p className="font-medium">Public profile unavailable</p><p className="whitespace-pre-wrap break-words">{profile.moderation.reason}</p><p className="text-xs text-muted-foreground break-all">Report {profile.moderation.reportId}</p><p className="text-xs text-muted-foreground">You can still edit your profile and use your private repositories.</p><a className="inline-block underline underline-offset-4" href={`/#/report?signin=1${savedProfile?.handle ? `&target=${encodeURIComponent(`/#/profile/${savedProfile.handle}`)}` : ""}`}>Appeal this decision</a></div>}
            <p className="text-xs leading-6 text-muted-foreground">Publication setting: {profile.visibility === "public" ? "public" : "private"}. Publishing exposes your handle, display name, biography, join date and accepted contributions from currently public repositories. Private repository activity and sign-in details are excluded.</p>
            {profile.visibility === "private" && savedProfile && (profile.handle !== savedProfile.handle || profile.displayName !== savedProfile.displayName || profile.bio !== savedProfile.bio) && <p className="text-xs text-muted-foreground">Save your profile edits before publishing.</p>}
            {profile.visibility === "private" && <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1 accent-orange-600" checked={publishConfirmed} disabled={busy !== null || profile.moderation?.suppressed} onChange={event => setPublishConfirmed(event.target.checked)} /><span>I confirm that these profile fields and public contribution records may be viewed by anyone.</span></label>}
            {visibilityNotice && <p role={visibilityNotice.ok ? "status" : "alert"} className={visibilityNotice.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{visibilityNotice.text}</p>}
            <div className="flex flex-wrap gap-3 items-center"><Button size="sm" variant="outline" disabled={busy !== null || visibilityUnknown || (profile.visibility === "private" && (profile.moderation?.suppressed || !publishConfirmed || !savedProfile?.handle || profile.handle !== savedProfile.handle || profile.displayName !== savedProfile.displayName || profile.bio !== savedProfile.bio))} onClick={async () => {
              if (profile.moderation?.suppressed && profile.visibility === "private") return;
              setBusy("visibility"); setVisibilityNotice(null);
              const visibility = profile.visibility === "public" ? "private" : "public";
              try {
                await apiJson("/profile/visibility", { method: "PUT", json: { visibility, confirmed: visibility === "public" && publishConfirmed, ...(visibility === "public" ? { expectedVersion: savedProfile?.version } : {}) } });
                setProfile(value => value ? { ...value, visibility } : value); setPublishConfirmed(false);
                setVisibilityUnknown(true); await loadProfile();
                setVisibilityNotice({ ok: true, text: visibility === "public" ? "Public profile enabled." : "Public profile disabled." });
              } catch (failure) { setVisibilityUnknown(true); setVisibilityNotice({ ok: false, text: `${errText(failure, "Publication response unavailable")}. Publication state is not confirmed. Reload the saved profile before continuing.` }); }
              finally { setBusy(null); }
            }}>{busy === "visibility" ? "Saving…" : profile.visibility === "public" ? "Make profile private" : "Publish profile"}</Button>{profile.visibility === "public" && !profile.moderation?.suppressed && <a className="text-xs underline underline-offset-4" href={`/#/profile/${encodeURIComponent(savedProfile?.handle ?? profile.handle)}`}>View public profile</a>}</div>
          </div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Plan</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {billingError && <LoadError message={billingError} onRetry={() => void loadBilling()} />}
          {!billing && !billingError && <p role="status" className="text-muted-foreground">Loading plan…</p>}
          {billing && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Plan <Badge variant={billing.plan === "pro" ? "success" : "secondary"}>{billing.plan}</Badge></span>
              <span className="text-muted-foreground">{billing.runsToday} of {billing.runsPerDay} AI runs used today</span>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">API tokens</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">For the <code>flaregit</code> CLI and scripts. A token acts as you; it cannot create or list other tokens. Revoke it at any time.</p>
          {tokenError && <div role="alert" className={alertCls}>{tokenError}</div>}
          {tokenNotice && <div role="status" className={okCls}>{tokenNotice}</div>}
          {created && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <div className="text-xs font-semibold">Copy your token now — it is not shown again</div>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="new-token">New token</label>
                <input id="new-token" readOnly className={field} value={created} onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="icon" aria-label="Copy token" onClick={() => {
                  navigator.clipboard.writeText(created).then(() => setCopied(true), () => setTokenError("Could not copy to the clipboard. Select the token and copy it manually."));
                }}><Copy className="h-4 w-4" /></Button>
              </div>
              {copied && <p role="status" className="text-xs text-emerald-300">Token copied.</p>}
              <code className="block text-xs break-all">flaregit auth login {created}</code>
            </div>
          )}
          {tokensError && <LoadError message={tokensError} onRetry={() => void loadTokens()} />}
          {!tokens && !tokensError && <p role="status" className="text-sm text-muted-foreground">Loading tokens…</p>}
          {tokens && (
            <div className="divide-y divide-border rounded-md border border-border">
              {tokens.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No tokens yet</p>}
              {tokens.map((t) => (
                <div key={t.id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0 break-words">
                    {t.label}
                    {t.scope !== "full" && <Badge variant="outline" className="ml-2">{t.scope}{t.repo ? " · 1 repo" : ""}</Badge>}
                    <span className="block sm:inline text-xs text-muted-foreground sm:ml-2">created {timeAgo(t.created_at)} · {t.last_used ? `used ${timeAgo(t.last_used)}` : "never used"}</span>
                  </div>
                  <Button size="sm" variant="ghost" aria-label={`Revoke ${t.label}`} disabled={busy !== null} onClick={() => void tokenAction(`revoke:${t.id}`, async () => {
                    await apiJson(`/tokens/${t.id}`, { method: "DELETE" });
                    return `Revoked ${t.label}.`;
                  })}>{busy === `revoke:${t.id}` ? "Revoking…" : <Trash2 className="h-3.5 w-3.5" />}</Button>
                </div>
              ))}
            </div>
          )}
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            void tokenAction("create", async () => {
              const r = await apiJson<{ token: string }>("/tokens", { method: "POST", json: { label } });
              setCreated(r.token);
              setCopied(false);
              setLabel("");
              return "Token created.";
            });
          }}>
            <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. laptop" maxLength={60} aria-label="Token label" />
            <Button type="submit" variant="orange" className="shrink-0" disabled={busy !== null}>{busy === "create" ? "Creating…" : "Create token"}</Button>
          </form>
        </CardContent>
      </Card>
      </fieldset>
      <StorageReconciliation />
      <Card>
        <CardHeader><CardTitle className="text-base text-destructive">Delete account</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Permanently deletes every repository you own (code, changes, webhooks), removes you from shared repositories, revokes all tokens, and deletes your sign-in. This cannot be undone. Cancel an active Pro subscription first.</p>
          {deleteError && <div role="alert" className={alertCls}>{deleteError}</div>}
          {deletionNotice && <p role="status" className="text-sm text-muted-foreground">{deletionNotice}</p>}
          <div className="flex flex-col sm:flex-row gap-2">
            <input className={field} value={confirm} disabled={deletionStarted} onChange={(e) => setConfirm(e.target.value)} placeholder='Type "delete my account"' aria-label="Confirm account deletion" />
            <Button
              variant="destructive"
              className="shrink-0"
              disabled={busy !== null || confirm !== "delete my account"}
              onClick={async () => {
                setBusy("delete");
                setDeleteError(null);
                try {
                  setDeletionStarted(true); setDeletionNotice(null); retainDeletion(serverDeleted ? "server-deleted" : "pending");
                  if (!serverDeleted) {
                    const result = await apiJson<{ deleted: boolean; status?: "deleting"; reason?: string }>("/account", { method: "DELETE", json: { confirm } });
                    if (result.deleted !== true) {
                      setDeletionNotice(result.reason ?? "Deletion is pending. Repository cleanup has not been confirmed; retry this same deletion request.");
                      setBusy(null); return;
                    }
                    setServerDeleted(true); retainDeletion("server-deleted");
                  }
                  if (!user) throw new Error("Repository deletion is confirmed, but your sign-in identity is unavailable. Retry identity deletion after the session recovers.");
                  await user.delete();
                  try { sessionStorage.removeItem(`flaregit.account-deletion.${user.id}`); } catch { /* The identity deletion is confirmed. */ }
                  window.location.href = "/";
                } catch (e) {
                  setDeleteError(`${errText(e, "Deletion response unavailable")}. Deletion is not fully confirmed. Retrying continues this same deletion request.`);
                  setBusy(null);
                }
              }}
            >{busy === "delete" ? "Deleting…" : serverDeleted ? "Retry sign-in deletion" : deletionStarted ? "Retry deletion" : "Delete everything"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
