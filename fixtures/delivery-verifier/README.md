# Owned webhook receiver verification

This isolated receiver records signed delivery receipts and one deduplicated verification action per event. It never deploys application code. The supplied configuration is not deployed automatically and has no production route. Running its tests proves local behavior only.

## Prepare an owned endpoint

Use a separate Worker in the intended Cloudflare account. Confirm that account before deployment. The prepared config stores only payload hashes, delivery/event IDs, receipt counts, and committed target metadata; it omits payloads, project names, credentials, and customer source. Reports and failure controls require a separate 32-character-or-longer control secret. Logging is disabled in the configuration.

Configure `EXPECTED_PROJECT` with the exact owned repository ID and `CONTROL_SECRET` using Wrangler secrets. Add a `deployment.requested` webhook in that repository's FlareGit Settings, targeting this receiver's HTTPS `/webhook` URL. Enter the one-time signing secret directly as the receiver's `WEBHOOK_SECRET` via Wrangler secrets. Never put either secret in source, commands containing literal values, chat, or reports.

```sh
bunx wrangler secret put EXPECTED_PROJECT --config fixtures/delivery-verifier/wrangler.jsonc
bunx wrangler secret put CONTROL_SECRET --config fixtures/delivery-verifier/wrangler.jsonc
bunx wrangler secret put WEBHOOK_SECRET --config fixtures/delivery-verifier/wrangler.jsonc
```

Deploy only after checking the account and confirming the endpoint is owned. No Git or deployment credentials are needed at the receiver. A FlareGit deployment request still requires its separately registered reporting connection; this receiver does not impersonate that service or report a successful deployment.

## Actual hosted proof

1. Select an existing accepted journal and submit a deployment request through FlareGit. Do not fabricate acceptance or replace its history. The receiver's default mode commits its verification receipt and returns 503 once.
2. Read FlareGit's delivery log: pending status, failed attempt, stable delivery ID. Allow its real Queue retry to occur; do not replace this step with a direct HTTP replay.
3. Verify the receiver's owner-only `GET /report`: two receipts, one verification action, identical event/commit/tree/ref. FlareGit should show successful transport while deployment remains unconfirmed.
4. Select **Replay** in FlareGit. Confirm the receiver receipt count rises while its action count remains one and the same IDs and target survive.
5. To exercise exhaustion, set owner-only `POST /mode` to `{"mode":"fail-always-after-commit"}`, replay, and observe the six actual attempts in FlareGit. Set mode to `healthy`, then explicitly replay; observe recovery.
6. Independently recover the event's commit/tree from the accepted retained Git ref with an authorized Git client. Receiver metadata alone does not prove Git recovery.

For control requests, supply `Authorization: Bearer <control secret>` from an operator client with secret values held in memory or the environment; do not echo commands containing credentials. Save only sanitized receiver reports and delivery-log evidence. A complete proof joins both hosted systems and Git recovery; the receiver alone cannot establish Queue execution, acceptance, or successful deployment.

```sh
bun test tests/owned-delivery-verifier.test.ts tests/webhook-consumer.test.ts tests/webhook-replay-race.test.ts
```
