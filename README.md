# FlareGit

> Work in parallel. Integration happens automatically. — [flaregit.com](https://flaregit.com)

A Git-compatible platform for humans and AI agents working concurrently. Contributors push to their own task repositories; FlareGit composes their work on top of the accepted version with native Git, repairs what it safely can, verifies the exact candidate with platform-owned checks, and publishes only that verified commit with a compare-and-swap ref update. Contradictory requirements pause integration, keep the last accepted version live, and ask one product question.

## How it works

| Stage | Implementation |
|---|---|
| Isolate | Each task is a fork of the canonical repo (`src/core/pipeline/isolate.ts`); contributors use ordinary `git clone/push`. |
| Detect | `git merge-tree` finds real text conflicts; clean merges are trial-verified so behavioral/interface conflicts are found by execution (`detect.ts`). |
| Compose | Native `git merge` of task A then B onto the exact accepted head (`compose.ts`). |
| Repair | Workers AI proposes whole-file fixes; the platform confines them to scope, rejects protected paths and leftover conflict markers, caps at 2 rounds (`repair.ts`). |
| Verify | Type-check + platform-owned behavioral checks run in a scrubbed child process against a fresh checkout of the candidate commit (`core/verification`). Evidence binds commit **and tree**. |
| Accept | `publishAcceptedCandidate` re-checks evidence↔commit↔tree↔base↔policy and moves the ref with CAS (`update-ref old` locally, `push --force-with-lease` to Artifacts). Journal: PREPARED → REF_UPDATED → ACCEPTED. |
| Decide | Requirements whose assertions give different outputs for the same input are contradictions (`decision/contradiction.ts`); the chosen requirement's `policyPatch` updates the verifier policy and integration re-runs. |

Cloudflare mapping (`wrangler.jsonc`): Worker (API + Clerk session-token auth), Durable Object + SQLite ledger (`durable-object.ts`), Workflow (`workflow.ts`), Queue (`queue.ts`), Container-backed integrator DO (`integrator.ts`), Artifacts binding (`artifacts/cloudflare.ts`), R2 (evidence, immutable per-commit builds), Workers AI through AI Gateway. Customer sign-in is Clerk (Cloudflare has no customer-identity product; Access is a workforce tool).

## Run locally

```bash
bun install
bun run typecheck && bun run lint && bun test && bun run build
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… bun run server   # Workers AI drives agents and repairs
bun run dev                                                     # UI on :5173
bun run demo                                                    # runs all three scenarios, prints measured results
```

Without Workers AI credentials the server and `demo` refuse to run scenarios (there is no mock fallback). The test suite uses a scripted stand-in for the **model only**; Git, verification, CAS and state are real.

## Verification status

**Local** (`bun test`, 16 tests, real Git/verification/CAS, model stubbed): text-conflict repair, clean-merge-but-broken detection and repair, contradiction → decision → implementation, protected-path and secret containment, forged verifier output, stale-base and evidence-mismatch refusal, duplicate/concurrent landings, cancellation, crash recovery, a second repository domain.

**Live on Cloudflare** (staging at flaregit.com behind Access, run on 2026-10-01 with `@cf/openai/gpt-oss-120b`):
- Bootstrap seeded a real Artifacts repo from an integrator container and initialized the Durable Object ledger.
- Act I: two agents in separate agent containers pushed to their own Artifacts forks; the integration Workflow found the Git conflict, the first candidate failed protected verification, a repair passed, the ref moved by compare-and-swap, the journal reads ACCEPTED and the exact build is served from `preview.flaregit.com`.
- Act II: the clean merge was detected as broken, repaired and accepted.
- Act III: paused with one question; the accepted head did not move.
- `/api` returns 401 without a valid Clerk session token (forged tokens too).
- A decision resolved through the cloud API triggered FlareGit to re-run, verify and accept the chosen behavior (third landing, journal ACCEPTED).
- Cancelling a task mid-run: the integration Workflow returned `not_started` and the accepted head did not move.
- Tenant isolation: each Access identity gets its own Durable Object ledger, Artifacts canonical repo and daily run quota (`MAX_SCENARIO_RUNS_PER_DAY`); a new identity starts uninitialized.

**Not yet exercised:** crash recovery of an interrupted cloud run (the landing lease expires after 20 minutes), AI Gateway rate limits (the `default` gateway is wired in; set its limit in the dashboard), billing/metering per tenant, and any real load.

Local run: `bun run demo` needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; without them it refuses to run (no mock fallback).

## Billing (Polar)

Pro-plan subscriptions are billed through Polar; Cloudflare has no subscription-billing product (Monetization Gateway is a closed-beta, per-request x402 service). FlareGit shares a Polar organization with other projects, so it is namespaced: customers are `flaregit:<projectId>`, usage events are `flaregit.*`, and the webhook ignores any event whose product is not `POLAR_PRODUCT_ID`.

Setup (secrets are never committed or put in the browser):
1. In Polar, create a **FlareGit Pro** subscription product and an Organization Access Token (`checkouts:write`, `events:write`); add a webhook endpoint `https://preview.flaregit.com/webhooks/polar` for subscription events.
2. Set `POLAR_PRODUCT_ID` in `wrangler.jsonc`, then `wrangler secret put POLAR_ACCESS_TOKEN` and `wrangler secret put POLAR_WEBHOOK_SECRET`. Use `POLAR_SERVER=sandbox` to test first.
3. Free plan: 3 model-backed runs/day per project; Pro: 100 (`FREE_RUNS_PER_DAY`, `PRO_RUNS_PER_DAY`).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Copyright 2026 Joe Simo.
