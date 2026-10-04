/** Delivery state comes from durable receipts; an unknown value is not success. */
export function mirrorStatus(status: string): { label: string; variant: "success" | "warning" | "destructive" | "secondary" } {
  switch (status) {
    case "ok": return { label: "Mirrored", variant: "success" };
    case "diverged": return { label: "GitHub diverged", variant: "warning" };
    case "auth_failed": return { label: "Token rejected", variant: "destructive" };
    case "error": return { label: "Failed", variant: "destructive" };
    case "pending": return { label: "Queued", variant: "secondary" };
    case "deferred": return { label: "Delivery unconfirmed", variant: "warning" };
    default: return { label: "Unknown delivery state", variant: "warning" };
  }
}
