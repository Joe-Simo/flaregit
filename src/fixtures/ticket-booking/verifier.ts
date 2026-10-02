import { VERIFIER_IDENTITIES } from "../../core/verification-identities.js";
import * as path from "node:path";
import type { ProtectedVerifier } from "../../core/verifier.js";
import { verifyInIsolation } from "../../core/verification/isolated.js";

import { TICKET_BOOKING_POLICY } from "./policy.js";

export { TICKET_BOOKING_POLICY };

export const ticketBookingVerifier: ProtectedVerifier = {
  identity: VERIFIER_IDENTITIES["ticket-booking"],
  protectedPaths: [".flaregit/", ".github/", "tests/", "verifier/", "package.json", "tsconfig.json", "bun.lock"],
  defaultPolicy: { ...TICKET_BOOKING_POLICY },
  verify: (ctx) =>
    verifyInIsolation(
      {
        identity: VERIFIER_IDENTITIES["ticket-booking"],
        suite: "TicketBookingProtectedSuite",
        checksModule: path.join(import.meta.dirname, "checks.ts"),
        observationModule: path.join(import.meta.dirname, "observe.ts"),
      },
      ctx
    ),
};
