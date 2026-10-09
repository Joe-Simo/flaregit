/** F20: certify the declared catalog only from passing, digest-bound evidence of every required kind.
 * This checks receipt metadata; callers must independently authenticate and inspect the referenced receipts.
 */
export const REQUIRED_EVIDENCE_KINDS = ["ui", "api", "interoperability", "permissions"] as const;
export type EvidenceKind = typeof REQUIRED_EVIDENCE_KINDS[number];

export interface CertificationEvidence {
  readonly kind: EvidenceKind;
  readonly ticketId: string;
  readonly sourceRevision: string;
  /** Absolute HTTPS receipt URL or repository-relative receipt path. */
  readonly reference: string;
  /** SHA-256 of the immutable receipt bytes, verified by the caller. */
  readonly sha256: string;
  readonly outcome: "passed" | "failed" | "blocked";
}

export interface TicketStatus {
  readonly id: string;
  readonly evidence: readonly CertificationEvidence[];
}

export interface CertificationResult {
  readonly complete: boolean;
  readonly gaps: readonly string[];
  readonly errors: readonly string[];
}

function validReference(reference: string): boolean {
  if (!reference || reference.trim() !== reference || /[\s\\\u0000-\u001f\u007f]/.test(reference)) return false;
  if (reference.startsWith("https://")) {
    try {
      const url = new URL(reference);
      return Boolean(url.hostname) && !url.username && !url.password && !url.hash && !url.search && url.pathname !== "/";
    } catch { return false; }
  }
  return !reference.startsWith("/") && !reference.includes(":") && reference.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

export function certify(tickets: readonly TicketStatus[], expectedSourceRevision: string): CertificationResult {
  const errors: string[] = [];
  if (!/^[a-f0-9]{40}$/.test(expectedSourceRevision)) errors.push("An exact source revision is required");
  const counts = new Map<string, number>();
  if (tickets.length === 0) errors.push("The frozen catalog is empty");
  for (const ticket of tickets) {
    counts.set(ticket.id, (counts.get(ticket.id) ?? 0) + 1);
    if (!/^F(?:0[1-9]|1[0-9]|20)$/.test(ticket.id)) errors.push(`Invalid ticket id: ${ticket.id}`);
  }
  for (const [id, count] of counts) if (count > 1) errors.push(`Duplicate ticket id: ${id}`);
  const gaps = [...new Set(tickets.filter(ticket => {
    if (counts.get(ticket.id) !== 1 || !/^F(?:0[1-9]|1[0-9]|20)$/.test(ticket.id)) return true;
    return REQUIRED_EVIDENCE_KINDS.some(kind => !ticket.evidence.some(receipt =>
      receipt.kind === kind && receipt.ticketId === ticket.id && receipt.sourceRevision === expectedSourceRevision && receipt.outcome === "passed" && /^[a-f0-9]{64}$/.test(receipt.sha256) && validReference(receipt.reference)));
  }).map(ticket => ticket.id))];
  return { complete: errors.length === 0 && gaps.length === 0, gaps, errors };
}
