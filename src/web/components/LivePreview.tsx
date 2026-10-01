import React, { useState } from "react";
import { Monitor, ExternalLink, ShieldCheck, CheckCircle2, Sparkles, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface LivePreviewProps {
  currentCommit: string;
  policy: {
    groupDiscountPercent: number;
    minTicketsForDiscount: number;
    refundFeePerTicket: number;
    discountAppliesToRefundFee: boolean;
  };
}

export function LivePreview({ currentCommit, policy }: LivePreviewProps) {
  const [ticketCount, setTicketCount] = useState<number>(4);
  const [isRefundable, setIsRefundable] = useState<boolean>(true);
  const [booked, setBooked] = useState<boolean>(false);

  const basePrice = 40.0;
  const rawSubtotal = ticketCount * basePrice;
  const hasGroupDiscount = ticketCount >= policy.minTicketsForDiscount;
  const discountRate = hasGroupDiscount ? policy.groupDiscountPercent : 0.0;

  // Calculation matching policy
  const baseDiscount = rawSubtotal * discountRate;
  const refundFeeBase = isRefundable ? ticketCount * policy.refundFeePerTicket : 0.0;
  const refundFeeDiscount = (isRefundable && policy.discountAppliesToRefundFee && hasGroupDiscount)
    ? refundFeeBase * discountRate
    : 0.0;

  const totalDiscount = baseDiscount + refundFeeDiscount;
  const ticketTotal = rawSubtotal - baseDiscount;
  const refundFeeTotal = refundFeeBase - refundFeeDiscount;
  const totalPrice = ticketTotal + refundFeeTotal;

  return (
    <Card className="h-full flex flex-col border-border/80 bg-card/70 backdrop-blur-sm overflow-hidden">
      <CardHeader className="py-3 px-5 border-b border-border/60 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Immutable Live Application Preview
            </CardTitle>
            <Badge variant="success" className="text-[11px] gap-1">
              <ShieldCheck className="h-3 w-3" />
              <span>Exact Verified Build</span>
            </Badge>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span className="text-foreground font-semibold px-2 py-0.5 rounded bg-background/80 border border-border">
              flaregit.com/preview/{currentCommit.slice(0, 7)}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 flex-1 overflow-y-auto bg-background/30">
        <div className="max-w-xl mx-auto rounded-xl border border-border/80 bg-card p-6 shadow-xl">
          {/* Top Banner inside preview */}
          <div className="border-b border-border/60 pb-4 mb-5 flex items-center justify-between">
            <div>
              <div className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-orange-500/10 text-orange-400 border border-orange-500/20 mb-1.5">
                Cloudflare Connect 2026
              </div>
              <h2 className="text-xl font-extrabold text-foreground tracking-tight">
                Event Ticket Checkout
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Moscone West, San Francisco • Oct 21, 2026
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Base Price</div>
              <div className="text-lg font-bold text-foreground">${basePrice.toFixed(2)}</div>
            </div>
          </div>

          {/* Ticket Quantity Selector */}
          <div className="space-y-4 mb-6">
            <div className="flex items-center justify-between p-3.5 rounded-lg border border-border/60 bg-muted/30">
              <div>
                <div className="text-sm font-semibold text-foreground">Standard Tickets</div>
                <div className="text-xs text-muted-foreground">
                  Includes full access to developer keynotes and hands-on labs
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 text-foreground"
                  onClick={() => setTicketCount(Math.max(1, ticketCount - 1))}
                >
                  -
                </Button>
                <span className="font-bold text-base w-6 text-center text-foreground">
                  {ticketCount}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 text-foreground"
                  onClick={() => setTicketCount(ticketCount + 1)}
                >
                  +
                </Button>
              </div>
            </div>

            {/* Refundable Protection Surcharge */}
            <label className="flex items-start gap-3 p-3.5 rounded-lg border border-border/60 bg-muted/30 cursor-pointer hover:border-border transition-colors">
              <input
                type="checkbox"
                checked={isRefundable}
                onChange={(e) => setIsRefundable(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer accent-orange-500"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    Refundable Protection Guarantee
                  </span>
                  {isRefundable && (
                    <Badge variant="success" className="text-[10px] uppercase">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Cancel up to 24 hours before showtime for a 100% refund. Surcharge: ${policy.refundFeePerTicket.toFixed(2)} per ticket.
                </p>
              </div>
            </label>
          </div>

          {/* Itemized Order Summary */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4 mb-6 space-y-2.5 text-xs">
            <div className="font-bold uppercase tracking-wider text-muted-foreground text-[11px] pb-1 border-b border-border/40">
              Itemized Quote Summary
            </div>

            <div className="flex justify-between text-muted-foreground">
              <span>Tickets Subtotal ({ticketCount} × ${basePrice.toFixed(2)})</span>
              <span className="font-mono text-foreground font-medium">${rawSubtotal.toFixed(2)}</span>
            </div>

            {hasGroupDiscount && (
              <div className="flex justify-between text-emerald-400 font-medium">
                <span>Group Discount (15% off for 4+ tickets)</span>
                <span className="font-mono">-${baseDiscount.toFixed(2)}</span>
              </div>
            )}

            {isRefundable && (
              <div className="flex justify-between text-muted-foreground">
                <span>Refundable Protection ({ticketCount} × ${policy.refundFeePerTicket.toFixed(2)})</span>
                <span className="font-mono text-foreground font-medium">+${refundFeeBase.toFixed(2)}</span>
              </div>
            )}

            {refundFeeDiscount > 0 && (
              <div className="flex justify-between text-emerald-400 font-medium">
                <span>Discount applied to Refund Guarantee</span>
                <span className="font-mono">-${refundFeeDiscount.toFixed(2)}</span>
              </div>
            )}

            <div className="pt-2.5 border-t-2 border-border flex justify-between items-center text-sm font-bold text-foreground">
              <span>Total Payable</span>
              <span className="text-lg font-mono text-primary font-extrabold">
                ${totalPrice.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Action Button */}
          <Button
            className="w-full h-11 text-base font-semibold"
            variant="orange"
            onClick={() => setBooked(true)}
          >
            {booked ? "✓ Reservation Confirmed" : `Reserve & Pay $${totalPrice.toFixed(2)}`}
          </Button>

          {booked && (
            <div className="mt-4 p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                Booking confirmed for {ticketCount} tickets ({isRefundable ? "Refundable" : "Standard"}) at ${totalPrice.toFixed(2)}.
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
