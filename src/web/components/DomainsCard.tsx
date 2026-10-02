import React, { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";

interface Domain { domain: string; verified: boolean; host: string; value: string }
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";
const okCls = "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200";
const noticeCls = "rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Proves a repository owner controls a domain by a DNS TXT record. Whoever controls DNS holds the name. */
export function DomainsCard({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setDomains(await apiJson<Domain[]>(`/p/${projectId}/domains`));
    } catch (e) {
      setLoadError(errText(e, "Could not load domains"));
    }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<{ ok: boolean; text: string }>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      await load();
    } catch (e) {
      setError(errText(e, "Something went wrong"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Verified domains</CardTitle></CardHeader>
      <CardContent className="space-y-3 min-w-0">
        <p className="text-sm text-muted-foreground">Add a TXT record to prove you control a domain. If someone else claims your name, whoever controls the DNS keeps it.</p>
        {loadError && (
          <div role="alert" className={`${alertCls} flex flex-wrap items-center justify-between gap-2`}>
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
          </div>
        )}
        {error && <div role="alert" className={alertCls}>{error}</div>}
        {notice && <div role="status" className={notice.ok ? okCls : noticeCls}>{notice.text}</div>}
        {domains === null && !loadError && <p role="status" className="text-sm text-muted-foreground">Loading domains…</p>}
        {domains?.length === 0 && <p className="text-sm text-muted-foreground">No domains claimed yet.</p>}
        {domains?.map((d) => (
          <div key={d.domain} className="rounded-md border border-border p-3 text-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium break-all">{d.domain} <Badge variant={d.verified ? "success" : "secondary"}>{d.verified ? "verified" : "pending"}</Badge></span>
              {isOwner && (
                <Button size="sm" variant="ghost" aria-label={`Release ${d.domain}`} disabled={busy !== null} onClick={() => run(`del:${d.domain}`, async () => {
                  await apiJson(`/p/${projectId}/domains/${d.domain}`, { method: "DELETE" });
                  return { ok: true, text: `Released ${d.domain}.` };
                })}>{busy === `del:${d.domain}` ? "Releasing…" : <Trash2 className="h-3.5 w-3.5" />}</Button>
              )}
            </div>
            {!d.verified && (
              <>
                <p className="text-xs text-muted-foreground">Create this TXT record, then check:</p>
                <code className="block text-xs break-all">{d.host} TXT "{d.value}"</code>
                {isOwner && (
                  <Button size="sm" variant="orange" disabled={busy !== null} onClick={() => run(`verify:${d.domain}`, async () => {
                    const r = await apiJson<{ verified: boolean }>(`/p/${projectId}/domains/${d.domain}/verify`, { method: "POST" });
                    return r.verified ? { ok: true, text: `${d.domain} is verified.` } : { ok: false, text: "The TXT record was not found yet. DNS can take a few minutes." };
                  })}>{busy === `verify:${d.domain}` ? "Checking…" : "Check DNS"}</Button>
                )}
              </>
            )}
          </div>
        ))}
        {isOwner && (
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            void run("claim", async () => {
              await apiJson(`/p/${projectId}/domains`, { method: "POST", json: { domain: input } });
              const claimed = input;
              setInput("");
              return { ok: true, text: `Claimed ${claimed}. Add the TXT record to verify it.` };
            });
          }}>
            <label className="sr-only" htmlFor={`domain-${projectId}`}>Domain</label>
            <input id={`domain-${projectId}`} className={field} value={input} onChange={(e) => setInput(e.target.value)} placeholder="example.com" />
            <Button type="submit" variant="orange" disabled={busy !== null || !input.trim()}>{busy === "claim" ? "Claiming…" : "Claim"}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
