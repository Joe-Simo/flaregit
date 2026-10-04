# FlareGit

A Git collaboration platform on Cloudflare Workers and Artifacts for humans and AI agents working at the same time. Each change lives in its own Artifacts fork and is pushed with ordinary `git`. FlareGit composes ready changes onto the accepted head, repairs what it safely can, verifies the exact candidate commit, waits for a human to accept that commit, and lands only that commit with a compare-and-swap ref update.

The current collaboration and interface improvements are on [`codex/docs-community-and-delivery`](https://github.com/Joe-Simo/flaregit/tree/codex/docs-community-and-delivery), under review in [PR #2](https://github.com/Joe-Simo/flaregit/pull/2). To reproduce this branch before the PR is merged:

```bash
git clone --branch codex/docs-community-and-delivery https://github.com/Joe-Simo/flaregit.git
cd flaregit
```

Cloudflare deployment messages record the exact source commit; check out that SHA to reproduce a particular deployment.

## Workflow

1. **Changes.** `flaregit work <repo> "<goal>"` (or the web app) creates a change: a fork of the canonical repo with its own branch. Humans push to it; agents (`change new --agent`) run in an agent container and push to the same kind of fork.
2. **Integration.** One to eight ready changes are integrated together. The Workflow claims the landing lease, freezes a candidate against the current accepted head, and composes the changes with native `git merge` in an integrator container.
3. **Verification.** The candidate is checked (platform checks for the demo repo, your own test command for imported repos). Model repairs are confined to the change scope and cannot touch protected paths.
4. **Human review.** The verified candidate is pushed to `refs/flaregit/candidates/<id>` and the Workflow waits for an accept or reject (`flaregit accept|reject <repo> <candidate>` or the UI). What is reviewed is the exact commit that will land.
5. **Durable landing.** On accept, the Durable Object validates the candidate (evidence, commit, tree, base, policy) and journals PREPARED; a fresh workspace fetches the stored candidate ref and pushes it with `--force-with-lease` against the expected base; the ledger is completed.
6. **Webhooks.** Events are emitted only after the ref update commits.

**Conflicts.** Native Git detects text conflicts; model repair attempts and resulting changes are included in candidate review. Clean merges that break behavior are caught by verification and repaired or blocked; nothing failing is published. Requirements that contradict each other pause integration with one product question; the accepted head does not move until it is answered.

**Stale bases.** If the branch moved since the candidate was frozen, the CAS push is refused; the candidate is marked stale and the integration must be re-run.

**Stacks.** A change can be stacked on another (`work ... --on <change>`). It cannot be marked ready until its parent is accepted; after a landing, downstream changes are rebased automatically.

Owners can inspect saved branch updates in Integration and recover their base/dependency records when the workspace already contains the exact saved result. They can explicitly apply a protected saved result when the branch still contains its original commit. Recovery verifies protected Git refs, refuses newer work or active agents, and records the current recovery owner separately from original attribution. A durable attempt tracks execution and credential cleanup; uncertain outcomes remain visible and prevent unsafe replacement attempts. This requires the configured rebase-resume Workflow and funded execution capacity.

Prepared publications receive bounded, read-only Git verification before repository metadata can be reconciled. Missing or inconclusive proof keeps publication pending. Owners can explicitly rebuild tracked failed or incomplete candidates from their frozen contributions. Recorded native command permits, confirmed shutdown, and fresh branch proofs guard reassignment; the original candidate, reviews and conversations remain intact, and the successor requires fresh approval. A pre-dispatch attempt can be explicitly abandoned only after execution cleanup is proved. Historical runs without trustworthy runtime records remain held for operator recovery; their coverage is never invented retroactively.

**Recovery.** Agents resume from their already pushed branch. Publication rehydrates from the stored candidate ref, so a crashed step does not need the original workspace. Webhook deliveries are written in the same transaction as the event (transactional outbox) and a Durable Object alarm re-sends anything not yet queued.

Contributor workspaces remain after acceptance and cancellation, but their branches can advance. New integrations preserve the recorded input commit and base with verified Git references in the canonical repository before composing a candidate. Saved-input review uses those exact commits. Legacy inputs without a preservation receipt still depend on their original workspace; missing history is reported rather than replaced with a newer checkpoint.

## Platform features

- Issues, with changes linkable to an issue (`work --issue N`).
- Review conversations on changes and candidates, including line comments (`comment ... --path P --line N`).
- Profiles and a people tab; namespace handles.
- Notification inbox.
- API tokens: `full`, `read` or `write` scope, optionally pinned to one repo and expiring. A token can mint narrower tokens (read/write, TTL up to 24 h) via `flaregit auth token`.
- Signed private previews: builds of accepted commits in R2, opened through HMAC-signed, expiring links on a separate origin.
- Webhooks: Standard Webhooks signature, later events wait while an earlier delivery to the same webhook is pending; failed deliveries remain visible and permit later events, retries with backoff, manual replay, `webhook-sequence` and a stable `webhook-id` for de-duplication.
- Status page: `/status` and `/status.json`, probed by a 5-minute cron.
- Workflow outcomes are counted by unique agent and integration instance, with terminal results and unresolved starts separated. Availability checks state their scope; a repository-list probe is not evidence of a successful clone, merge or agent run.
- Custom domain verification through a DNS TXT record at `_flaregit.<domain>`; a verified claim displaces unverified ones.
- Diff viewer (virtualized, keyboard driven) and a terminal reviewer (`flaregit review`).
- CLI (`bun run build:cli` produces `dist-cli/flaregit`; JSON output, token auth). `bun cli/flaregit.ts --help` lists every command.
- Optional Pro billing through Polar.

### Abuse and impersonation reports

Anyone signed in can file a report (footer → Report abuse). Reports go to a human queue at `#/operator` for the accounts listed in `OPERATOR_ACCOUNTS` (wrangler.jsonc); each is closed only with a written resolution that the reporter sees. The number of open reports and the age of the oldest are public on `/status`.

### Private Git recovery

In repository Settings, an owner can prepare a Git bundle from a recorded accepted commit, including historical accepted commits. Preparation uses funded native compute. A prepared bundle preserves that commit's full Git ancestry and original attribution; private candidate objects and unrelated refs are excluded. Current authorized members can download cached bundles even when the Git-operation budget is exhausted, without allocating a VM. Account, membership, token, and repository lifecycle authority are rechecked during delivery.

The prototype reserves at most two cached bundles per account and eight globally, with a 512 MiB maximum per bundle. The browser downloads bundles up to 16 MiB. Larger bundles use the streaming CLI, authenticated with your existing personal API token configuration or `FLAREGIT_TOKEN` in your local environment:

```bash
bun cli/flaregit.ts recovery download <repository-id> <snapshot-id> --output repository.bundle
git clone --branch main repository.bundle restored-repository
```

The CLI verifies the complete byte count and SHA-256 digest before publishing the output file, and refuses to overwrite an existing destination. An interrupted preparation resumes with its saved identity. Owners can permanently remove a cached copy with exact confirmation; this preserves repository history. Unknown workflow, multipart-upload, or deletion outcomes retain their storage reservation until reconciled.

## Self-host on your Cloudflare account

Requirements:
- Workers Paid plan (Containers, Durable Objects with SQLite, Workflows, Queues).
- Access to Cloudflare Artifacts (binding namespace `flaregit-default`).
- An AI Gateway (id goes in `AI_GATEWAY_ID`; default `default`). Workers AI is used through the `AI` binding.
- A Clerk application (issuer URL and publishable key).
- Docker running locally: `wrangler deploy` builds the container image from `./Dockerfile`.
- Bun.

Steps:

```bash
bun install --frozen-lockfile
bunx wrangler login
bunx wrangler r2 bucket create flaregit-evidence
bunx wrangler queues create flaregit-integration-events
```

Edit `wrangler.jsonc`:
- `vars`: `CLERK_ISSUER`, `CLERK_PUBLISHABLE_KEY`, `CLERK_AUTHORIZED_PARTIES` (comma separated; must include the exact origin you serve the UI from, e.g. your `workers.dev` URL or custom domain), `REPOSITORY_PREVIEW_ORIGINS` (trusted JSON mapping from repository IDs to unique stateless preview Worker origins; see [provisioning](docs/ARCHITECTURE.md#provision-a-repository-origin)), `AI_GATEWAY_ID`, `CANONICAL_REPO`, run caps (`GLOBAL_RUNS_PER_DAY`, `FREE_RUNS_PER_DAY`, `PRO_RUNS_PER_DAY`, `RUNS_ENABLED`). For billing: `POLAR_SERVER` (`sandbox` or `production`) and `POLAR_PRODUCT_ID`.
- `routes`: replace `flaregit.com` with your application zone, or use `workers.dev`. The legacy `preview.flaregit.com` route only rejects old preview links; retire it after migration. Provision repository preview origins separately; never run contributor previews on the authenticated application site.
- `artifacts[0].namespace` if you use a different Artifacts namespace.
- Set `ARTIFACT_STORAGE_NAMESPACE` to that same namespace. `ARTIFACT_STORAGE_GLOBAL_SLOTS` and `ARTIFACT_STORAGE_ACCOUNT_SLOTS` bound conservative retained-repository capacity, including workspaces. Allocation requires a complete stable inventory and reserves the provider's 1 GB maximum per named repository; this is not measured usage. Unknown allocation/deletion outcomes remain recorded for recovery, and same-day deletion does not erase daily storage liability.
- Set `MANAGED_GLOBAL_MONTHLY_USD_MICROS` and `MANAGED_ACCOUNT_MONTHLY_USD_MICROS` for managed execution and native preview/deployment compute, and `CORE_GIT_GLOBAL_MONTHLY_USD_MICROS` / `CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS` for Git transport. Values are integer USD micros; missing configuration refuses covered execution. Daily run counters are admission limits, not purchased compute allowances. These controls do not cap the complete Cloudflare invoice or other providers' costs.
- New preview copies reserve retained bytes before upload: `PREVIEW_STORAGE_GLOBAL_BYTES` / `PREVIEW_STORAGE_ACCOUNT_BYTES` default to 512 MiB / 128 MiB. Separate evidence-copy limits, `EVIDENCE_STORAGE_GLOBAL_BYTES` / `EVIDENCE_STORAGE_ACCOUNT_BYTES`, default to 64 MiB / 16 MiB. These pools cover new tracked copies, not pre-existing bucket contents or request charges. Funding refusal leaves Git review available. After an operator restores allowance, owner retry rechecks the saved scope before starting compute.
- Explicit repository/account deletion retains metadata and reservations until tracked writes and provider absence are confirmed. Repositories created before dispatch tracking remain pending provider reconciliation; an empty listing alone does not complete their deletion. No automatic history or cache garbage collection is enabled.
- Keep `PAID_CHECKOUT_ENABLED=false` until the paid offering and provider price have been verified. Existing billing remains manageable; Free collaboration and private repositories do not require checkout.

Secrets:

```bash
bunx wrangler secret put PREVIEW_SIGNING_KEY    # required: random string, HMAC key for preview links
bunx wrangler secret put POLAR_ACCESS_TOKEN     # optional: Polar billing
bunx wrangler secret put POLAR_WEBHOOK_SECRET   # optional: Polar webhook at /webhooks/polar
```

Deploy:

```bash
bun run build && bunx wrangler deploy
```

## Develop locally

Clone the [public Apache-2.0 repository](https://github.com/Joe-Simo/flaregit), then run these commands from its root. Git and Bun are required for the local controller and proof runner. Cloudflare credentials are needed only for the live model demo or hosted deployment.

The hosted prototype source is on `codex/docs-community-and-delivery`. Select that branch when cloning:

```bash
git clone --branch codex/docs-community-and-delivery https://github.com/Joe-Simo/flaregit.git
cd flaregit
```

```bash
bun install --frozen-lockfile
bun run typecheck && bun run lint && bun test
```

UI: `bun run dev` uses Bun HTML imports and `Bun.serve` on loopback port 5173. It proxies the API, auth configuration, status and webhook requests to a real Worker at `FLAREGIT_API` (default `http://127.0.0.1:8787`, i.e. `bunx wrangler dev`; see `src/tooling/dev-web.ts`). `bun run build` emits the production HTML, styles, JavaScript, legal pages, and a separate compiled diff worker into `dist`. Tailwind 3 styling is preserved through PostCSS; client environment inlining is disabled.

Core engine without the cloud: `bun test` runs the integration engine with real Git, verification and CAS, with a scripted stand-in for the model only. `bun run demo` runs the three ticket-booking scenarios (text conflict, clean-but-broken merge, contradiction) against a local runtime with Workers AI as the model; it requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (optional `CLOUDFLARE_AI_GATEWAY`, `FLAREGIT_AI_MODEL`) and refuses to run without them. Contributor verification and preview builds additionally require secure Linux UID isolation (the supplied cloud container); the local live-model demo fails closed on an ordinary macOS process. Do not use the trusted test-harness mode for real model output or imported repositories.

`bun run demo:proof` runs a standalone real-Git protocol illustration with deterministic scripted contributors, no model or cloud credentials, and retained commit/journal receipts. It demonstrates parallel isolated clones, conflict, stale push refusal, and reconstruction after workspace deletion; it does not exercise the hosted product or represent real AI agents.

The local demo is a scenario harness, not the hosted multi-repository product. Its agents make real concurrent model calls and Git commits, but it does not demonstrate the hosted human approval flow or competition interruption-recovery requirement. See [docs/DEMO.md](docs/DEMO.md) for the recording plan and outstanding evidence gates.

`bun run server` (`src/server/local.ts`) is a separate single-project scenario server on port 3000; it does not serve the multi-repository API the UI uses.

## Testing

| File | Covers |
|---|---|
| `tests/platform.test.ts` | Act I text conflict repair, Act II clean-merge-but-broken detection and repair (and blocking when repair fails), Act III contradiction and decision, protected-path containment, forged verifier output, publication safety (stale base, evidence mismatch, duplicate landings, crash recovery). |
| `tests/custom-repo.test.ts` | Imported repos verified by the customer's own test command; contributors cannot weaken protected tests. |
| `tests/second-repo.test.ts` | A second domain repo with conflicting agents and protected checks. |
| `tests/landing-race.test.ts` | Concurrent landings onto one branch: no lost refs, orphan commits or desync. |
| `tests/platform-units.test.ts` | Webhook URL validation, repo policy settings, tree diffing. |
| `tests/sanitize.test.ts` | Git ref, refspec and header sanitization, including a 20,000-string fuzz. |
| `tests/dns.test.ts` | Domain normalization, TXT record construction and parsing, resolver failures. |
| `tests/artifacts.test.ts` | Local Artifacts client: repo creation, tokens, forks. |
| `tests/retained-git-input.test.ts`, `tests/rebase-workflow-native.test.ts` | Real local Git preservation through garbage collection and production rebase orchestration after lost push or checkpoint acknowledgements. These tests do not prove hosted Artifacts behavior. |
| `tests/retained-input-native.test.ts`, `tests/repository-read-http.test.ts` | Native Worker authorization, exact rebase replay, bounded credential cleanup, and saved-input reads without substituting newer work. Provider responses are synthetic. |

The race test runs 20 contending branches by default (4 workers), using a local bare repository and real `git push --force-with-lease`. It tests the landing protocol, not Artifacts throughput. An optional larger run is available; this release does not claim a measured production throughput or timing result:

```bash
RACE_BRANCHES=500 RACE_TIMEOUT_MS=7200000 bun test tests/landing-race.test.ts
```

## Known limits

- Imports use public HTTPS Git URLs without requesting a shallow depth. Provider readiness alone does not prove complete history. There is no ongoing sync from GitHub. Optional one-way mirroring publishes accepted FlareGit commits to GitHub without force-pushing; FlareGit stays the source of truth.
- Owner-requested history inspection supports public github.com sources and compares only the saved imported branch’s reachable commit metadata. New inspections checkpoint source and imported ancestry in SQLite, with up to 25,000 commits per side and an 8 MiB serialized inspection envelope; either bound can pause an incomplete comparison. Resume keeps the same pinned head and requires confirmed termination and workspace shutdown. Blobs, tags and unselected refs remain outside this receipt. Legacy untracked attempts are not silently replaced.
- One landing at a time per project; the landing lease is 20 minutes.
- A candidate waits up to 7 days for review, then goes stale and must be re-run.
- At most 8 changes per integration.
- Tree diffs retain the 5,000 changed-file ceiling, with a 16 MiB result envelope and bounded provider work. Large or unfunded inspections fail explicitly rather than presenting partial coordination evidence as complete. Repository browsing has a protected allowance inside the configured Git-operation budget; metadata cache hits still recheck current access.
- Individual preview assets are limited to 16 MiB. Binary images and fonts are preserved as bytes; oversized or linked output assets fail explicitly.
- The diff renderer virtualizes visible rows and computes diffs in a separate browser worker. Current release verification covers worker execution and responsive signed-out layouts; authenticated large-repository latency and frame-rate measurements remain an acceptance gate.
- Syntax highlighting is per line, so multi-line constructs can be colored incorrectly.
- Contradiction detection needs structured assertions on requirements.

`bun run demo:hosted prepare|status|integrate|verify <receipt.json>` captures real hosted test-repository observations using an environment-only account token. The runner requires explicit human review before fresh-clone verification. Registered workflows can be inspected, paused, and resumed with `flaregit workflow status|pause|resume`; see [docs/DEMO.md](docs/DEMO.md) for exact secure setup, recovery limits, and recording gates.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for trust boundaries and the landing protocol.

## License

Apache-2.0. See [LICENSE](LICENSE).

Hosted checks and previews execute contributor code under a separate Linux UID. `NODE_ENV=test` permits same-user execution only for explicitly trusted fixtures; those receipts are not production isolation evidence. Earlier recorded local AI results describe that historical run and do not prove the newer isolation boundary. An authenticated browser can exercise owned repositories without a CLI token; command-line acceptance still requires its own account token.

Bring-your-own tools can already work through ordinary Git in a FlareGit change workspace created by `flaregit work`; review and integration remain in FlareGit. External provider names are attribution metadata, not evidence that a vendor account was connected or an agent ran. Registered external check/review reporting has an authenticated callback API and CLI; hosted service delivery still requires verification against the deployed API. The built-in `--agent` option runs FlareGit's own agent workflow; it does not log in to an external vendor.

A registered external service can submit a strictly validated check or automated comment using `bun cli/flaregit.ts report <repository-id> --service <connection-id> --file <report.json> --event <stable-event-id>`. Load the owner-issued signing secret as `FLAREGIT_CONNECTION_SECRET` in the local service environment; never pass it as an argument, commit it, or put it in client code. The CLI signs exact request bytes and sends no human bearer token. Retain the printed event ID and unchanged report contents for retries; a new status update uses a new event ID. Check reports bind candidate/commit/tree/policy and a maintainer-registered run. Automated comments cannot approve review or merge. `bun cli/flaregit.ts service-candidate <repository-id> <candidate-id> --service <connection-id> --commit <exact-40-character-SHA>` separately reads an HMAC-signed metadata snapshot using the same environment secret. It returns candidate commit/tree, policy version and only that service's assigned checks; it grants no repository clone token or source-file access. Each read uses a fresh nonce, and an inactive/revoked connection is denied.

The [seven-minute recording runbook](docs/DEMO.md) separates real hosted observations from local fixtures and lists the remaining recording evidence gates. Reconfirm the exercise candidate and full accepted SHA before filming; an awaiting-review candidate is not an accepted landing.
