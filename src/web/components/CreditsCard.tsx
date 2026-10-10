import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import type { CreditSummary } from "../../server/credit-ledger";
import { apiJson } from "../api";
import { timeAgo } from "../router";

export interface CreditBilling { runsToday: number; freeRunsPerDay: number; creditsConfigured: boolean; credits: CreditSummary }

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const cents = (value: string) => { const n = Math.round(Number(value) * 100); return Number.isSafeInteger(n) ? n : NaN; };

/** Account → Billing: prepaid credit balance, recent usage, adding credits and the recharge reminder. */
export function CreditsCard({ billing, onChanged }: { billing: CreditBilling; onChanged: () => void }) {
  const { credits } = billing;
  const [amount, setAmount] = useState(((credits.autoRecharge?.amountCents ?? 2000) / 100).toFixed(2));
  const [recharge, setRecharge] = useState({ enabled: credits.autoRecharge?.enabled ?? false, threshold: ((credits.autoRecharge?.thresholdCents ?? 500) / 100).toFixed(2), topUp: ((credits.autoRecharge?.amountCents ?? 2000) / 100).toFixed(2) });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setMessage(null);
    try { await action(); } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "That didn't work. Try again." }); }
    finally { setBusy(null); }
  };
  const buy = (amountCents: number) => run("buy", async () => {
    const { url } = await apiJson<{ url: string }>("/billing/credits/checkout", { method: "POST", json: { amountCents } });
    window.location.assign(url);
  });
  const saveRecharge = () => run("recharge", async () => {
    await apiJson("/billing/auto-recharge", { method: "PUT", json: { enabled: recharge.enabled, thresholdCents: cents(recharge.threshold), amountCents: cents(recharge.topUp) } });
    setMessage({ kind: "ok", text: "Saved." }); onChanged();
  });
  const freeLeft = Math.max(0, billing.freeRunsPerDay - billing.runsToday);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>Credit balance <strong className="text-base">{dollars(credits.balanceMicros)}</strong>{credits.heldMicros > 0 && <span className="text-muted-foreground"> · {dollars(credits.heldMicros)} held for running agents</span>}</span>
        <span className="text-muted-foreground">{freeLeft} of {billing.freeRunsPerDay} free agent runs left today</span>
      </div>
      <p className="text-xs text-muted-foreground">You pay only for what agents use: model calls and container time, at cost. Each run holds its maximum cost while it works, then you're charged what it actually used and the rest comes back. Free daily runs come first while the shared free allowance lasts.</p>
      {credits.owedMicros > 0 && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">A credit purchase was refunded or reversed, so {dollars(credits.owedMicros)} is owed. Add credits to cover it before running more agents.</div>}
      {credits.rechargePrompt && billing.creditsConfigured && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
          <span>Your balance is low ({dollars(credits.rechargePrompt.balanceMicros)}). Agents stop once it can't cover the next run.</span>
          <span className="flex gap-2">
            <Button size="sm" variant="orange" disabled={busy !== null} onClick={() => void buy(credits.rechargePrompt!.amountCents)}>Add {dollars(credits.rechargePrompt.amountCents * 10_000)}</Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("dismiss", async () => { await apiJson("/billing/recharge-prompt", { method: "DELETE" }); onChanged(); })}>Not now</Button>
          </span>
        </div>
      )}
      {billing.creditsConfigured ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void buy(cents(amount)); }}>
          <Field className="w-32"><FieldLabel htmlFor="credit-amount">Amount (USD)</FieldLabel><Input id="credit-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Button type="submit" variant="orange" disabled={busy !== null || !(cents(amount) >= 100)}>{busy === "buy" ? "Opening checkout…" : "Add credits"}</Button>
        </form>
      ) : <p className="text-xs text-muted-foreground">Buying credits isn't available yet. Free daily agent runs still work.</p>}
      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-xs font-semibold">Auto-recharge reminder</legend>
        <p className="text-xs text-muted-foreground">Polar can't charge a saved card on its own, so when your balance drops below the threshold we show a one-click top-up here instead.</p>
        <label className="flex items-center gap-2 text-xs"><Checkbox checked={recharge.enabled} onCheckedChange={(value) => setRecharge({ ...recharge, enabled: value === true })} /> Remind me when my balance is low</label>
        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-32"><FieldLabel htmlFor="recharge-threshold">Below (USD)</FieldLabel><Input id="recharge-threshold" inputMode="decimal" value={recharge.threshold} onChange={(event) => setRecharge({ ...recharge, threshold: event.target.value })} /></Field>
          <Field className="w-32"><FieldLabel htmlFor="recharge-amount">Top up (USD)</FieldLabel><Input id="recharge-amount" inputMode="decimal" value={recharge.topUp} onChange={(event) => setRecharge({ ...recharge, topUp: event.target.value })} /></Field>
          <Button variant="outline" disabled={busy !== null} onClick={() => void saveRecharge()}>{busy === "recharge" ? "Saving…" : "Save"}</Button>
        </div>
      </fieldset>
      {message && <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-destructive text-xs" : "text-xs text-muted-foreground"}>{message.text}</p>}
      <div>
        <h3 className="mb-1 text-xs font-semibold">Recent agent usage</h3>
        {credits.recent.length === 0 ? <p className="text-xs text-muted-foreground">No credit-funded agent runs yet.</p> : (
          <ul className="divide-y divide-border text-xs">
            {credits.recent.map((item) => (
              <li key={item.runId} className="flex justify-between gap-2 py-1">
                <span className="truncate text-muted-foreground">{timeAgo(item.at)}</span>
                <span>{item.state === "settled" ? `${dollars(item.debitedMicros)} used` : item.state === "held" ? `${dollars(item.heldMicros)} held · running` : "Not started · returned"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
