# Architecture and known limits

## Trust boundaries
- **Contributors / agents** write only to their task repository (scope `src/`). Protected paths (`.flaregit/`, `tests/`, `package.json`, …) are rejected in contributor commits and in model repairs.
- **Verifier** lives in platform code (`src/fixtures/*/checks.ts`), never in the candidate repo. Candidate code runs only in a child process with a scrubbed environment (`PATH`, `HOME`, `TMPDIR`, `NODE_ENV`), a 30 s timeout and an output cap. Results are returned on a line prefixed with a per-run nonce delivered over stdin before any candidate code is imported.
- **Acceptance** is deterministic code: evidence must be `passed`, match candidate commit and tree, accepted base, and policy version; the ref moves only if it still equals the verified base.
- **Customer auth**: Clerk session tokens (`Authorization: Bearer`) are verified in the Worker (signature via the instance JWKS, issuer, expiry, authorized party `azp`). The verified Clerk user id, hashed, is the tenant key. Production runs on `clerk.flaregit.com`; mail is sent from the verified domain (SPF/DKIM via the `clkmail`/`clk._domainkey` CNAMEs).
- **Secrets**: Artifacts tokens are short-lived and passed as `Authorization: Bearer` (`http.extraHeader` / `GIT_CONFIG_*` env), never in URLs. Workers AI is called from the Worker binding; the browser holds no credentials.

## Production flow (Cloudflare)
Queue (`git.push`, deduplicated by event id in the DO) → Durable Object ledger → Workflow: `claim-landing` (lease + frozen candidate) → `compose-repair-verify` (integrator container) → `prepare-publish` (DO validates invariants, journals PREPARED) → `cas-push-to-artifacts` → `complete-publish`. Builds of the verified commit are stored in R2 under the commit hash and served from `PREVIEW_ORIGIN`.

## Multi-repository platform

- One Durable Object per account (`account:<key>`: project list, billing, usage, API tokens), one per project (`project:<id>`: ledger, members, invites, activity, webhooks, deliveries), and one `global` (probes, global run cap).
- The Worker checks membership on every project route. API tokens (`fgt_...`) are stored hashed and cannot manage tokens or delete the account.
- Webhooks are written to the delivery log in the same transaction as the event, then delivered by a Queue consumer, so a failed ref update never emits and a delivered event is never lost. Targets must be public https hostnames.
- Stacked changes fork the parent change's fork; readiness is gated on the parent being accepted.
- The AI probe sends one tiny embedding request per tick, well inside the free Workers AI allowance.
- Builds in R2 expire after 30 days (lifecycle rule `expire-builds`); task forks are deleted after accept or cancel.

## Known gaps

- Diff highlighting is per line (highlight.js in the worker), so multi-line constructs such as block comments can be coloured incorrectly; a Tree-sitter WASM highlighter would fix that.
- Namespace ownership is per-account; DNS-based verification is roadmap.

## Known limits
- Candidate code and the checks share one process during verification; a hostile candidate can crash or time out the run (fails closed) and, in theory, tamper with in-process state. The container boundary in production is the real defense; run verification in a dedicated, network-restricted container for hostile contributors.
- Integrator containers have outbound internet (needed for git to Artifacts). They hold no secrets at the time candidate code runs, but candidate code could exfiltrate the candidate source.
- Contradiction detection needs structured assertions (`input` + `expectedOutput`) on requirements; free-text requirements are not compared.
- Only two-task landings are implemented.
- Container images must be digest-pinned and bound to the container application in `wrangler.jsonc` (`image: ./Dockerfile`); `deploy` builds and pushes them.
- Previews are served from a separate origin (`PREVIEW_ORIGIN`) so builds cannot reach the app origin or its cookies.
