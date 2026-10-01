import * as path from "node:path";
import type { ProtectedVerifier } from "../../core/verifier.js";
import { verifyInIsolation } from "../../core/verification/isolated.js";

import { TICKET_BOOKING_POLICY } from "./policy.js";

export { TICKET_BOOKING_POLICY };

export const ticketBookingVerifier: ProtectedVerifier = {
  identity: "flaregit-ticket-booking-protected-verifier-v2",
  protectedPaths: [".flaregit/", ".github/", "tests/", "verifier/", "package.json", "tsconfig.json", "bun.lock"],
  defaultPolicy: { ...TICKET_BOOKING_POLICY },
  verify: (ctx) =>
    verifyInIsolation(
      {
        identity: "flaregit-ticket-booking-protected-verifier-v2",
        suite: "TicketBookingProtectedSuite",
        checksModule: path.join(import.meta.dirname, "checks.ts"),
      },
      ctx
    ),
};
