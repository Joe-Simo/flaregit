import { z } from "zod";
const identity = z.string().min(1).max(200);
const ordinal = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const MAX_WEBHOOK_BLOCKED_DEFERRALS = 12;
export interface BlockedDelivery { deliveryId: string; eventId: string; generation: number; count: number; paused: boolean }
export type BlockedDeferral = { kind: "reserved" | "duplicate" | "paused"; record: BlockedDelivery };
/** Bounded ordering waits. A reservation is not evidence that its queue send
 * succeeded: callers must preserve dispatch ambiguity and reconcile it.
 * This ledger never changes receiver attempts, delivery status or event order. */
export class WebhookBlockedDeferrals {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS webhook_blocked_deferrals(delivery_id TEXT NOT NULL,event_id TEXT NOT NULL,generation INTEGER NOT NULL,count INTEGER NOT NULL,paused INTEGER NOT NULL,PRIMARY KEY(delivery_id,generation))");
  }
  current(deliveryId: string): BlockedDelivery | null {
    const row = this.storage.sql.exec<{ delivery_id: string; event_id: string; generation: number; count: number; paused: number }>("SELECT * FROM webhook_blocked_deferrals WHERE delivery_id=? ORDER BY generation DESC LIMIT 1", deliveryId).toArray()[0];
    return row ? { deliveryId: row.delivery_id, eventId: row.event_id, generation: row.generation, count: row.count, paused: row.paused === 1 } : null;
  }
  defer(deliveryId: string, eventId: string, generation: number, sequence: number): BlockedDeferral {
    identity.parse(deliveryId); identity.parse(eventId); ordinal.parse(generation); ordinal.parse(sequence);
    return this.storage.transactionSync(() => {
      let record = this.current(deliveryId);
      if (!record) {
        if (sequence !== 0) throw new Error("Blocked delivery sequence is unavailable");
        this.storage.sql.exec("INSERT INTO webhook_blocked_deferrals VALUES(?,?,?,0,0)", deliveryId, eventId, generation);
        record = { deliveryId, eventId, generation, count: 0, paused: false };
      }
      if (record.eventId !== eventId || record.generation !== generation) throw new Error("Blocked delivery generation changed");
      if (sequence < record.count) return { kind: "duplicate", record };
      if (sequence !== record.count) throw new Error("Blocked delivery sequence changed");
      if (record.paused || record.count >= MAX_WEBHOOK_BLOCKED_DEFERRALS) {
        this.storage.sql.exec("UPDATE webhook_blocked_deferrals SET paused=1 WHERE delivery_id=? AND generation=?", deliveryId, generation);
        return { kind: "paused", record: { ...record, paused: true } };
      }
      record = { ...record, count: record.count + 1 };
      this.storage.sql.exec("UPDATE webhook_blocked_deferrals SET count=? WHERE delivery_id=? AND generation=?", record.count, deliveryId, generation);
      return { kind: "reserved", record };
    });
  }
  /** Call only after authoritative owner replay has created this exact next
   * generation. Retains old rows; duplicate replay cannot reset consumed waits. */
  replay(deliveryId: string, eventId: string, expectedGeneration: number, generation: number): BlockedDelivery {
    identity.parse(deliveryId); identity.parse(eventId); ordinal.parse(expectedGeneration); ordinal.parse(generation);
    if (generation !== expectedGeneration + 1) throw new Error("Replay generation must advance once");
    return this.storage.transactionSync(() => {
      const previous = this.current(deliveryId);
      if (!previous || previous.eventId !== eventId) throw new Error("Blocked delivery identity unavailable");
      if (previous.generation === generation) return previous;
      if (previous.generation !== expectedGeneration) throw new Error("Replay generation changed");
      this.storage.sql.exec("INSERT INTO webhook_blocked_deferrals VALUES(?,?,?,0,0)", deliveryId, eventId, generation);
      return { deliveryId, eventId, generation, count: 0, paused: false };
    });
  }
}
