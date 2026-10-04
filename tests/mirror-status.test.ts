import { expect, test } from "bun:test";
import { mirrorStatus } from "../src/web/mirror-status";
import { mirrorAcceptedFollowup } from "../src/server/accepted-followups";
import type { Ledger } from "../src/server/durable-object";

test("unconfirmed mirror delivery has a visible warning rather than an empty badge", async () => {
  let recordedStatus = "";
  const ledger = { recordMirrorRun: async (_commit: string, status: string) => { recordedStatus = status; } } as unknown as Ledger;
  const result = await mirrorAcceptedFollowup(ledger, "a".repeat(40), async () => { throw new Error("Synthetic transport interrupted"); });
  expect("status" in result && result.status).toBe("deferred");
  expect(mirrorStatus(recordedStatus)).toEqual({ label: "Delivery unconfirmed", variant: "warning" });
});

test("unknown durable mirror receipt cannot appear successful", () => {
  expect(mirrorStatus("future-provider-state")).toEqual({ label: "Unknown delivery state", variant: "warning" });
  expect(mirrorStatus("ok")).toEqual({ label: "Mirrored", variant: "success" });
});
