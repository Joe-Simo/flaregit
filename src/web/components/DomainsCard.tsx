import React, { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";

interface Domain { domain: string; verified: boolean; host: string; value: string }
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

/** Proves a repository owner controls a domain by a DNS TXT record. Whoever controls DNS holds the name. */
export function DomainsCard({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const load = () => apiJson<Domain[]>(`/p/${projectId}/domains`).then(setDomains).catch(() => undefined);
  useEffect(() => { void load(); }, [projectId]);

  const run = async (fn: () => Promise<void>) => {
    setMessage(null);
    try { await fn(); } catch (e) { setMessage((e as Error).message); }
    void load();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Verified domains</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Add a TXT record to prove you control a domain. If someone else claims your name, whoever controls the DNS keeps it.</p>
        {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
        {domains.map((d) => (
          <div key={d.domain} className="rounded-md border border-border p-3 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">{d.domain} <Badge variant={d.verified ? "success" : "secondary"}>{d.verified ? "verified" : "pending"}</Badge></span>
              {isOwner && <Button size="sm" variant="ghost" aria-label={`Release ${d.domain}`} onClick={() => run(async () => { await apiJson(`/p/${projectId}/domains/${d.domain}`, { method: "DELETE" }); })}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </div>
            {!d.verified && (
              <>
                <p className="text-xs text-muted-foreground">Create this TXT record, then check:</p>
                <code className="block text-xs break-all">{d.host} TXT "{d.value}"</code>
                {isOwner && <Button size="sm" variant="orange" onClick={() => run(async () => {
                  const r = await apiJson<{ verified: boolean }>(`/p/${projectId}/domains/${d.domain}/verify`, { method: "POST" });
                  if (!r.verified) setMessage("The TXT record was not found yet. DNS can take a few minutes.");
                })}>Check DNS</Button>}
              </>
            )}
          </div>
        ))}
        {isOwner && (
          <div className="flex gap-2">
            <input className={field} value={input} onChange={(e) => setInput(e.target.value)} placeholder="example.com" aria-label="Domain" />
            <Button variant="orange" onClick={() => run(async () => { await apiJson(`/p/${projectId}/domains`, { method: "POST", json: { domain: input } }); setInput(""); })}>Claim</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
