import { apiFetch } from "../api";
import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { CreditBilling } from "./CreditsCard";

type Billing = CreditBilling & { managed?: { status: string } };

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

/** Shows today's free agent runs and the prepaid credit balance; credits are managed in Account → Billing. */
export function BillingBar({ refreshKey }: { refreshKey: number }) {
  const [billing, setBilling] = useState<Billing | null>(null);

  useEffect(() => {
    apiFetch("/api/billing")
      .then((r) => (r.ok ? (r.json() as Promise<Billing>) : Promise.reject(new Error(String(r.status)))))
      .then(setBilling)
      .catch(() => setBilling(null));
  }, [refreshKey]);

  if (!billing?.credits) return null;
  const freeLeft = Math.max(0, billing.freeRunsPerDay - billing.runsToday);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2 text-xs border-b border-border bg-card/40">
      <Badge variant={billing.credits.balanceMicros > 0 ? "success" : "secondary"}>Credits {dollars(billing.credits.balanceMicros)}</Badge>
      <span className="text-muted-foreground">{freeLeft} of {billing.freeRunsPerDay} free agent runs left today · after that, agents use your credits at cost</span>
      {billing.credits.owedMicros > 0 && <span role="alert" className="text-destructive">A credit purchase was refunded — add credits to keep running agents.</span>}
      {billing.credits.rechargePrompt && <span role="status">Your balance is low.</span>}
      {billing.managed?.status && billing.managed.status !== "configured" && <span role="status" className="text-muted-foreground">Agent runs are {billing.managed.status === "paused" ? "paused" : "unavailable"} right now. Saved work and your own tools still work.</span>}
      <a className="underline underline-offset-4" href="/#/account">Add credits</a>
    </div>
  );
}
