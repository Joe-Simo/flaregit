import { apiFetch } from "../api";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PublicPlanPrice } from "../../server/plan-price";

interface Billing {
  plan: "free" | "pro";
  status: string;
  runsToday: number;
  runsPerDay: number;
  checkoutConfigured: boolean;
  managed?: { status: string };
}

/** Shows the project's plan and today's usage; upgrades through Polar checkout. */
export function BillingBar({ refreshKey }: { refreshKey: number }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState<PublicPlanPrice | null>(null);
  const [checkingPrice, setCheckingPrice] = useState(false);

  useEffect(() => {
    apiFetch("/api/billing")
      .then((r) => (r.ok ? (r.json() as Promise<Billing>) : Promise.reject(new Error(String(r.status)))))
      .then(setBilling)
      .catch(() => setBilling(null));
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    fetch("/plan-price", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ price: PublicPlanPrice }> : null).then((value) => { if (active) setPrice(value?.price ?? null); }).catch(() => { if (active) setPrice(null); });
    return () => { active = false; };
  }, []);

  if (!billing) return null;
  let priceLabel: string | null = null;
  if (price?.status === "known" && price.environment === "production") {
    try {
      const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency });
      const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
      priceLabel = `${formatter.format(price.amountMinor / 10 ** digits)} / ${price.intervalCount === 1 ? price.interval : `${price.intervalCount} ${price.interval}s`}${price.taxBehavior === "inclusive" ? "" : " + tax"}`;
    } catch { priceLabel = null; }
  }
  const retryPrice = async () => {
    setCheckingPrice(true);
    try {
      const response = await fetch("/plan-price", { cache: "no-store" });
      setPrice(response.ok ? (await response.json() as { price: PublicPlanPrice }).price : null);
    } catch { setPrice(null); }
    finally { setCheckingPrice(false); }
  };

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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2 text-xs border-b border-border bg-card/40">
      <Badge variant={billing.plan === "pro" ? "success" : "secondary"}>{billing.plan === "pro" ? "Pro" : "Free"}</Badge>
      <span className="text-muted-foreground">
        {billing.runsToday} / {billing.runsPerDay} managed starts today
      </span>
      {billing.managed?.status && billing.managed.status !== "configured" && <span role="status" className="text-muted-foreground">Managed execution capacity is {billing.managed.status === "paused" ? "paused" : "unavailable"}. Saved work and independent tools remain available.</span>}
      {billing.plan === "free" && billing.checkoutConfigured && (
        <Button size="sm" variant="orange" disabled={busy || checkingPrice} onClick={priceLabel ? upgrade : retryPrice}>
          {checkingPrice ? "Checking price…" : priceLabel ? `Pro · ${priceLabel}` : "Check Pro price"}
        </Button>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
