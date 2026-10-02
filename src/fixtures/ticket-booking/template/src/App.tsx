import React, { useState } from "react";
import { EVENT_CATALOG } from "./catalog.js";
import { calculateQuote } from "./pricing.js";
import type { QuoteResult } from "./types.js";

export function App() {
  const [selectedEventId] = useState<string>("cf-connect-2026");
  const [ticketCount, setTicketCount] = useState<number>(4);
  const [isRefundable, setIsRefundable] = useState<boolean>(true);
  const [confirmed, setConfirmed] = useState<boolean>(false);

  const event = EVENT_CATALOG.find((e) => e.id === selectedEventId) || EVENT_CATALOG[0]!;
  
  // Calculate current quote
  const quote: QuoteResult = calculateQuote({
    ticketCount,
    basePrice: event.price,
    isRefundable,
  });

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", padding: "24px", maxWidth: "680px", margin: "0 auto", color: "#0f172a" }}>
      <header style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: "16px", marginBottom: "20px" }}>
        <div style={{ display: "inline-block", background: "#f97316", color: "#fff", padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
          Live Accepted Application
        </div>
        <h1 style={{ fontSize: "24px", margin: "4px 0", color: "#0f172a" }}>Event Ticket Checkout</h1>
        <p style={{ color: "#64748b", margin: "0", fontSize: "14px" }}>
          Accepted demo build running in an isolated preview sandbox.
        </p>
      </header>

      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 4px 0" }}>{event.name}</h2>
        <div style={{ fontSize: "14px", color: "#475569" }}>
          <span>📍 {event.venue}</span> • <span>🗓️ {event.date}</span>
        </div>
      </div>

      <div style={{ display: "grid", gap: "16px", marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "12px 16px" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "15px" }}>Tickets</div>
            <div style={{ fontSize: "13px", color: "#64748b" }}>Base price: ${event.price.toFixed(2)} each</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              id="ticket-decrement-btn"
              onClick={() => setTicketCount(Math.max(1, ticketCount - 1))}
              style={{ width: "32px", height: "32px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontWeight: "bold" }}
            >
              -
            </button>
            <span id="ticket-count-display" style={{ fontWeight: 600, minWidth: "24px", textAlign: "center" }}>
              {ticketCount}
            </span>
            <button
              id="ticket-increment-btn"
              onClick={() => setTicketCount(ticketCount + 1)}
              style={{ width: "32px", height: "32px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontWeight: "bold" }}
            >
              +
            </button>
          </div>
        </div>

        {/* Refundable Ticket Checkbox / Indicator */}
        <label style={{ display: "flex", alignItems: "center", gap: "12px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "12px 16px", cursor: "pointer" }}>
          <input
            id="refundable-checkbox"
            type="checkbox"
            checked={isRefundable}
            onChange={(e) => setIsRefundable(e.target.checked)}
            style={{ width: "18px", height: "18px", cursor: "pointer" }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>Refundable Tickets</span>
              {quote.isRefundable && (
                <span id="refundable-badge" style={{ background: "#dcfce7", color: "#166534", fontSize: "11px", fontWeight: "bold", padding: "2px 6px", borderRadius: "4px" }}>
                  REFUNDABLE ACTIVE
                </span>
              )}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Cancel up to 24 hours before showtime ($5.00 surcharge per ticket).
            </div>
          </div>
        </label>
      </div>

      {/* Quote summary card */}
      <div style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
        <h3 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 12px 0", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px" }}>
          Order Summary
        </h3>

        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "14px" }}>
          <span>Ticket Subtotal ({ticketCount} tickets)</span>
          <span id="summary-ticket-subtotal">${quote.ticketTotal.toFixed(2)}</span>
        </div>

        {quote.discountAmount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "14px", color: "#16a34a", fontWeight: 500 }}>
            <span>Group Discount (15% off)</span>
            <span id="summary-discount">-${quote.discountAmount.toFixed(2)}</span>
          </div>
        )}

        {quote.refundFeeTotal > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "14px", color: "#475569" }}>
            <span>Refundable Protection (${(quote.refundFeeTotal / ticketCount).toFixed(2)}/ea)</span>
            <span id="summary-refund-fee">+${quote.refundFeeTotal.toFixed(2)}</span>
          </div>
        )}

        {/* Detailed Receipt Line Items (if present) */}
        {quote.receiptItems && quote.receiptItems.length > 0 && (
          <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px dashed #cbd5e1" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "6px" }}>Itemized Receipt:</div>
            {quote.receiptItems.map((item, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: item.isDiscount ? "#16a34a" : "#334155" }}>
                <span>• {item.description}</span>
                <span>{item.isDiscount ? `-$${Math.abs(item.amount).toFixed(2)}` : `$${item.amount.toFixed(2)}`}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px", paddingTop: "12px", borderTop: "2px solid #0f172a", fontSize: "18px", fontWeight: "bold" }}>
          <span>Total</span>
          <span id="summary-total-price">${quote.total.toFixed(2)}</span>
        </div>
      </div>

      <button
        id="confirm-booking-btn"
        onClick={() => setConfirmed(true)}
        style={{
          width: "100%",
          padding: "14px",
          background: "#0f172a",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          fontSize: "15px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {confirmed ? "✓ Booking Reserved" : `Pay $${quote.total.toFixed(2)}`}
      </button>

      {confirmed && (
        <div id="booking-confirmation-alert" style={{ marginTop: "16px", padding: "12px", background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: "6px", fontSize: "14px" }}>
          Reservation confirmed for {ticketCount} tickets ({quote.isRefundable ? "Refundable" : "Standard"}).
        </div>
      )}
    </div>
  );
}
