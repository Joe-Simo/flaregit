import { apiFetch } from "../api";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Billing {
  plan: "free" | "pro";
  status: string;
  runsToday: number;
  runsPerDay: number;
  checkoutConfigured: boolean;
}

/** Shows the project's plan and today's usage; upgrades through Polar checkout. */
export function BillingBar({ refreshKey }: { refreshKey: number }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch("/api/billing")
      .then((r) => (r.ok ? (r.json() as Promise<Billing>) : Promise.reject(new Error(String(r.status)))))
      .then(setBilling)
      .catch(() => setBilling(null));
  }, [refreshKey]);

  if (!billing) return null;

  const upgrade = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/billing/checkout", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const { url } = (await res.json()) as { url: string };
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout unavailable");
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-6 py-2 text-xs border-b border-border bg-card/40">
      <Badge variant={billing.plan === "pro" ? "success" : "secondary"}>{billing.plan === "pro" ? "Pro" : "Free"}</Badge>
      <span className="text-muted-foreground">
        {billing.runsToday} / {billing.runsPerDay} agent and integration runs today
      </span>
      {billing.plan === "free" && billing.checkoutConfigured && (
        <Button size="sm" variant="orange" disabled={busy} onClick={upgrade}>
          Upgrade to Pro
        </Button>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
