# FlareGit

A Git collaboration platform on Cloudflare Workers and Artifacts for humans and AI agents working at the same time. Each change lives in its own Artifacts fork and is pushed with ordinary `git`. FlareGit composes ready changes onto the accepted head, repairs what it safely can, verifies the exact candidate commit, waits for a human to accept that commit, and lands only that commit with a compare-and-swap ref update.

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

**Recovery.** Agents resume from their already pushed branch. Publication rehydrates from the stored candidate ref, so a crashed step does not need the original workspace. Webhook deliveries are written in the same transaction as the event (transactional outbox) and a Durable Object alarm re-sends anything not yet queued.

## Platform features

- Issues, with changes linkable to an issue (`work --issue N`).
- Review conversations on changes and candidates, including line comments (`comment ... --path P --line N`).
- Profiles and a people tab; namespace handles.
- Notification inbox.
- API tokens: `full`, `read` or `write` scope, optionally pinned to one repo and expiring. A token can mint narrower tokens (read/write, TTL up to 24 h) via `flaregit auth token`.
- Signed private previews: builds of accepted commits in R2, opened through HMAC-signed, expiring links on a separate origin.
- Webhooks: Standard Webhooks signature, ordered per project, retried with backoff, manual replay, `webhook-sequence` and a stable `webhook-id` for de-duplication.
- Status page: `/status` and `/status.json`, probed by a 5-minute cron.
- Workflow outcomes are counted by unique agent and integration instance, with terminal results and unresolved starts separated. Availability checks state their scope; a repository-list probe is not evidence of a successful clone, merge or agent run.
- Custom domain verification through a DNS TXT record at `_flaregit.<domain>`; a verified claim displaces unverified ones.
- Diff viewer (virtualized, keyboard driven) and a terminal reviewer (`flaregit review`).
- CLI (`bun run build:cli` produces `dist-cli/flaregit`; JSON output, token auth). `bun cli/flaregit.ts --help` lists every command.
- Optional Pro billing through Polar.

### Abuse and impersonation reports

Anyone signed in can file a report (footer → Report abuse). Reports go to a human queue at `#/operator` for the accounts listed in `OPERATOR_ACCOUNTS` (wrangler.jsonc); each is closed only with a written resolution that the reporter sees. The number of open reports and the age of the oldest are public on `/status`.

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
bun install
bunx wrangler login
bunx wrangler r2 bucket create flaregit-evidence
bunx wrangler queues create flaregit-integration-events
```

Edit `wrangler.jsonc`:
- `vars`: `CLERK_ISSUER`, `CLERK_PUBLISHABLE_KEY`, `CLERK_AUTHORIZED_PARTIES` (comma separated; must include the exact origin you serve the UI from, e.g. your `workers.dev` URL or custom domain), `PREVIEW_ORIGIN` (a separate hostname that serves previews), `AI_GATEWAY_ID`, `CANONICAL_REPO`, run caps (`GLOBAL_RUNS_PER_DAY`, `FREE_RUNS_PER_DAY`, `PRO_RUNS_PER_DAY`, `RUNS_ENABLED`). For billing: `POLAR_SERVER` (`sandbox` or `production`) and `POLAR_PRODUCT_ID`.
- `routes`: replace `flaregit.com` / `preview.flaregit.com` with your own zones, or remove them and use `workers.dev`.
- `artifacts[0].namespace` if you use a different Artifacts namespace.

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

```bash
bun install
bun run typecheck && bun run lint && bun test
```

UI: `bun run dev` starts Vite on :5173 and proxies `/api`, `/auth-config`, `/status.json` and `/webhooks` to a real Worker at `FLAREGIT_API` (default `http://127.0.0.1:8787`, i.e. `bunx wrangler dev`; see `vite.config.ts`).

Core engine without the cloud: `bun test` runs the integration engine with real Git, verification and CAS, with a scripted stand-in for the model only. `bun run demo` runs the three ticket-booking scenarios (text conflict, clean-but-broken merge, contradiction) against a local runtime with Workers AI as the model; it requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (optional `CLOUDFLARE_AI_GATEWAY`, `FLAREGIT_AI_MODEL`) and refuses to run without them.

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

The race test runs 20 contending branches by default (4 workers). The 500-branch run passed on an Apple-silicon laptop in about 14 minutes (local bare repository, real `git push --force-with-lease`; it tests the landing protocol, not Artifacts throughput). Full run:

```bash
RACE_BRANCHES=500 RACE_TIMEOUT_MS=7200000 bun test tests/landing-race.test.ts
```

## Known limits

- Imports are public HTTPS Git URLs, cloned once with depth 200; there is no ongoing sync from GitHub. Mirroring the other way (FlareGit to GitHub, one-way, after each landing, never force-pushed) is optional per repository under Settings; FlareGit stays the source of truth.
- One landing at a time per project; the landing lease is 20 minutes.
- A candidate waits up to 7 days for review, then goes stale and must be re-run.
- At most 8 changes per integration.
- Diff time-to-interactive is network and auth bound: about 0.8 to 1 s measured in Safari; scrolling holds 60 fps at 3,000 to 8,000 px/s, with at most about 100 DOM rows rendered for a 12k-line diff.
- Syntax highlighting is per line, so multi-line constructs can be colored incorrectly.
- Contradiction detection needs structured assertions on requirements.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for trust boundaries and the landing protocol.

## License

Apache-2.0. See [LICENSE](LICENSE).
