import { VERIFIER_IDENTITIES } from "../../core/verification-identities.js";
import * as path from "node:path";
import type { ProtectedVerifier } from "../../core/verifier.js";
import { verifyInIsolation } from "../../core/verification/isolated.js";

export const shippingVerifier: ProtectedVerifier = {
  identity: VERIFIER_IDENTITIES["shipping-calculator"],
  protectedPaths: [".flaregit/", ".github/", "tests/", "verifier/", "package.json", "tsconfig.json", "bun.lock"],
  defaultPolicy: {},
  verify: (ctx) =>
    verifyInIsolation(
      {
        identity: VERIFIER_IDENTITIES["shipping-calculator"],
        suite: "ShippingProtectedSuite",
        checksModule: path.join(import.meta.dirname, "checks.ts"),
        observationModule: path.join(import.meta.dirname, "observe.ts"),
      },
      ctx
    ),
};
