/** Current production verifier protocol identities. */
export const VERIFIER_IDENTITIES = {
  external: "flaregit-native-integrity-v1",
  "ticket-booking": "flaregit-ticket-booking-protected-verifier-v2",
  "shipping-calculator": "flaregit-shipping-protected-verifier-v2",
  custom: "flaregit-command-verifier-v2",
} as const;
