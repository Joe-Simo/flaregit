import * as path from "node:path";
import type { ProtectedVerifier } from "../../core/verifier.js";
import { verifyInIsolation } from "../../core/verification/isolated.js";

export const shippingVerifier: ProtectedVerifier = {
  identity: "flaregit-shipping-protected-verifier-v2",
  protectedPaths: [".flaregit/", ".github/", "tests/", "verifier/", "package.json", "tsconfig.json", "bun.lock"],
  defaultPolicy: {},
  verify: (ctx) =>
    verifyInIsolation(
      {
        identity: "flaregit-shipping-protected-verifier-v2",
        suite: "ShippingProtectedSuite",
        checksModule: path.join(import.meta.dirname, "checks.ts"),
      },
      ctx
    ),
};
