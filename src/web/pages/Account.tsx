import React, { useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";

interface Token { id: string; label: string; created_at: string; last_used: string | null }
interface Billing { plan: "free" | "pro"; runsToday: number; runsPerDay: number }
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export function Account() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    apiJson<Token[]>("/tokens").then(setTokens).catch((e: Error) => setError(e.message));
    apiJson<Billing>("/billing").then(setBilling).catch(() => undefined);
  };
  useEffect(load, []);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
      <h1 className="text-xl font-bold">Account</h1>
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {billing && (
        <Card>
          <CardContent className="py-4 flex items-center justify-between text-sm">
            <span>Plan <Badge variant={billing.plan === "pro" ? "success" : "secondary"}>{billing.plan}</Badge></span>
            <span className="text-muted-foreground">{billing.runsToday} of {billing.runsPerDay} AI runs used today</span>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">API tokens</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">For the <code>flaregit</code> CLI and scripts. A token acts as you; it cannot create or list other tokens. Revoke it at any time.</p>
          {created && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <div className="text-xs font-semibold">Copy your token now — it is not shown again</div>
              <div className="flex gap-2">
                <input readOnly className={field} value={created} onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="icon" aria-label="Copy token" onClick={() => navigator.clipboard.writeText(created)}><Copy className="h-4 w-4" /></Button>
              </div>
              <code className="block text-xs break-all">flaregit auth login {created}</code>
            </div>
          )}
          <div className="divide-y divide-border rounded-md border border-border">
            {tokens.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No tokens yet</p>}
            {tokens.map((t) => (
              <div key={t.id} className="px-3 py-2 flex items-center justify-between text-sm">
                <div>
                  {t.label}
                  <span className="text-xs text-muted-foreground ml-2">created {timeAgo(t.created_at)} · {t.last_used ? `used ${timeAgo(t.last_used)}` : "never used"}</span>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Revoke ${t.label}`} onClick={async () => { await apiJson(`/tokens/${t.id}`, { method: "DELETE" }); load(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. laptop" maxLength={60} aria-label="Token label" />
            <Button variant="orange" onClick={async () => { const r = await apiJson<{ token: string }>("/tokens", { method: "POST", json: { label } }); setCreated(r.token); setLabel(""); load(); }}>Create token</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
