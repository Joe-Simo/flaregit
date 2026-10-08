/** F20 slice: finite parity certification. A ticket counts only when it has evidence; anything else is listed as an open gap. */

export interface TicketStatus {
  readonly id: string;
  readonly evidence: readonly string[];
}

export function certify(tickets: readonly TicketStatus[]): {readonly complete: boolean; readonly gaps: string[]} {
  const gaps = tickets.filter((ticket) => ticket.evidence.length === 0).map((ticket) => ticket.id);
  return {complete: gaps.length === 0, gaps};
}
