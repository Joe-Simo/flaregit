import { NeedsAttention } from "../components/NeedsAttention";
import {SigningKeys} from '../components/SigningKeys';
import {GitCredential} from '../components/GitCredential';
import { ProfileDiscoverySettings } from "./CommunityPeople";
import { StorageReconciliation } from "../components/StorageReconciliation";
import React, { useCallback, useEffect, useState, useRef } from "react";
import { Trash2 } from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup,RadioGroupItem } from "@/components/ui/radio-group";
import { Field,FieldGroup,FieldLabel,FieldSet,FieldLegend } from "@/components/ui/field";
import { Select,SelectTrigger,SelectValue,SelectContent,SelectGroup,SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";

export const accountTokenRequestSchema=z.object({label:z.string().trim().min(1).max(60),scope:z.enum(['read','write','full']),repo:z.string().regex(/^[a-z0-9]{12,16}$/).optional(),ttlSeconds:z.union([z.literal(1800),z.literal(86400),z.literal(604800),z.literal(2592000)]).optional()}).strict();
export function checkedAccountTokenReceipt(value:unknown,input:z.infer<typeof accountTokenRequestSchema>,now:number){
 const r=z.object({token:z.string().regex(/^fgt_[a-f0-9]{12}_[a-f0-9]{48}$/),scope:z.enum(['read','write','full']),repo:z.string().nullable(),expiresAt:z.iso.datetime().nullable()}).parse(value);
 if(r.scope!==input.scope||r.repo!==(input.repo??null)||!Number.isSafeInteger(now)||input.ttlSeconds===undefined&&r.expiresAt!==null||input.ttlSeconds!==undefined&&(r.expiresAt===null||Date.parse(r.expiresAt)<=now||Date.parse(r.expiresAt)>now+input.ttlSeconds*1000))throw Error('Token scope or expiry was not confirmed');return r;
}
export function CreatedAccountCredential({token}:{token:string}){
 const [error,setError]=useState<string|null>(null);
 const download=()=>{let url:string|undefined;try{url=URL.createObjectURL(new Blob([token],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='flaregit-credential.txt';document.body.appendChild(link);link.click();link.remove();const saved=url;setTimeout(()=>URL.revokeObjectURL(saved),1000);setError(null);}catch{if(url)URL.revokeObjectURL(url);setError('Credential download could not start. Copy it to your secret manager instead.');}};
 return <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2"><p className="text-xs font-semibold">Save your credential now — it is not shown again</p><GitCredential token={token}/><Button variant="outline" size="sm" onClick={download}>Download credential</Button><p className="text-xs text-muted-foreground">The downloaded file contains a secret. Keep it privately in your secret manager.</p>{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}</div>;
}
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
  const [tokenScope,setTokenScope]=useState<'read'|'write'|'full'>('read');
  const [tokenRepo,setTokenRepo]=useState('');const [tokenRepositories,setTokenRepositories]=useState<{id:string;name:string}[]|null>(null),[repositoryLoadError,setRepositoryLoadError]=useState<string|null>(null);const [allRepositories,setAllRepositories]=useState(false);
  const [tokenExpiry,setTokenExpiry]=useState<1800|86400|604800|2592000|0>(604800);
  const [mintUnknown,setMintUnknown]=useState(false);const mintLock=useRef(false);
  const [created, setCreated] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const [deletionStarted, setDeletionStarted] = useState(false);
  const [serverDeleted, setServerDeleted] = useState(false);
  const [deletionNotice, setDeletionNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { user } = useUser();const currentTokenUser=useRef(user?.id);currentTokenUser.current=user?.id;
  useEffect(()=>{setCreated(null);if(!user?.id)return;try{setMintUnknown(sessionStorage.getItem(`flaregit.token-mint.${user.id}`)==='pending');}catch{setMintUnknown(true);}},[user?.id]);
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
  const loadTokenRepositories=useCallback(async()=>{setRepositoryLoadError(null);try{const rows=z.object({projects:z.array(z.object({id:z.string().regex(/^[a-z0-9]{12,16}$/),name:z.string(),kind:z.string()}))}).parse(await apiJson<unknown>('/account'));setTokenRepositories(rows.projects.filter(p=>p.kind==='repository').map(({id,name})=>({id,name})));}catch{setRepositoryLoadError('Repository choices could not be confirmed. Refresh before issuing restricted access.');}},[]);
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
    void loadTokenRepositories();
    void loadBilling();
    void loadProfile();
  }, [loadTokens, loadBilling, loadProfile,loadTokenRepositories]);

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
          {profile && <ProfileDiscoverySettings key={user?.id ?? "signed-out"} published={profile.visibility === "public"} suppressed={profile.moderation?.suppressed ?? false} profileVersion={profile.version} disabled={busy !== null || visibilityUnknown || deletionStarted} onBusyChange={value => setBusy(value ? "discovery" : null)} />}
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
          <p className="text-xs text-muted-foreground">For the <code>flaregit</code> CLI and scripts. Choose the least access needed. Full access can administer repositories and create narrower tokens. Revoke access at any time.</p>
          {tokenError && <div role="alert" className={alertCls}>{tokenError}</div>}
          {tokenNotice && <div role="status" className={okCls}>{tokenNotice}</div>}
          {created && <CreatedAccountCredential key={created} token={created}/>}
          {tokensError && <LoadError message={tokensError} onRetry={() => void loadTokens()} />}
          {!tokens && !tokensError && <p role="status" className="text-sm text-muted-foreground">Loading tokens…</p>}
          {tokens && (
            <div className="divide-y divide-border rounded-md border border-border">
              {tokens.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No tokens yet</p>}
              {tokens.map((t) => (
                <div key={t.id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0 break-words">
                    {t.label}
                    <span className="block sm:inline text-xs text-muted-foreground sm:ml-2">{t.scope} · {t.repo??'all repositories'} · {t.expires_at?`expires ${new Date(t.expires_at).toLocaleString()}`:'no expiry'} · created {timeAgo(t.created_at)} · {t.last_used ? `used ${timeAgo(t.last_used)}` : "never used"}</span>
                  </div>
                  <Button size="sm" variant="ghost" aria-label={`Revoke ${t.label}`} disabled={busy !== null} onClick={() => void tokenAction(`revoke:${t.id}`, async () => {
                    await apiJson(`/tokens/${t.id}`, { method: "DELETE" });
                    return `Revoked ${t.label}.`;
                  })}>{busy === `revoke:${t.id}` ? "Revoking…" : <Trash2 className="h-3.5 w-3.5" />}</Button>
                </div>
              ))}
            </div>
          )}
          {mintUnknown&&<div role="alert" className={alertCls}>{created?'Token creation is confirmed, but its browser hold remains.':'The mint response was not confirmed.'} Inspect the token list and revoke any unwanted token before creating another. Its secret cannot be recovered.<Button variant="outline" size="sm" className="mt-2" onClick={()=>{void loadTokens();}}>Refresh token metadata</Button><Button variant="outline" size="sm" className="mt-2 ml-2" onClick={()=>{if(user?.id)try{sessionStorage.removeItem(`flaregit.token-mint.${user.id}`);}catch{setTokenError('This browser cannot clear the saved mint hold.');return;}setMintUnknown(false);setTokenNotice('Previous outcome acknowledged. Creating another token will issue separate access.');}}>I inspected the previous outcome</Button></div>}
          <form className="flex flex-col gap-3" onSubmit={(e)=>{
            e.preventDefault();if(mintLock.current||mintUnknown)return;let input:z.infer<typeof accountTokenRequestSchema>;try{if(!allRepositories&&!tokenRepositories?.some(p=>p.id===tokenRepo))throw Error('Repository selection required');input=accountTokenRequestSchema.parse({label,scope:tokenScope,...(!allRepositories?{repo:tokenRepo}:{}),...(tokenExpiry?{ttlSeconds:tokenExpiry}:{})});}catch{setTokenError('Enter a label and select a repository, or explicitly choose all repositories.');return;}
            if(!user?.id)return;try{if(sessionStorage.getItem(`flaregit.token-mint.${user.id}`)==='pending'){setMintUnknown(true);return;}sessionStorage.setItem(`flaregit.token-mint.${user.id}`,'pending');}catch{setTokenError('This browser could not preserve the mint outcome. No request was sent.');return;}const mintUser=user.id;mintLock.current=true;setBusy('create');setTokenError(null);setTokenNotice(null);
            void(async()=>{try{const response=checkedAccountTokenReceipt(await apiJson<unknown>('/tokens',{method:'POST',json:input,signal:AbortSignal.timeout(15000)}),input,Date.now());if(currentTokenUser.current!==mintUser)return;setCreated(response.token);setLabel('');setTokenNotice('Token scope and expiry confirmed.');try{sessionStorage.removeItem(`flaregit.token-mint.${mintUser}`);}catch{setTokenNotice('Token created and confirmed. The browser mint hold could not be cleared; inspect this access before issuing another token.');setMintUnknown(true);}await loadTokens();}catch{if(currentTokenUser.current!==mintUser)return;setMintUnknown(true);setTokenError('Token creation outcome is uncertain. No automatic retry was sent.');}finally{mintLock.current=false;setBusy(null);}})();
          }}>
            <FieldGroup><fieldset disabled={busy!==null} className="contents"><Field><FieldLabel htmlFor="token-label">Label</FieldLabel><Input id="token-label" value={label} onChange={e=>setLabel(e.target.value)} placeholder="Laptop or CI" maxLength={60} required/></Field>
            <FieldSet><FieldLegend>Access</FieldLegend><RadioGroup value={tokenScope} onValueChange={v=>setTokenScope(z.enum(["read","write","full"]).parse(v))} className="flex flex-wrap gap-4">{(['read','write','full'] as const).map(scope=><Field key={scope} orientation="horizontal"><RadioGroupItem value={scope} id={`token-scope-${scope}`}/><FieldLabel htmlFor={`token-scope-${scope}`}>{scope==='full'?'Full administration':scope==='write'?'Read and contribute':'Read only'}</FieldLabel></Field>)}</RadioGroup></FieldSet>
            <Field orientation="horizontal"><Checkbox id="token-all-repositories" checked={allRepositories} onCheckedChange={v=>setAllRepositories(v===true)}/><FieldLabel htmlFor="token-all-repositories">All my repositories</FieldLabel></Field>
            {!allRepositories&&<Field><FieldLabel htmlFor="token-repository">Repository</FieldLabel>{repositoryLoadError&&<LoadError message={repositoryLoadError} onRetry={()=>void loadTokenRepositories()}/>}<Select value={tokenRepo} onValueChange={setTokenRepo} disabled={!tokenRepositories?.length}><SelectTrigger id="token-repository"><SelectValue placeholder={tokenRepositories===null?'Loading repositories…':'Select a repository'}/></SelectTrigger><SelectContent><SelectGroup>{tokenRepositories?.map(p=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectGroup></SelectContent></Select>{tokenRepositories?.length===0&&<p className="text-xs text-muted-foreground">No repositories available.</p>}</Field>}
            <FieldSet><FieldLegend>Expires after</FieldLegend><RadioGroup value={String(tokenExpiry)} onValueChange={v=>setTokenExpiry(z.union([z.literal(1800),z.literal(86400),z.literal(604800),z.literal(2592000),z.literal(0)]).parse(Number(v)))} className="flex flex-wrap gap-4">{([{value:1800,label:'30 minutes'},{value:86400,label:'1 day'},{value:604800,label:'7 days'},{value:2592000,label:'30 days'},{value:0,label:'No expiry'}] as const).map(option=><Field key={option.value} orientation="horizontal"><RadioGroupItem value={String(option.value)} id={`token-expiry-${option.value}`}/><FieldLabel htmlFor={`token-expiry-${option.value}`}>{option.label}</FieldLabel></Field>)}</RadioGroup></FieldSet></fieldset></FieldGroup>
            <Button type="submit" variant="orange" disabled={busy!==null||mintUnknown}>{busy==='create'?'Creating…':'Create token'}</Button>
          </form>
        </CardContent>
      </Card>
      </fieldset>
      <SigningKeys disabled={deletionStarted||busy!==null}/>
      <NeedsAttention><StorageReconciliation /></NeedsAttention>
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
