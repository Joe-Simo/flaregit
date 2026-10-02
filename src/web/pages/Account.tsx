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
interface Profile { handle: string; displayName: string; bio: string }
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
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSave, setProfileSave] = useState<{ ok: boolean; text: string } | null>(null);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { user } = useUser();

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
      setProfile({ handle: p.handle, displayName: p.displayName, bio: p.bio });
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
      await apiJson("/profile", { method: "PUT", json: profile });
      setProfileSave({ ok: true, text: "Profile saved." });
    } catch (e) {
      setProfileSave({ ok: false, text: errText(e, "Profile not saved") });
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
      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">How you appear on changes, reviews, issues and comments.</p>
          {profileError && <LoadError message={profileError} onRetry={() => void loadProfile()} />}
          {!profile && !profileError && <p role="status" className="text-sm text-muted-foreground">Loading profile…</p>}
          {profile && (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void saveProfile(); }}>
              <label className="block text-xs text-muted-foreground">Handle<input className={field} value={profile.handle} maxLength={39} onChange={(e) => setProfile({ ...profile, handle: e.target.value })} placeholder="ada" /></label>
              <label className="block text-xs text-muted-foreground">Display name<input className={field} value={profile.displayName} maxLength={60} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} placeholder="Ada Lovelace" /></label>
              <label className="block text-xs text-muted-foreground">Bio<textarea className={field} rows={2} value={profile.bio} maxLength={300} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} /></label>
              {profileSave && (profileSave.ok
                ? <div role="status" className={okCls}>{profileSave.text}</div>
                : <div role="alert" className={alertCls}>{profileSave.text}</div>)}
              <Button type="submit" variant="orange" disabled={busy !== null}>{busy === "profile" ? "Saving…" : "Save profile"}</Button>
            </form>
          )}
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
      <Card>
        <CardHeader><CardTitle className="text-base text-destructive">Delete account</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Permanently deletes every repository you own (code, changes, webhooks), removes you from shared repositories, revokes all tokens, and deletes your sign-in. This cannot be undone. Cancel an active Pro subscription first.</p>
          {deleteError && <div role="alert" className={alertCls}>{deleteError}</div>}
          <div className="flex flex-col sm:flex-row gap-2">
            <input className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder='Type "delete my account"' aria-label="Confirm account deletion" />
            <Button
              variant="destructive"
              className="shrink-0"
              disabled={busy !== null || confirm !== "delete my account"}
              onClick={async () => {
                setBusy("delete");
                setDeleteError(null);
                try {
                  await apiJson("/account", { method: "DELETE", json: { confirm } });
                  await user?.delete();
                  window.location.href = "/";
                } catch (e) {
                  setDeleteError(errText(e, "Account not deleted"));
                  setBusy(null);
                }
              }}
            >{busy === "delete" ? "Deleting…" : "Delete everything"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
