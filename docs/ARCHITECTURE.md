# Architecture

## Components

Worker (`src/server/worker.ts`: API, auth, previews, status, Polar webhook) · `RepositoryController` Durable Object with SQLite (`durable-object.ts`) · Workflows: integration (`workflow.ts`), agent (`agent-workflow.ts`), scenario · Queue `flaregit-integration-events` (`queue.ts`) · container-backed `IntegratorSandbox` and `AgentSandbox` · Artifacts (Git storage) · R2 `flaregit-evidence` (evidence and builds) · Workers AI via AI Gateway · Clerk (customer sign-in) · 5-minute cron (status probes).

## Trust boundaries

- **Browser and CLI** hold only a Clerk session token or a FlareGit API token. Clerk tokens are verified in the Worker (JWKS signature, issuer, expiry, `azp` in `CLERK_AUTHORIZED_PARTIES`). No Cloudflare or model credentials leave the Worker.
- **Contributors and agents** write only to their own change fork, using short-lived Artifacts tokens passed as an `Authorization` header, never in URLs. Protected paths are rejected in contributor commits and model repairs.
- **Verifier** checks live in platform code, not in the candidate repo. Candidate code runs in a scrubbed child process with a timeout and output cap; results are tagged with a per-run nonce.
- **Acceptance** is deterministic code in the Durable Object, after a human accepts the candidate.
- **Previews** are served from `PREVIEW_ORIGIN`, a different origin from the app, so a build cannot read app cookies.
- **Git inputs** (refs, refspecs, header values) pass a whitelist sanitizer before reaching a shell.

## Data model (Durable Object instances)

- `account:<key>`: projects, plan and usage, API tokens (hashed), profile/handle, notification inbox.
- `project:<id>`: landing ledger (tasks, candidates, evidence, journal, lease), members and invites, issues, comments, activity, webhooks with outbox and delivery log, domain claims.
- `global`: status probes, global run cap, handle and domain registries.

## Landing protocol

1. `claim-landing`: acquire the single project lease (20 min) and freeze a candidate against the accepted head (1–8 changes).
2. `compose-repair-verify` in the integrator container; the candidate commit is pushed to `refs/flaregit/candidates/<id>`.
3. `waitForEvent("human-review")`, timeout 7 days. Reject → failed; timeout → stale.
4. `prepare-publish`: DO checks evidence is `passed` and matches candidate commit, tree, expected base and policy version; journals PREPARED.
5. CAS push from a fresh workspace that fetches the stored candidate ref: `git push --force-with-lease=<branch>:<expectedBase>`.
6. `complete-publish`: journal ACCEPTED, release lease, write webhook outbox rows; then rebase stacked children.

Invariants: only a commit that was verified and human-accepted can become the branch head; the branch moves only if it still equals the verified base (otherwise the candidate goes stale); one landing per project at a time; duplicate events and replays are idempotent in the ledger; publication can be resumed from the stored candidate ref alone.

## Outbox and alarm

Webhook delivery rows are written in the same storage transaction as the state change, so an event cannot exist without its deliveries and vice versa. Rows are then sent to the Queue; the DO arms an alarm that re-sends anything still pending (2 min after write, then every 5 min while pending). Deliveries carry `webhook-id` (stable across retries), `webhook-sequence` and a Standard Webhooks signature. Targets must be public HTTPS hostnames.

## Preview isolation

Builds are stored in R2 under `builds/<projectId>/<commit>`. A preview link is `HMAC-SHA256(projectId.commit.exp)` with the `PREVIEW_SIGNING_KEY` secret; only members can mint it, it expires (default 1 h), and a commit hash alone opens nothing.

## Token scopes

- `full`: everything a member can do via API, including minting tokens; account management and token listing stay in the web app.
- `write`: read and write project routes; no administration.
- `read`: `GET` only, plus `clone`.
- A token may be pinned to one repo and may expire. Tokens minted from a token must be `read` or `write` with a TTL of at most 24 h.

## Container naming

Containers are addressed by name, so state never crosses repositories: `bootstrap-<projectId>` for imports and seeding, `<projectId>-<id>` for integration runs, `agent-<projectId>-<taskId>` for agents.

## Known limits

- Verification runs candidate code and checks in one process inside the container; a hostile candidate can fail the run (fails closed). Containers have outbound internet for Git, so candidate code could exfiltrate candidate source.
- Imports: public HTTPS URLs, depth 200, no ongoing mirror.
- Landing lease 20 min; review wait 7 days; at most 8 changes per integration.
- Contradiction detection needs structured assertions (`input` + `expectedOutput`).
- Per-line syntax highlighting.
