# Architecture

## Components

Worker (`src/server/worker.ts`: API, auth, previews, status, Polar webhook) · `RepositoryController` Durable Object with SQLite (`durable-object.ts`) · Workflows: integration (`workflow.ts`), agent (`agent-workflow.ts`), scenario · Queue `flaregit-integration-events` (`queue.ts`) · container-backed `IntegratorSandbox` and `AgentSandbox` · Artifacts (Git storage) · R2 `flaregit-evidence` (evidence and builds) · Workers AI via AI Gateway · Clerk (customer sign-in) · 5-minute cron (status probes).

## Trust boundaries

- **Browser and CLI** hold only a Clerk session token or a FlareGit API token. Clerk tokens are verified in the Worker (JWKS signature, issuer, expiry, `azp` in `CLERK_AUTHORIZED_PARTIES`). No Cloudflare or model credentials leave the Worker.
- **Contributors and agents** write only to their own change fork, using short-lived Artifacts tokens passed as an `Authorization` header, never in URLs. Protected paths are rejected in contributor commits and model repairs.
- **Verifier** checks live in platform code, not in the candidate repo. Candidate code runs in a scrubbed child process with a timeout and output cap; results are tagged with a per-run nonce.
- **Acceptance** is deterministic code in the Durable Object, after a human accepts the candidate.
- **Previews** are served by stateless repository Workers on unique, operator-registered origins outside the authentication site. Signed path capabilities authorize only one repository and commit without third-party cookies.
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

Builds are stored in R2 under `builds/<projectId>/<commit>`. Only members can mint an expiring HMAC preview capability. The production Worker retains the signing secret, authorization and storage access; its `PreviewAssetBroker` service entrypoint validates each capability and serves only the requested repository's build assets. The stateless child Worker receives only `REPOSITORY_ID` and the `ASSET_BROKER` service binding. Candidate HTML never executes on the application origin or a shared repository preview origin. The old shared `/preview/*` route fails closed.

### Provision a repository origin

Use the installed Wrangler dependency (4.135.0 or later) and a Cloudflare account with a workers.dev subdomain. This is an operator procedure; checking in the template does not provision a remote origin.

1. Deploy the reviewed production Worker with the `PreviewAssetBroker` export before provisioning a child. Keep its signing secret and other production resources on that Worker. For an existing installation that must retain previews during migration, first deploy an additive broker-only release that keeps the existing link minting and serving handlers. Provision and verify the children, then deploy the complete isolation release with their registered mapping in one cutover. Deploying the complete release with an empty mapping immediately retires shared links and reports previews unavailable; it does not preserve existing preview availability. The old isolation weakness remains until cutover, and old shared links fail closed afterward.
2. Copy `wrangler.preview.template.jsonc` to a repository-specific file **beside the template**, for example `wrangler.preview.p0123456789ab.jsonc`. Replace `name` with a unique Worker name reserved for that repository, and replace **both** `REPOSITORY_ID` values with its exact project ID. Keep `ASSET_BROKER.service` set to the actual production Worker name (`flaregit` here) and `entrypoint` set to `PreviewAssetBroker`.
3. Run from the checkout root:

   ```sh
   bunx wrangler preview --config wrangler.preview.p0123456789ab.jsonc --name repository --ignore-base-config --json
   ```

   `--ignore-base-config` prevents Base configuration from being copied when **creating a new Preview**. Use a fresh, dedicated Worker name and Preview resource for each repository. The flag does not reset an existing Preview or prove that previous dashboard settings and secrets were removed. Retain only this template's variable and service binding; do not import production secrets, Durable Objects, Containers, R2, queues, workflows, AI, assets or application routes. Service bindings from native Previews call the target Worker's production deployment, which is intentional for the narrow broker.
4. Capture the **actual URL returned by Cloudflare**. Before registering the origin, inspect the remote Preview's variables, bindings and secret names in the Cloudflare dashboard or documented read-only API. Confirm the exact repository ID, only the `ASSET_BROKER` binding targeting production `flaregit#PreviewAssetBroker`, and **no secrets or other bindings**. Reject registration if any extra binding or secret exists; resolve it through the operator before proceeding. A checked-in config or successful deployment alone is not proof of the remote resource's state. Use the returned Preview URL's HTTPS origin (without path, query or fragment), rather than constructing a hostname. Reserve each origin for exactly one repository; never repoint that origin to another repository. Native Previews also return a unique deployment URL, but link minting uses the one origin registered for the repository.
5. Add that repository and returned origin to the trusted production `REPOSITORY_PREVIEW_ORIGINS` JSON object while preserving existing entries, then deploy the reviewed main config. Its shape is `{ "p0123456789ab": "https://<actual-returned-host>.workers.dev" }`. The bracketed host is illustrative and must never be deployed. Registration belongs to the operator; a repository member or candidate cannot choose it. Until registered, preview minting fails closed.
6. Mint a fresh preview through the member API. Verify its host exactly matches the registered origin, its assets load, an unsigned request fails, and changing the commit or signature in the signed path fails. Repeat with a second repository and confirm the browser origins differ. A capability minted for the first repository must fail on the second child's origin. Confirm `/preview/*` on the application and old shared host cannot serve candidate HTML.

To update a child, inspect its remote variables, bindings and secret names first and refuse the update if there are unexpected resources or secrets. Then repeat the native Preview command with its repository-specific config and Preview name and inspect the resulting remote configuration again before treating it as ready. Do not assume `--ignore-base-config` cleans an existing Preview. The Preview URL follows the latest deployment; preserve that repository's origin assignment. When retiring a child, remove its trusted origin mapping before deleting its native Preview with `bunx wrangler preview delete --config <repository-config> --name repository`; outstanding capabilities then fail closed. Never recycle a retired hostname for a different repository, because browser state may survive deployment deletion.

The native [`wrangler preview` command](https://developers.cloudflare.com/workers/wrangler/commands/workers/#preview), [Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/) and [resource isolation rules](https://developers.cloudflare.com/workers/previews/resources/#service-bindings) define this provisioning path. Native child configs are separate from the production `wrangler.jsonc` so provisioning cannot duplicate the application's stateful resources.

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
