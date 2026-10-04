# FlareGit — single execution tracker

Owner-selected finite release plan, reconciled 4 October 2026 from
`FLAREGIT_FINISH_ROADMAP.md`. This file replaces the prior broad milestone
checklist while preserving its evidence below. No competing tracker is created.

**Product:** Work in parallel. Integration happens automatically.

**Handoff:** C | C00 (root), C02 next (verify_git_diagnostics) | source
`c564f730b5c962cf699133e4a0bb4ce7435c243f` plus uncommitted invitation-return delta |
deployment version `ac98c981-da52-4cb7-84b0-c593c899e43a` freshly observed; operator source record `34a1e7a2c67c006243766462deda9578735328df` |
CI `37215340488` passed; exact committed-source local suite 1,274 pass / 1 skip / 0 fail;
invitation-return snapshot 1,277 pass / 1 skip / 0 fail |
C01 scoped exceptions approved; C02 hosted trust/egress gates open |
finish source/deployment/receipt reconciliation and start C02 without changing providers.

No tickets are DONE. Source-tested, deployed, and hosted-verified are separate.
No deployment, public release, billing activation, spending increase, identity
migration, destructive action, or legal acceptance is authorized by this tracker.

## Active ticket ledger

| Ticket | Status | Primary owner | Next acceptance action |
| --- | --- | --- | --- |
| C00 — freeze the current truth | IMPLEMENTED | root | Finish fresh deployment/version and receipt reconciliation. |
| C01 — settle identity and infrastructure exceptions | IMPLEMENTED | root | Scoped provider exceptions approved; identity and optional-service failure journeys remain to verify. Payments stay disabled. |
| C02 — replace assumed sandbox trust with demonstrated boundaries | IMPLEMENTED | verify_git_diagnostics | Separate trusted verification/publisher and restrict egress; actual Cloudflare canaries required. |
| C03 — prove exact publication and recovery on the deployed snapshot | IMPLEMENTED | unassigned until dependencies close | Reconcile existing publication evidence, then run affected hosted cases after C02. |
| C04 — restore the automatic-integration promise without removing reviews | NOT_STARTED | unassigned until dependencies close | Implement explicit versioned review-required / verified-auto-accept policy after C03. |
| C05 — close the ordinary developer's first project journey | IMPLEMENTED | unassigned until dependencies close | Hosted two-account journey and isolated-preview onboarding remain open. |
| C06 — finish the core collaboration slice already present | IMPLEMENTED | unassigned until dependencies close | Execute the defined issue-to-review-to-accept journey after C05. |
| C07 — connect tags and releases end to end | IMPLEMENTED | unassigned until dependencies close | Finish existing HTTP/DTO/navigation wiring; prove a hosted tag/release journey. |
| C08 — make external delivery and migration coverage truthful | IMPLEMENTED | unassigned until dependencies close | Reconcile existing signed receiver/migration receipts; export only with consent. |
| C09 — run a fixed release acceptance batch | NOT_STARTED | unassigned until dependencies close | Freeze and run the specified evaluation matrix; ordinary tests do not count as live trials. |
| C10 — prepare a reproducible release and compliant evidence package | NOT_STARTED | unassigned until dependencies close | Freeze release/setup/materials and genuine video after C09. |
| C11 — freeze competition build; owner submits | NOT_STARTED | unassigned until dependencies close | Owner confirms eligibility/rights/terms and submits manually. |

## Later release ledger — deferred scheduling, not completion

| Ticket | Status | Owner | Scheduling |
| --- | --- | --- | --- |
| F01 — repository lifecycle (R1; after C05) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F02 — Git transport, repository size and object integrity (R1; after C03) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F03 — code experience and search (R1; after C06) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F04 — pull-request and branch-policy parity (R1; after C04/C06) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F05 — issues and triage (R1; after C06) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F06 — project planning (R1; after F05) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F07 — discussions, documentation and snippets (R1; after F05) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F08 — people, discovery and notifications (R1; after F05/F07) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F09 — organizations and access (R1; after C01/C05) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F10 — CI engine and runner compatibility (R2; after C02/C08/F09) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F11 — releases, static sites and deployments (R2; after C07/F10) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F12 — packages and registries (R2; after F09/F10) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F13 — code and supply-chain security features (R2; after F09/F10/F12) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F14 — APIs, apps and ecosystem interoperability (R1 core; R2 expansion; after C08/F09) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F15 — complete migration and exit (R1; after F01–F09/C08; extend for R2 objects) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F16 — developer environments and agent interoperability (R2; after C02/F10/F14) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F17 — clients and accessibility (R3; after F03–F09/F14) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F18 — commercial and community operations (R3; after usage/authorization foundations) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F19 — operations, enterprise and service trust (R3; start relevant safeguards in C) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |
| F20 — finite parity certification and stop (R3; after all included tickets) | NOT_STARTED | unassigned | After its defined dependencies; existing partial foundations retained. |

## C00 evidence reconciliation

| Layer | Exact evidence | Current qualification |
| --- | --- | --- |
| Audited and committed source | `c564f730b5c962cf699133e4a0bb4ce7435c243f`; CI `37215340488` verification/native-boundary jobs passed | Source and CI verified, not current hosted proof. |
| Local committed-source replay | 1,274 pass, 1 platform skip, zero failures across 322 files; lint/typecheck/build passed | Existing passing gate; do not reopen without an affected diff or reproduced regression. |
| Uncommitted delta | Encrypted nonce-scoped HttpOnly invitation return; generic OAuth destination, explicit joining, visible cleanup recovery; README main instructions and tracker updates | Frozen snapshot suite 1,277 pass, 1 skip, zero failures across 323 files; build/dry run passed. Not committed, deployed or hosted verified. |
| Current Worker deployment | Fresh provider inspection: deployment `9174d7b7-4aff-4145-9fb7-fe21c6c5b114`, 100% version `ac98c981-da52-4cb7-84b0-c593c899e43a`, uploaded 2026-10-04 14:26:50 UTC; saved operator record identifies source `34a1e7a2c67c006243766462deda9578735328df` | Version directly observed; source association comes from the saved release record. It differs from committed main and the uncommitted invitation-return delta. |
| Native runtime | Provider metadata checked: Integrator `a03f6b21-d265-4b78-a117-07e98cf74684` and Agent `a0388b17-59b3-4a6a-98cd-54f1fa766423`, version 55; exact image `sha256:d32bbfb56e65f0264a053ddb186c572331dc3cafad41409816cd2be71e2bfad2`; limits 3/4 | Executed core/verifier/Docker inputs unchanged from image source `1b6a3f09`. Compatibility and local UID defenses do not close C02's Cloudflare sandbox/egress gate. |
| Owned hosted Git receipts | Existing ordinary README initialization, empty-fork recovery, concurrent ticket contributions, exact human acceptance and native readback | Receipt/version reconciliation in progress; no current-source completion claim. No customer popularity or scale claim. |
| Signed receiver / migration | Owned receiver reported duplicate signed deliveries with one action; selected-branch/conversation migration evidence exists | Match receipts and deployed source under C08. No application deployment or full migration claim. |

C00 affected files: this tracker, README, submission/demo documentation and release
metadata. The owner's existing `docs/SUBMISSION.md` draft is preserved; do not
stage or overwrite it while reconciling evidence. Existing approval of Google API
policy does not approve competition terms, identity replacement, or payments.

### C01 owner decision

Approved in this chat: retain Clerk for customer identity, keep Polar checkout
disabled, use GitHub for source/developer CI, and allow optional GitHub mirroring
only after explicit repository export consent. Workers and Artifacts remain the
core runtime. This grants no increased spending, provider migration, payment
activation, public release, or automatic export.

Scoped endpoint inventory: Clerk issuer/JWKS serves identity; Workers AI and
Cloudflare AI Gateway serve model execution; Cloudflare DNS serves domain checks.
Polar endpoints serve disabled checkout/billing management. GitHub serves source,
developer CI, and optional migration/mirroring. Customer-selected webhooks/check
receivers are optional integrations. Preview CSP permits Google font endpoints;
C02 must account for them in the immutable-output/network policy. No TypeSafe/Jev
production endpoint was found in the scoped runtime inventory; development tools
are not customer runtime dependencies. Full C01 journey acceptance remains open.

### C00 receipt qualification

| Saved receipt | Version binding | What it proves |
| --- | --- | --- |
| `flaregit-hosted-empty-creation-proof.json` | Creation source `1b6a3f09`, Worker `09389824-fcfb-411b-9460-ec9ca76e1d1e`; recovery source `34a1e7a`, Worker `ac98c981-da52-4cb7-84b0-c593c899e43a` | Original provider fork/task survives reload; no accepted commit or credential disclosure. |
| `flaregit-hosted-readme-b057d6c.json` | Source `b057d6c0`, Worker `12f3d451-02fd-408d-a80b-676a4999f868` | Owned initialization contains exact README root `b0dac1058bae75239708358812742ea5b3201069`; not a contribution merge/deployment. |
| `flaregit-hosted-human-workspace-9d3480b.json` | Source `9d3480be`, Worker `c9dfdc9c-aede-47a2-9ad4-fb7911523154` | Human-tool workspace purpose persists; no agent or accepted-history change. |
| `flaregit-canary-accepted-native-receipt.json` | Worker version not recorded in this receipt | Fresh owned native clone/fsck matches accepted `868aba34103e1f7a425807835c93906f427b3c37`; Git-state evidence only, not current-release or application-deployment proof. |

These operator-private receipts reside under `/private/tmp/`; they must be copied
into the approved C10 evidence package with secrets excluded before relying on
them as durable submission artifacts. Unversioned reports are not counted as
HOSTED_VERIFIED for the current candidate.

### C02 local implementation evidence

Owned files: `src/server/execution-egress.ts`, `static-build-artifact.ts`, and their
focused tests. Nine local tests / 49 assertions, lint, typecheck and build pass. The
handler defaults to deny, permits only exact Git service queries, and rechecks
authority after credential callbacks before forwarding. Worker callbacks alone
add credentials; manifests reject zero Git identities and bind
bounded bytes to attempt/project/incarnation/commit/tree/policy/source digest.
These modules are not wired. They do not prove Cloudflare TCP/egress isolation,
build provenance, browser verification, or publisher separation. Supported
Container interception with Internet disabled, separate jobs, trusted browser
case receipts, cleanup and actual Cloudflare canaries remain required.

### C02 separate execution progress

`untrusted-execution.ts` now has mandatory authorization, immutable preparation,
one-shot dispatch, Internet-disabled startup, HTTP/HTTPS deny interception, fixed
offline builds, bounded bytes/time, and sealed cleanup. Local tests use synthetic
Container APIs; actual workerd verifies durable state but is not a Cloudflare VM
isolation proof. Output remains explicitly non-acceptance evidence.

`Dockerfile.untrusted` was built locally as `flaregit-untrusted-c02-local` for
linux/amd64. It contains Bun 1.3.4 and frozen production dependencies, not platform
source, protected checks or publisher code. A network-disabled, read-only local
container confirmed Bun and React dependencies and absence of platform source.
No image was uploaded and no hosted resource was changed. The actual local
offline React build passed: one Docker test / 10 assertions. Its first failure
was missing interactive stdin in the synthetic Docker adapter; one targeted
repair preserved all assertions. Receipt: `/private/tmp/flaregit-c02-local-docker-proof.json`,
explicitly `cloudflareVerified:false` and `acceptanceEvidence:false`, with source
and output digests and image hygiene checks. The combined local runtime,
manifest, egress and workerd slice passes 15 tests / 93 assertions.

The marked isolated-browser workflow now connects durable source capture,
one-shot builds, external verification and publication receipt checks in source.
Actual Cloudflare isolation/egress canaries and approved hosted resource use
remain open. Local Docker evidence does not close these gates.

### C02 trusted verification progress

`external-browser-verifier.ts` independently binds the trusted case inventory,
rechecks source/output manifests, serves immutable same-origin bytes, compares
primitive browser observations in the Worker, and requires exact positive lease
cleanup. Ten synthetic transport tests / 54 assertions pass, including tampering,
forged page success, denied traffic, withdrawal and pending-allocation cleanup.
These are not actual-browser or hosted receipts.

The official Cloudflare Puppeteer SDK is pinned as a development/build dependency
(`@cloudflare/puppeteer` 1.4.0). No Browser Run binding or session was created.
The real transport adapter, actual isolation/interception canaries, trusted
publisher integration and resource authorization remain open.

### C02 concrete adapter progress

`cloudflare-browser-transport.ts` uses the pinned Cloudflare SDK, fresh browser
contexts, pre-navigation interception, isolated CDP observations, restricted
permissions/downloads/workers/WebSockets, and bounded cleanup. A rejected launch
with no returned browser remains unconfirmed because a provider session may have
been acquired. Twenty synthetic verifier/adapter tests / 93 assertions pass.
No Browser Run session was created. The production adapter now captures the
exact session ID through SDK acquire before connect and requires native
closeSession/getSession confirmation; SDK disconnect alone cannot prove cleanup.
HTTP/HTTPS guardrails allow only the lease's exact virtual hostname. Root verified
25 synthetic tests / 112 assertions and clean lint/typecheck for this change;
additional pending native-cleanup cases remain in the owner's focused gate.
Opaque acquisition without an ID stays unconfirmed. No account-wide session
inventory or cleanup is performed.

The combined root-run C02 slice passed 53 tests / 255 assertions across nine
files. Raw Git source capture separately passed three real local Git cases:
binary bytes, dirty-checkout independence, object substitution, revocation and
symlink refusal. Its native reader now has a scoped command permit, fixed Git
object arguments, a credential-free child environment, replacement-object
disablement and a byte cap. Source capture is not yet wired into the production
verification workflow. Browser fixture inventories and publisher receipt
binding remain under implementation; coverage gaps must close before release.

The exact platform Git-object reader passed a real local Docker proof using the
existing verifier image, a read-only repository mount and disabled networking:
binary bytes, commit/tree reads, ignored replacement refs, byte bounds and
filter refusal (one test / seven assertions). Receipt:
`/private/tmp/flaregit-c02-local-git-object-proof.json`, explicitly
`cloudflareVerified:false`. The isolated-build orchestrator and raw source
collector root gate passed 11 tests / 140 assertions, including forbidden dotenv
reads, gitlinks, hanging reads and lost prepare/run acknowledgements. It bounds
work and cleanup separately, consumes one durable dispatch, and returns builds
with `acceptanceEvidence:false`. These modules remain unwired to public traffic.

The separate durable browser-receipt module now invokes the external verifier
itself, validates the independently required inventory and immutable byte
identities, and rechecks authority before storage and on reads. It does not
accept a caller's success receipt or change candidate/history status. Root's
combined receipt/verifier/adapter gate passed 35 tests / 154 assertions with a
synthetic browser adapter. Controller/publisher wiring is now source-tested;
production configuration, deployment and hosted verification remain open.

Controller integration now requires the exact sandbox's durable completed-output
receipt before storing build identities, plus fresh candidate authority and
recomputed byte hashes. Missing bindings and changed manifests/scopes fail closed.
The Global browser admission RPCs now use the same spending ledger, an explicit
operator envelope and native exact-session cleanup; their configuration remains
unset and public traffic unchanged. A scoped root gate passed nine tests / 37
assertions, including actual workerd refusal/recovery and bounded receipt reads.
Current fixture inventories cover their approved requirements; DOM/template
build and receipt tests passed 12 tests / 73 assertions. Actual local Chromium
coverage and Global browser admission HTTP tests have passed locally. The
retained opt-in Chromium tests checked seven isolation assertions and nine
actual template cases / 29 assertions with confirmed cleanup. This is local
browser evidence, not Cloudflare proof.

The frozen-policy publication gate now requires the stored browser receipt and
its exact output digest; write readback recovery remains independent. Root's
publication/policy/browser-budget gate passed 27 tests / 190 assertions, and the
extended native publication/recovery gate passed five tests / 37 assertions.
Durable build-attempt IDs prevent an interruption from silently creating another
job. Source-tested agent Git egress restricts transfers to one assigned fork and
branch CAS, with Worker-owned credentials; sandbox/CA/workflow wiring and actual
agent network canaries remain open. Legacy application execution and requirement
coverage outside the supported trusted inventories still need reconciliation;
this is not a claim that the deployed app is isolated or feature-complete.

The source-to-browser vertical slice is now invoked by the marked integration
workflow, with canonical RPC identities, real committed-object capture, durable
source binding, one-shot funding/dispatch, independently checked browser output,
and static stage failures. Durable evidence copies use the same output digest as
the controller and publication journal. Root's affected slice passed 31 tests /
230 assertions; lint, typecheck and build passed. Git, SQLite and workerd are real
in the local checks; execution/browser ports in that slice remain synthetic.
The actual retained local Chromium proof is recorded separately above.

A dedicated inactive canary Worker/configuration now compiles and dry-runs
offline. It has no public routes, no operator secret, execution disabled, and
one-container/one-browser limits. Its first fixed build/DOM-forgery stage uses a
143,008-microdollar admission reservation, explicitly not an invoice ceiling.
Native HTTP/HTTPS/raw-socket/redirect/credential canaries remain required beyond
that stage. No canary deployment, image upload or hosted session has occurred.

Local source checkpoint: `0c37f864236461b111cd8ffc9dab475aa5ab326f`, branch
`codex/c02-source-0c37f8642364`; main remains `c564f730`. Its lint, typecheck and
build pass. The full suite ended with 1,407 pass / 6 skip / 4 fail. Failures were
concurrent in-process fixture builds (EBADF), two recovery fixtures built for
Node rather than Workers (createRequire startup), and a preview fixture sharing
two Miniflare instances in one child process (timeout). Focused repairs preserve
assertions/deadlines and now pass. The failed log is preserved at
`/private/tmp/flaregit-c02-0c37f864-tests.log`. No hosted action may proceed on
the strength of an unfinished or failed gate.

Corrected local checkpoint: `55b36c02f98ce33e964b9847f94a4b92f090990c`, branch
`codex/c02-source-55b36c02f98c`. Its complete isolated-clone gate passed
1,417 tests / 6 intentional skips / 0 failures (16,000 assertions), plus lint,
typecheck and build. Clone: `/private/tmp/flaregit-c02-55b36c02-gate`; log
`/private/tmp/flaregit-c02-55b36c02-tests.log`. The browser SDK now loads only when
browser acquisition/connection is requested, preserving ordinary Git/recovery
startup independently. This checkpoint remains local and undeployed.
New restricted-agent RPC/startup work is outside that frozen checkpoint and must
pass its own checks before inclusion. Hosted canary approval remains pending;
the earlier failed checkpoint is not eligible for deployment.

The new agent path now connects Workflow selection, scoped loopback egress,
controller authorization/funding, server-only credential issuance, and sandbox
configuration. READY requires installed HTTP/HTTPS interception, disabled
Internet, pinned image inspection and valid unexpired X.509 CA validation;
running VMs cannot bypass the command guard. Cleanup uses original ownership
after operator settings or membership change. Root's affected agent/controller/
authority/sandbox gate passed 43 tests / 233 assertions; lint and typecheck pass.
Container/Root transport ports in the sandbox fixture are synthetic. Actual
Cloudflare TLS, raw-network denial and genuine concurrent-agent journeys remain
required before C02 can close. The updated local agent image includes OpenSSL;
its offline hygiene receipt remains explicitly unuploaded and non-hosted.

The restricted agent execution seam passed all 35 agent tests (including saved
proposal and lost-push recovery); Root's combined agent/canary/CBA gate passed
42 tests / 233 assertions. Canary cleanup separately passed a qualified
provider-fake workerd test. The local minimal agent image is non-root and contains
Bun, Git, public CAs and frozen dependencies without platform source or secrets;
its receipt is `/private/tmp/flaregit-c02-local-agent-hygiene.json`, explicitly
not uploaded or Cloudflare-verified. Actual restricted agent RPC/CA/relay wiring
and all hosted gates remain open.

`untrusted-execution-sandbox.ts` provides the separate Durable Object bridge but
is not exported or configured in production. It requires namespace identity,
immutable source/image context and a bounded, exact-digest receipt from a trusted
authority/budget service. Authority responses are limited to 1 KiB with a 10-second
stream/fetch deadline. Actual workerd preparation/refusal tests use synthetic
authority and no container binding; combined bridge/browser checks pass 21 tests
/ 94 assertions. Configuration, publication receipt binding and actual
Cloudflare canaries remain open.

The private execution authority now uses the repository controller's current
owner, account, candidate, accepted base, policy, task checkpoints and operator
configuration, with a second account check after asynchronous hashing. Funding
comes from the actual Global ledger; caller assertions cannot authorize a job.
The affected controller/authority, grant and workerd bridge gate passes 10 tests
/ 36 assertions; lint and typecheck pass. Git identity in the controller fixture
is explicitly synthetic. The authority is not exported or configured in
production; trusted source-byte production and hosted execution remain open.

The controller also exposes atomic dispatch claim and exact-context sealing.
Sealing remains available after authority withdrawal so cleanup cannot depend on
continued permission to execute. Duplicate dispatch is denied by the durable
grant ledger. These RPCs are not wired to a production workflow yet.

The next hosted gate must use a separately approved private canary Worker,
dedicated execution container and exact Browser Run sessions, without changing
the public application's traffic. Freeze and identify the source and image
digests first. Test denied external HTTP/HTTPS, redirects, alternate ports and
raw sockets, credential absence, forged output/check results, authority
withdrawal, interruption, duplicate dispatch and exact-session cleanup. Record
the provider versions, native receipts, byte digests and actual spending; never
promote local adapter results into hosted proof. Resource configuration and a
bounded spending proposal must be reviewable before requesting owner approval.

## 1. Product and fixed boundaries

**FlareGit: Work in parallel. Integration happens automatically.**

People and coding agents contribute through ordinary Git. The platform preserves their goals and changes, combines compatible work, repairs textual and behavioral/interface conflicts, verifies an exact candidate, and publishes according to an explicit repository acceptance policy. Contradictory requirements produce one understandable product decision. Uncertainty preserves the accepted application rather than silently discarding a requirement.

Keep a real forge: repositories, code navigation, changes/pull requests, conversations, issues, people, reviews, automation, and the wider feature inventory below. Do not turn it into an agent transcript dashboard. Agents are contributors, not a substitute for the social and review functions of a forge.

Cloudflare is the intended hosted infrastructure. Workers and Artifacts remain fundamental. Keep useful neutral open-source libraries. Do not rewrite the functioning Bun build setup into Vite, change Tailwind versions, replace the state architecture, or redesign working screens simply to match an earlier suggestion.

Do not introduce a competing hosted service without explicit owner approval. Existing exceptions need a recorded decision; they are not automatically approved because they are already in the code. Never replace a managed identity service with improvised password handling to satisfy a branding requirement.

No hidden production test data, fake progress, fabricated agents, unsupported guarantees, silent feature removal, weakened acceptance checks, or blind force pushes. No publishing, billing activation, purchases, legal acceptance, or automated competition entry without the appropriate owner action.

## 2. What the audit actually found

All source references below use the reviewed SHA. Prefix a path with `https://github.com/Joe-Simo/flaregit/blob/c564f730b5c962cf699133e4a0bb4ce7435c243f/` to inspect it.

| Finding | Evidence and consequence |
|---|---|
| A roadmap already exists, but is a broad completion checklist. | `docs/ROADMAP.md` mixes reliability, collaboration, integrations, billing, and entry work. Convert it to the bounded tickets below rather than asking the agent to keep finding work. |
| Latest CI is green; an older failure summary remains in documentation. | The reviewed CI run succeeded. `docs/ROADMAP.md` still records an earlier three-failure checkpoint. Reconcile status once; do not repeatedly fix obsolete failures. |
| Source, deployment, and hosted evidence are not aligned. | `docs/SUBMISSION.md` pins an older SHA; `README.md` references a branch/PR already merged. PR #2 reports later hosted exercises but is an implementation report, not independently replayed evidence. |
| Core Git and durable integration are substantial implementations. | `src/server/workflow.ts`, `git-gateway-handler.ts`, `git-http-gateway.ts`, `durable-object.ts`, and `docs/ARCHITECTURE.md` implement composition, candidate refs, evidence checks, review, journaled publication, and recovery. Preserve this work. |
| Every verified candidate currently waits for a human. | `src/server/workflow.ts` unconditionally calls `awaitReview` and waits for a review event. Automatic composition is not the same as policy-authorized automatic landing. Add an explicit safe mode; do not remove review support. |
| Verification needs a provider-specific trust-boundary correction. | `src/core/verification/execution.ts` uses a separate UID and `setpriv --no-new-privs`; `docs/ARCHITECTURE.md` says candidate code and behavioral checks share a child process. Docker canaries do not establish the Cloudflare deployment boundary. No exploit was attempted in this audit. |
| Open sandbox egress is actual code, not merely a hypothetical risk. | `src/server/integrator.ts` starts containers with `enableInternet: true`; agent sandboxes inherit that implementation. Credential/network containment must be resolved before broader untrusted execution. |
| Tags/releases are partial, not a finished feature. | `release-records.ts` has a metadata ledger; `TagsReleasesPanel.tsx` has UI; searches found their declarations/tests rather than application wiring. Existing roadmap explicitly lists API/DTO/navigation/hosted gaps. Trace and close the entire path. |
| Search is currently metadata search. | `src/server/metadata-search.ts` explicitly excludes Git contents and scans a bounded set of repositories. Do not call this code-search parity. |
| Migration coverage is incomplete. | README describes selected-branch ancestry inspection. `git-migration-inventory.ts` excludes LFS bytes and submodule repositories. A successful import does not establish complete project migration. |
| Customer authentication is not Cloudflare-only. | `package.json`, `wrangler.jsonc`, `access.ts`, and `worker.ts` use Clerk. Polar billing also exists, with paid checkout disabled. The Clerk publishable key is public by design, not a secret-leak finding. |
| New-repository preview setup is an onboarding gap. | `wrangler.jsonc` contains two repository preview origins; architecture documentation requires operator provisioning. A new user's repository must not silently need an undocumented operator edit. |
| Hosted results are unevenly documented. | PR #2 reports owned live concurrent work, repair, acceptance, and readback; submission documentation still lists some as pending. Reconcile against saved receipts and the actual deployed SHA before concluding success or failure. |
| There is significant feature breadth, but not demonstrated total parity. | README and server source contain repository browsing, changes, issues/comments, membership/invites, profiles, notifications, webhooks, external-check callbacks, recovery, and status functionality. Each still needs a user-journey acceptance record. |

PR evidence: `https://github.com/Joe-Simo/flaregit/pull/2`.

### Provider facts that constrain implementation

Cloudflare documents the sandbox—not a Linux UID—as the trust boundary, and recommends keeping credentials outside it and controlling outbound access. Do not treat local Unix permission checks as a substitute. Use separate jobs for untrusted execution and trusted evaluation, with a trusted publisher outside both. Source: `https://developers.cloudflare.com/sandbox/concepts/security/`.

Artifacts documents smart-HTTP Git, a 1 GB repository limit, and a 32 MB blob limit. SSH and larger-repository parity require a separate proven plan; standard HTTP support does not prove them. Sources: `https://developers.cloudflare.com/artifacts/api/git-protocol/` and `https://developers.cloudflare.com/artifacts/platform/limits/`.

## 3. Theo evidence: use the actual video, not an invented exclusion list

Reviewed the original page and accessible caption transcript for video `R7ex-Gt8dtw`; not independently audio-verified word for word. He values community and free private repositories, and criticizes unreliable operations, disappearing accepted work, poor navigation, security failures, and unaccountable responses. This video establishes no blanket feature-category removal list. The later migration letter is another author's text being read aloud; the CI endorsement is a sponsor segment.

Original: `https://www.youtube.com/watch?v=R7ex-Gt8dtw`.
Caption source: `https://rosetta.to/u/t3dotgg/i-give-up`.

Product decisions in this plan are our recommendations, not claims that Theo personally requested their precise implementation. Do not market an endorsement. Any future Theo-based exclusion must record the exact source passage, speaker, timestamp, and owner approval. In the meantime, keep all feature families in the parity register.

## 4. Releases and the definition of completion

### C — competition release

Close C00–C11. This release proves a coherent real forge workflow plus genuine concurrent agents, protected behavioral verification, honest conflict handling, and evidence-backed publication. It is not called full GitHub parity.

### R1 — everyday collaboration replacement

Close F01–F09, F14–F15, and applicable operations gates, in addition to C. This covers the day-to-day repository, review, issue, planning, community, access, and migration experience. Any missing SSH/LFS/large-repository support remains an explicit blocker to the corresponding parity claim.

### R2 — automation and software-delivery replacement

Close F10–F13 and F16. Cover executable CI, releases/deployments, packages, security workflows, and development/agent environments. A command runner is not automatically compatible with the Actions ecosystem.

### R3 — wider ecosystem and full declared parity

Close F17–F20 and any remaining rows, including client experiences, commercial/community operations, enterprise requirements, and all compatibility exceptions. Only then use a full-parity claim for the frozen catalog. Do not imply identical proprietary implementation, certification, API compatibility, capacity, or support contracts without proof.

The catalog is frozen to this roadmap's feature families and the linked official GitHub documentation as reviewed on 4 October 2026. A newly released GitHub feature does not automatically expand the current release. During C00, resolve any genuine omissions once and assign an explicit ticket. Afterwards, scope changes require owner approval; no perpetual rediscovery backlog.

### Status and evidence vocabulary

Use `NOT_STARTED`, `IMPLEMENTED`, `LOCAL_VERIFIED`, `HOSTED_VERIFIED`, `DONE`, and `BLOCKED`. Record deferred scheduling separately; deferred never means done.

Every ticket records: ID, release, dependencies, one responsible owner, exact source SHA, affected files, implementation status, acceptance scenarios, commands/results, deployed version where relevant, evidence location, and the next concrete action.

A ticket is DONE when its specified user journey works through the real UI/API/native tool path, data survives reload/restart, permissions and negative cases pass, and evidence matches the candidate release. Pure internal library tickets may close with local evidence, but their associated product feature remains open until the integration journey passes.

A checkbox in documentation, file existence, a mocked API response, a model's self-report, and a screen render are not product completion evidence.

## 5. Full feature register — nothing silently excluded

`P` means a starting implementation or partial coverage was found. `U` means not established in this audit, not proof that no line of code exists. `B` identifies a compatibility/permission decision. None of these labels means DONE.

| ID | Capability family retained in scope | Starting status | Finishing ticket |
|---|---|---|---|
| G01 | Public/private repositories, create/import, fork/template, archive/restore, rename/transfer/delete | P | F01 |
| G02 | Standard Git, branches/tags, SSH, LFS, submodules, signatures and integrity | P/B | F02 |
| G03 | File tree, rendered/raw content, history, blame, compare, line links, browser editing/uploads | P | F03 |
| G04 | Code, repository, issue, PR, and people search with permissions and filters | P; metadata search exists | F03 |
| G05 | Pull requests/changes, draft state, inline threads, suggestions, requested reviews, CODEOWNERS, stacks | P | F04 |
| G06 | Branch rules, required checks/reviews, merge methods, queues, optional auto-accept, revert | P | C04/F04 |
| G07 | Issues, labels, assignees, milestones, templates/forms, relationships/subissues, bulk triage | P | F05 |
| G08 | Projects: board/table/timeline, fields, views, automation, progress/insights | U | F06 |
| G09 | Discussions, categories, answers, polls, moderation, conversion to issues | U | F07 |
| G10 | Wikis and shareable versioned snippets | U | F07 |
| G11 | Profiles, people, contributions, follows, stars/watch, topics and discovery | P | F08 |
| G12 | Notifications, mentions, subscriptions, preferences, email delivery | P | F08 |
| G13 | Organizations, teams, roles, outside collaborators, invitations and ownership | P for repo membership; wider org model U | F09 |
| G14 | Account security/recovery, keys/tokens, application authorization, audit, enterprise identity | P/B | C01/F09/F19 |
| G15 | CI workflow execution, jobs, matrices, conditions, reuse, logs, caches/artifacts, secrets, cancellation | P for command execution and external checks; broad engine U | F10 |
| G16 | Linux/macOS/Windows and self-hosted runner compatibility | B | F10 |
| G17 | Tags/releases, attachments, immutable versions, generated notes, provenance | P; not fully wired | C07/F11 |
| G18 | Static sites, custom domains, deployment environments, approvals, exact-version delivery | P | C05/F11 |
| G19 | Public/private package and OCI registries with real client interoperability | U | F12 |
| G20 | Secret/code/dependency scanning, advisories, update proposals, SBOM/provenance | U for equivalent user workflows | F13 |
| G21 | Stable REST/GraphQL surface, apps/OAuth, webhooks/checks, marketplace-style discovery | P for APIs/webhooks/check callbacks | C08/F14 |
| G22 | Full repository/project import/export, histories, discussions/reviews/assets, backup/restore | P | C08/F15 |
| G23 | Cloud development workspaces, editor attachment, scoped AI assistance, external-agent interoperability | P for managed agents/ordinary Git; broader workspace U | F16 |
| G24 | CLI, desktop, mobile/tablet experiences and accessibility | P for CLI/web; native clients U | F17 |
| G25 | Usage/billing, sponsorship/community programs, education/nonprofit/support operations | P for disabled billing; broader operations U/B | F18 |
| G26 | Reliability, honest status, abuse response, security response, enterprise governance/self-hosting | P/U/B | C02/C09/F19 |

Primary feature inventory sources: `https://docs.github.com/en`, `https://github.com/features`, and the domain-specific documentation cited in F01–F19. This is a capability register, not an assertion that every current GitHub endpoint has been enumerated or that equivalent code already exists.

## 6. Competition-critical tickets — execute in this order

Timeboxes are planning limits, not evidence that an item is easy. When a ticket exceeds its limit, split around a specific remaining acceptance case or mark an external dependency. Do not silently enlarge the ticket.

### C00 — freeze the current truth

**Dependencies:** none. **Budget:** half a day. **Starting files:** `docs/ROADMAP.md`, `README.md`, `docs/SUBMISSION.md`, `docs/DEMO.md`, `package.json`, `.github/workflows/ci.yml`.

Reconcile source, merged branches, CI, deployed Worker, image digest, and saved hosted receipts. Preserve valid completed work. Assign the above feature families and remaining current-batch tasks to IDs. State clearly which gates are source-only, locally checked, hosted-reported, or directly reproducible.

**Pass:** one execution tracker names the active ticket and next ticket; obsolete README branch instructions and stale failure summaries no longer mislead; every claimed hosted result has a version and receipt. Do not spend a day reformatting all documentation.

### C01 — settle identity and infrastructure exceptions

**Dependencies:** C00. **Budget:** half a day for decision and test plan, implementation separately bounded. **Starting files:** `access.ts`, `worker.ts`, `wrangler.jsonc`, `package.json`, Polar integration.

Inventory Clerk, Polar, GitHub Actions, GitHub mirroring, and all external endpoints by purpose: production runtime, optional customer integration, source distribution, or developer CI. Ask once for any required exception. No exception is inferred from pre-existing code.

Keep payments disabled for the competition. For authentication, either obtain an explicit scoped exception or implement a supported Cloudflare-compatible identity plan with tested account recovery and permissions. Do not assume Access is a drop-in consumer account system or implement ad hoc passwords. Migrate existing account IDs/ownership deliberately if identity changes. Do not use an identity migration to delete user data.

**Pass:** the deployed architecture and its public description match approved reality; fresh login, logout, session expiry, member removal, and denied access pass. A billing provider failure cannot prevent repository reads or reviews. Unresolved approval is BLOCKED, not a fake Cloudflare-only claim.

### C02 — replace assumed sandbox trust with demonstrated boundaries

**Dependencies:** C00. **Budget:** two days; highest technical priority. **Starting files:** `integrator.ts`, `src/core/verification/execution.ts`, `workflow.ts`, build/verification modules, Dockerfile, Wrangler configuration.

Separate untrusted source execution from the trusted acceptance harness and publisher. Keep credential use behind narrowly authorized Worker operations. Disable general outbound Internet; permit only necessary operations, methods, paths, and destinations through the supported mechanism. Package acquisition is a distinct constrained phase, not permanent arbitrary egress.

For the competition adapter, build an immutable static output and test it through a trusted external browser harness. Do not import candidate modules or run candidate-selected verifier scripts in the trusted host. Existing repository tests remain supplementary unless admitted through the trusted policy. Preserve valid UID/no-new-privs defense in depth where useful; it is not the trust boundary.

**Pass:** actual Cloudflare jobs with synthetic canaries demonstrate no cross-task/private-supervisor access, no acceptance-harness tampering, no credential disclosure, denied non-allowlisted egress, bounded execution, and verified cleanup. The expected check inventory comes from trusted policy; a fabricated stdout success cannot publish. Do not probe other users' repositories.

### C03 — prove exact publication and recovery on the deployed snapshot

**Dependencies:** C02. **Budget:** one day. **Starting files:** `workflow.ts`, `durable-object.ts`, target bindings, native-runtime ledger and Git-pin modules.

Keep the existing PREPARED/publication/readback protocol. Close specific remaining failures; do not rewrite it. Verify current accepted target, source heads, candidate SHA/tree, requirement/policy versions, verified build digest, and publication authorization. No post-verification rebase/amend/squash/rebuild may reuse evidence. A different merge method must produce and verify its own exact output.

**Pass:** race two publishers; advance the base during verification; supersede a task; change policy; deliver duplicate/late callbacks; interrupt before and after the ref update; cancel an attempt. Each case either lands the exact authorized result once or preserves an explicit unresolved state. A fresh clone matches the accepted SHA. Accepted history remains present if mirror, preview, notifications, or model provider fails.

### C04 — restore the automatic-integration promise without removing reviews

**Dependencies:** C02, C03. **Budget:** one day. **Starting files:** `workflow.ts`, review/policy ledgers, task requirements and decision UI.

Add an explicit repository policy with `review-required` and `verified-auto-accept` modes. Keep review-required for ordinary uncontrolled imports. Auto-accept is available only for the supported protected adapter and approved requirements. Persist who authorized the policy and its version. Never bypass a required review by reclassifying a bot callback.

Run both original feature requirements plus combined interaction checks. Contradictory inputs retain the previous accepted version and produce one specific behavioral question. The answer versions the requirement; repair and verification follow. Fixing uncertainty is not permission to weaken tests.

**Pass:** compatible work lands without a per-candidate approval in the opted-in mode; the same work waits in review-required mode; contradictory requirements cannot auto-land; changing the mode invalidates affected pending authority. Existing legitimate human review and audit history still work.

### C05 — close the ordinary developer's first project journey

**Dependencies:** C01, C03. **Budget:** one day. **Starting areas:** creation/import, Git gateway, membership, preview registry/broker, repository UI.

Use two real authorized test accounts. Create an empty private repo and a README-initialized repo; import a small compatible public repo; create a human workspace; clone, commit, push, fetch accepted work, and reload. Invite a second user, accept once and retry, remove the user, and verify denial with an old session/token.

Provision preview origins through one bounded, authorized onboarding operation with visible progress/failure, or a documented pre-provisioned pool allocated exclusively and never recycled across tenants. Do not share app credentials or allow a contributor to choose a privileged origin. A preview is immutable per accepted build; browsing and review remain usable when preview preparation fails.

**Pass:** a fresh user finishes without an undocumented operator edit; private data stays private; retries do not create duplicate repos/invites; both initialization paths and ordinary Git work; newly created supported repos obtain isolated previews. Limits are shown before avoidable failures.

### C06 — finish the core collaboration slice already present

**Dependencies:** C05. **Budget:** one day. **Starting areas:** repository browsing, changes/reviews, issues/comments, profiles/notifications, virtualized diff.

Trace create/read/update/permission flows through real API and storage. A user creates an issue, another contributes, a reviewer leaves an anchored comment and requests changes, a new checkpoint invalidates applicable review, the update is accepted under policy, and users can find the complete conversation. A private contribution must not leak into public profiles or discovery.

Do not add all advanced planning systems during this ticket. Those remain explicit R1 tickets. Preserve a repository-first interface, intelligible concurrent activity, accepted state, and accessible review controls.

**Pass:** this journey works from the rendered browser at desktop and 390px width and through relevant API/CLI routes, with keyboard access, reload persistence, useful empty/error states, and no inert controls. Broken diff anchors or revoked access must fail explicitly, not show unrelated content.

### C07 — connect tags and releases end to end

**Dependencies:** C03, C06. **Budget:** one day. **Starting files:** `src/server/release-records.ts`, tag-operation/controller modules, `src/web/tags-releases.ts`, `TagsReleasesPanel.tsx`, Worker routes and navigation.

Complete the controller-to-HTTP DTO-to-client-to-panel path. Do not duplicate the existing isolated modules. Expose actual persisted tags/releases only when the corresponding operation is usable. Preserve create-only tag publication where intended; unexpected existing tags require an explicit decision.

**Pass:** create a tag from an exact accepted commit; confirm it with native Git from another clone; create, edit, publish, reload, and find a release. Retry the same request after an intentionally lost response without duplication. Reject unauthorized edits, stale revisions, and mismatched tag receipts. Attachments/prerelease automation remain F11 unless finished and proven here.

### C08 — make external delivery and migration coverage truthful

**Dependencies:** C03, C05. **Budget:** one day. **Starting files:** webhook outbox, connections/reporting, mirror runner/ledger, GitHub migration reader/inventory, import-history workflow.

Use an owned receiver to validate signatures, duplicates, delays, and replay. A receiver should make one logical action for one stable event ID. Expose accepted, delivery-pending, delivery-failed, and delivered independently. Publication must not disappear because a receiver is unavailable.

Reconcile migration receipts to the actual imported scope: selected refs, objects, metadata, attachments, and explicit omissions. Do not claim full migration until F15. Test one-way mirroring only with explicit export consent and an owned target; lack of that approval must not block unrelated work.

**Pass:** a signed callback cannot approve the wrong candidate/policy; retry is idempotent; a clean receiver processes one event once; missing migration coverage is visible. Native Git-integrity checks are not labeled application-test success.

### C09 — run a fixed release acceptance batch

**Dependencies:** C02–C08. **Budget:** one day. **Starting areas:** existing focused tests, hosted acceptance runner, status probes, cost ledgers and UI.

Run a predefined matrix: independent edits, text conflict, clean-merge behavioral failure, interface/units mismatch, contradiction, stale base, competing publication, interrupted response, revoked access, protected-check tampering, and denied egress. Retain failed runs. Distinguish deterministic replay from fresh agents.

Use a small second repository so success does not depend on hardcoded ticket-booking names. Prove a critical read/review path survives AI/CI/preview/mirror failure. Exercise a scoped backup restoration into a new test repository and compare actual refs and metadata.

Suggested release target: at least 18 of 20 compatible live trials complete within the declared repair budget, zero incorrect acceptance in the specified safety suite, and three consecutive full demos under ten minutes. These are targets, not existing measurements. Investigate failures without deleting cases or lowering requirements.

Measure readiness-to-accept p50/p95, user code edits, product decisions, requirements preserved, regressions, tokens and cost. For UI, set one reproducible dataset and device/network profile; record authenticated navigation and large-diff performance before and after. Avoid claiming global uptime from a small test.

**Pass:** agreed cases pass or the release remains blocked with a precise defect. A fixed final replay batch passes after repairs. No generic endless second audit follows a completed gate.

### C10 — prepare a reproducible release and compliant evidence package

**Dependencies:** C09. **Budget:** one day. **Starting files:** existing README, architecture, demo, submission, LICENSE and NOTICE materials.

Pin one release SHA, toolchain, container image, deployment ID, and source/setup instructions. Check the public clone logged out and execute the documented setup in a clean environment. Document exact supported adapters, limits, credentials, cleanup, and approved infrastructure exceptions. Audit logos, badges, fonts, dependencies, and copied assets for permission; generated artwork is not automatic rights clearance. Do not publish a mark implying Cloudflare ownership.

Prepare a truthful video run: concurrent agents, actual text conflict, clean merge that breaks behavior, protected repair preserving both features, exact accepted result, and a concise contradiction decision. Use live operations or clearly identified recorded runs; no fake progress or prewritten patches described as live generation. A text script is not a finished video.

**Pass:** source/setup/evidence are consistent, required video exists and has been reviewed, there is no sensitive content in footage/logs, and draft entry fields match the actual build. Human recording/eligibility approval remains explicitly visible if pending. Never automate final submission.

### C11 — freeze competition build; owner submits

**Dependencies:** C10. **Budget:** contingency window.

Do not insert optional feature work into the release branch. Recheck the organizer's current rules/form, final file readability, source URL, and running instructions. The owner confirms eligibility, rights, and terms and submits manually. Record the submission receipt only after an actual confirmed submission. Future parity work uses a subsequent release branch.

**Pass:** competition-ready is distinguished from submitted; C cannot be declared submitted by a coding agent. No broader full-parity claim is implied.

## 7. Full replacement tickets after the competition-critical path

Each ticket below is a finite workstream. Split it into approximately one-day vertical slices with the listed acceptance journeys; do not make one giant implementation prompt per category. Dependencies are functional, so independent UI work can proceed without competing writes to the same controller. Do not mark a workstream complete while one of its included capabilities remains pending.

### F01 — repository lifecycle (R1; after C05)

Cover repository visibility, README/license/gitignore initialization, template creation, independent forks, fork relationships, default branch changes, topics, archive/unarchive, rename, ownership transfer, deletion and recovery. Preserve source identity and permission boundaries during every transition. Imported data stays attributed and source repos are never mutated by an import.

Acceptance: migrate an owned test repository through rename, transfer, archive, restore, and fork contribution; verify links/refs/data and old credential denial. A fork is not merely a hidden task workspace with no user lifecycle. Owner deletion must not orphan unbounded billable resources.

Reference inventory: `https://docs.github.com/en/repositories`.

### F02 — Git transport, repository size and object integrity (R1; after C03)

Complete normal Git branch/tag behavior, signatures and verification status, clone/fetch/push/pull, submodule references, and an interoperable Git LFS batch/object service on R2 where needed. Check actual object hashes, not pointer files alone. Evaluate an ordinary SSH Git path separately; a custom tunneling client is not transparent SSH parity. Cloudflare's documented Wrangler SSH access is account-authenticated and does not expose public container ports; do not confuse it with a public Git SSH service.

Acceptance: stock Git and Git LFS clients exercise private/public operations; signed/tagged history survives transfer; blobs, refs and relevant submodule identities survive export/import; unauthorized and non-fast-forward writes follow policy. Test limits before accepting uploads. If Artifacts capacity prevents a promised repository tier, obtain a supported provider change or leave the tier blocked—never secretly split/rewrite Git history.

References: `https://docs.github.com/en/repositories`, `https://developers.cloudflare.com/artifacts/api/git-protocol/`, `https://developers.cloudflare.com/artifacts/platform/limits/`, and `https://developers.cloudflare.com/changelog/product/containers/`.

### F03 — code experience and search (R1; after C06)

Finish branch/tag-aware browsing, Markdown/raw/binary views, path/history navigation, blame, compare, commit/line permalinks, browser edits/uploads, and permission-filtered code search. Keep query syntax, paging, supported file types and indexing freshness explicit. Reuse the working virtualized diff; do not rebuild it for aesthetics.

Acceptance: a user follows an issue to a line at an old commit, sees accurate blame/history, searches a symbol, proposes an edit, and returns after a rename. Deleted/private material is removed from unauthorized search projections. Searches must not silently truncate and report complete results. Cache keys include relevant version and access scope.

References: `https://github.com/features` and `https://docs.github.com/en/search-github`.

### F04 — pull-request and branch-policy parity (R1; after C04/C06)

Complete drafts, review requests, required approvals, CODEOWNERS, multiline/inline threads, suggested edits, resolution, stale approvals, base changes, fork permissions, stacked changes, merge queues, merge/squash/rebase policies, and explicit revert. Retain original contributor attribution and verifiable repair intent. Platform policy—not an agent—controls gate satisfaction.

Acceptance: two accounts and one agent perform a fork-based review cycle, a stack, an approval-invalidating change, a required-check failure, and each allowed merge method. The exact produced commit is verified for its method. Concurrent base changes never discard accepted history. Review-required and safe auto modes remain clear and independently tested.

References: `https://docs.github.com/en/pull-requests` and `https://docs.github.com/en/repositories`.

### F05 — issues and triage (R1; after C06)

Complete labels, assignees, milestones, templates/forms, attachment handling, linking/closing through accepted work, duplicate/transfer workflows, relationships/subissues, saved filtering, bulk actions, and moderation. Preserve discussion context when tasks are assigned to agents.

Acceptance: a maintainer triages a set of issues, converts one into a task, merges its fix, and sees the correct issue close once; reopen/revert does not fabricate history. Deleted and transferred resources retain appropriate redirects or tombstones. All actions respect role and privacy boundaries.

Reference: `https://docs.github.com/en/issues`.

### F06 — project planning (R1; after F05)

Implement project boards, tables, timeline/roadmap views, custom fields, saved filters/sorts, iterations, item status automation, bulk editing, and useful progress charts. Projects must reference issues/changes rather than duplicate them into unrelated state.

Acceptance: the same issue moves between views, is updated by an accepted change, remains accessible only to authorized members, and exports with its custom fields. Conflicting edits are detected or deterministically reconciled. Charts use real stored data.

Reference: `https://docs.github.com/en/issues`.

### F07 — discussions, documentation and snippets (R1; after F05)

Implement discussion categories, question/answer marking, polls, threading, subscriptions, pin/lock/moderation, and issue conversion; versioned wikis with Git access; shareable revisioned snippets with explicit visibility. Do not call issue comments a full discussion system.

Acceptance: a question becomes an issue without losing attribution/links; wiki edits and history survive ordinary Git operations; private snippets cannot leak through discovery, feeds or raw URLs; moderation is audited and appeal/support routes are real.

References: `https://docs.github.com/en/discussions` and `https://github.com/features`.

### F08 — people, discovery and notifications (R1; after F05/F07)

Complete profiles, contribution visibility controls, follows, stars/watch subscriptions, repository discovery/topics, notifications, mentions, mute/unsubscribe, read/unread state, email preferences, and delivery diagnostics. Use existing profile/community/inbox modules where they work. Prevent name/namespace impersonation through a defined reporting and review process.

Acceptance: a real user finds another maintainer, subscribes, receives exactly the intended events, mutes a thread, and controls private-contribution visibility. An inaccessible issue title cannot leak through an email or notification. Synthetic acceptance accounts are never displayed as real popularity.

References: `https://docs.github.com/en/account-and-profile` and `https://docs.github.com/en/subscriptions-and-notifications`.

### F09 — organizations and access (R1; after C01/C05)

Build true organization ownership, teams/nesting, inherited roles, outside collaborators, multiple owners, invitations, access reviews, scoped application/token controls, and audit trails. Reserve enterprise SSO/managed-user expansion for F19; implement those paths only through maintained standards-based implementations and approved providers. R1 must already provide secure session/account recovery and key/token revocation.

Acceptance: transfer a repo into an organization, grant/revoke team access, remove an employee, and verify every read, clone, preview, notification, search and app token respects the change. Invitations cannot downgrade an owner or be consumed twice. Business account continuity must survive one owner leaving.

References: `https://docs.github.com/en/organizations` and `https://docs.github.com/en/authentication`.

### F10 — CI engine and runner compatibility (R2; after C02/C08/F09)

Implement triggers, job dependencies, matrices, conditions, reusable workflows, logs, artifacts/caches, timeouts, cancellation/retry, secret scopes, environment approval, workload identity, resource quotas and billable usage. Publish a precise workflow dialect/compatibility matrix. Test imported workflows through actual execution; an Actions YAML parser alone is not compatibility.

Use Cloudflare-hosted Linux execution where supported. macOS/Windows jobs need an explicitly approved runner architecture, such as user-owned runners with tightly scoped expiring jobs. They are not silently counted as Cloudflare-hosted capabilities. Cloudflare documents Linux VM container execution. Do not introduce a hosted competitor to pass a demo or pretend Linux containers are macOS machines.

Acceptance: build/test a real matrix, invalidate a cache, cancel a running process, reject a fork trying to read privileged secrets, and recover after worker failure without double-running an irreversible step. Browsing and reviews continue during CI outages. Finish declared dialect exceptions before claiming that compatibility tier complete.

References: `https://docs.github.com/en/actions`, `https://github.com/features`, and `https://developers.cloudflare.com/containers/api/container-class/`.

### F11 — releases, static sites and deployments (R2; after C07/F10)

Extend release support to assets, draft/prerelease state, changelog/provenance, immutable downloads, and permission-safe publication. Provide static-site publishing, custom domain validation, deployment environments, approval, statuses and rollback. Distinguish source accepted, artifact built, deployment requested, and deployment observed.

Acceptance: publish an actual asset, validate its digest, install/download it through the documented client flow, deploy the exact approved artifact, fail/retry a delivery, and roll back deliberately. No acceptance or re-delivery silently repeats a production migration. Environment secrets never reach untrusted previews.

References: `https://docs.github.com/en/pages` and `https://docs.github.com/en/repositories`.

### F12 — packages and registries (R2; after F09/F10)

Provide actual package protocol implementations for the registries included in the frozen catalog, not generic file-upload pages: OCI/container images and the required language-package formats. Implement public/private access, version immutability, digest/provenance, retention, deletion/restoration policy, repository linkage and namespace protection. Pin supported protocol versions.

Acceptance: stock ecosystem clients publish, install/pull and verify actual package contents, scoped tokens cannot cross namespaces, and conflicting versions cannot overwrite a published artifact. Permission changes take effect on every download path. No fake registry listing without working client commands.

Reference: `https://docs.github.com/en/packages`.

### F13 — code and supply-chain security features (R2; after F09/F10/F12)

Integrate maintained scanners and suitable advisory data for secret, source-code and dependency findings; support SARIF ingestion, vulnerability reporting/advisories, alert triage, dependency update proposals, license policy and SBOM/provenance. Check licenses and hosted-use terms before integrating tools. Do not simply label any scanner “CodeQL equivalent.”

Acceptance: known benign synthetic fixtures trigger the expected findings, corrected revisions resolve them without erasing history, new vulnerable dependencies are blocked where policy requires, and private reports remain private. No automatic exploit execution against third parties. Coverage limits and false-positive handling are visible.

Reference: `https://docs.github.com/en/code-security`.

### F14 — APIs, apps and ecosystem interoperability (R1 core; R2 expansion; after C08/F09)

Publish stable versioned contracts, pagination, rate limits, resource IDs, webhook events and replay rules. Complete app installation/consent, scoped authentication, revocation, check/report APIs, and a trustworthy integration discovery surface. Expose REST and GraphQL equivalents where included; disclose exact incompatibilities rather than claiming drop-in GitHub API support.

Acceptance: an external test client reads and updates issues, requests checks for an exact candidate, handles pagination/limits/retries, and is immediately denied after revocation. A real app completes install/use/uninstall. A vendor name in metadata is not a connected account or certified integration.

References: `https://docs.github.com/en/rest`, `https://docs.github.com/en/graphql`, `https://docs.github.com/en/apps`, `https://docs.github.com/en/webhooks`.

### F15 — complete migration and exit (R1; after F01–F09/C08; extend for R2 objects)

Inventory and transfer all in-scope heads/tags/reachable objects and LFS bytes; map issues, PRs, inline reviews, discussions, reactions, attachments, releases, wiki and project metadata. Support authorized private sources, resumable jobs, deletions, idempotent restart, and provenance. Imported authors retain attribution without impersonating local accounts. Produce a coverage and discrepancy report.

Acceptance: migrate a purpose-built repository containing every supported object, compare counts/identities/content hashes, intentionally interrupt and resume, and export/restore into a clean destination. A source-only archive does not establish conversational migration. Provider restrictions and missing objects must remain explicit blockers or approved exceptions.

Reference: `https://docs.github.com/en/migrations`.

### F16 — developer environments and agent interoperability (R2; after C02/F10/F14)

Extend existing managed agents and Git workspaces to resumable development environments, editor attachment, scoped terminals, dependency/bootstrap policies, snapshot/cleanup, and safe AI assistance. Keep provider/agent identity verifiable and distinguish local customer-owned agents from built-in runtime agents. Preserve prompts, requirements, patches and evidence without exposing private transcripts publicly.

Acceptance: a human and two agents modify a normal second repository concurrently, reconnect after an interruption, retain their work, and integrate through the same policy engine. A coding workspace cannot become the trusted publisher. Persistent environments have explicit quotas and deletion/recovery semantics.

References: `https://docs.github.com/en/codespaces`, `https://docs.github.com/en/copilot`.

### F17 — clients and accessibility (R3; after F03–F09/F14)

Finish the CLI's supported workflows and credentials on macOS/Windows/Linux. Provide the agreed desktop and mobile/tablet client experiences, including review, notifications and authentication. Record whether these are native clients or responsive web; do not call a mobile webpage native app parity. Preserve normal editor/Git compatibility.

Acceptance: complete create/clone/contribute/review/accept/inspect on each declared client, with keyboard, screen-reader and reduced-motion checks. No client stores account-wide infrastructure secrets. Offline/draft behavior and conflict recovery are explicit.

Reference inventory: `https://docs.github.com/en`.

### F18 — commercial and community operations (R3; after usage/authorization foundations)

Complete measured pricing, entitlements, usage accuracy, checkout/webhook recovery, refunds/cancellation, receipts and support before enabling payments. Preserve free basic private repositories with truthful quotas; do not promise unlimited loss-making hosted agent work. Sponsorship, education/nonprofit programs, and community support have operational, legal and payment obligations; code alone cannot manufacture these services.

Acceptance: an approved test purchase and cancellation reconcile entitlement exactly once; billing failure does not seize accepted work; user export remains available. Any sponsorship payout flow is validated by an authorized operator and processor, never fabricated. Record unapproved provider dependencies as blocked.

References: `https://docs.github.com/en/billing`, `https://docs.github.com/en/sponsors`, `https://docs.github.com/en/education`.

### F19 — operations, enterprise and service trust (R3; start relevant safeguards in C)

Provide scoped backups and tested restores, monitoring of actual user journeys, declared service objectives, incident communications, abuse and security-response queues, retention/deletion controls, audit export, capacity management and a recovery runbook. Enterprise identity/governance/self-hosting or data-residency commitments require tested support, not badges. Never claim independent compliance certification without the real assessment.

Acceptance: exercise the agreed recovery objective, restore in an isolated environment, confirm no accepted state disappears during optional-service failure, revoke leaked test credentials, and resolve an abuse report with an audit trail. Monitor clone/review/accept/delivery separately; a health endpoint that always returns 200 is not platform uptime evidence.

References: `https://docs.github.com/en/organizations` and `https://docs.github.com/en/enterprise-cloud@latest`.

### F20 — finite parity certification and stop (R3; after all included tickets)

Review the frozen feature register, not all future GitHub ideas. Each included row must link passing UI/API/native interoperability and permissions evidence. Every external dependency/exception must be approved, and every unresolved operational requirement stays open. Remove overbroad claims, not useful features, when a capability is genuinely unsupported.

Acceptance: a new user, team maintainer, and organization administrator can complete the declared migration-to-daily-work-to-release journeys without hidden operator workarounds. Publish an accurate compatibility/limitations statement. Mark the release complete and stop adding scope. New requests become another version.

## 8. Dates, task ownership, and interruption rules

### Competition schedule (proposed, not accomplished)

| Date | Primary target |
|---|---|
| Oct 4 | C00 snapshot; C01 decisions; start C02 |
| Oct 5 | C02 hosted isolation/network proof |
| Oct 6 | C03 exact publication/recovery |
| Oct 7 | C04 policy-driven automation; C05 developer onboarding |
| Oct 8 | C06 collaboration; close C07 tags/releases |
| Oct 9 | C08 delivery/migration proof |
| Oct 10 | C09 fixed evaluation and targeted repairs |
| Oct 11 | Finish release blockers and responsive/performance proof |
| Oct 12 | C10 freeze, clean setup, evidence and video |
| Oct 13 | Final recording/package review and contingency |
| Oct 14 | C11 manual submission buffer; aim before 6 p.m. Pacific |

If C02/C03 remain blocked after Oct 6, prioritize a truthful, constrained competition release rather than pretending full untrusted hosting is safe. Public untrusted execution remains disabled until its security gates pass. A revised scope must still pass its applicable trust-boundary and exact-publication gates; no security gate is waived. Never replace genuine concurrent code changes or the core conflict-verification mechanism with animation.

Full parity is not responsibly date-estimated from test counts or elapsed agent hours. After C00, estimate the next workstream from its acceptance slices; track actual throughput and revise later release dates. Do not promise the entire register by October 14. R1/R2/R3 remain required work, not disappearing backlog.

### Execution discipline

One primary integrator owns the active release and large shared controller/router files. A second lane may work on independent UI or an unrelated module; an independent verifier may review read-only. Reserve file ownership before parallel edits. Avoid multiple agents simultaneously modifying `durable-object.ts`, `worker.ts`, or `workflow.ts`.

For each ticket: reproduce the missing journey once, patch the smallest coherent area, run focused tests plus `bun run lint`, `bun run typecheck`, relevant build checks, then capture the required real evidence. Do not rewrite working infrastructure without a demonstrated defect.

After two unsuccessful repair cycles, document the exact failing assertion, attempted fixes, and missing dependency. Change strategy once or mark BLOCKED and move to an independent ticket. Do not retry the same command indefinitely, poll an unavailable service for days, or manufacture green results. A timebox triggers replanning, not deletion of acceptance criteria.

A passing gate stays closed unless a later diff affects it or new evidence reproduces a regression. Run one full release verification batch, targeted repair batches as needed, and one final confirmation. Do not invent more audits every time the existing checks pass.

Keep a single compact handoff entry:

`Active release | active ticket | source SHA | deployment SHA | passed evidence | exact blocker | next action`.

When context compacts, read that entry and the active ticket, not the entire conversation or every past failure. Report progress as completed ticket IDs and remaining gates, never an unsupported percentage.

## 9. Budget and permissions

No fresh spending authority is granted by this document. Reuse existing authorized resources and limits; ask once for exact incremental costs when necessary. Reserve model/container/storage budget before dispatch and reconcile actual usage. Preserve Git/read/review capacity independently from optional agents and previews. Do not turn off cost guards to get a successful demonstration.

Keep paid checkout off until F18. Monetization is not a dependency for the competition release. Do not make enabling a merchant account the reason a functional Git product never reaches a release candidate.

Provider credentials remain server-side; secrets must not appear in chat, repository files, browser bundles, URLs, screenshots or demonstration footage. Public provider publishable keys are not secrets. Inspect and preserve unrelated account resources; cleanup is project-scoped.

## 10. Competition release gate

Before C11, re-read the official rules and current form. Workers, Artifacts, concurrent agents, an accepted source license, runnable source and a real 5–10-minute video are mandatory. Deadline: 14 October 2026, 11:59 p.m. PDT. Owner-only final entry; no automated submission. Confirm eligibility, material rights, branding, content restrictions and travel obligations. This is a checklist, not legal clearance.

Official sources:
- `https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf`
- `https://blog.cloudflare.com/next-git-platform-on-cloudflare/`
- `https://www.cloudflare.com/git-competition/`
- `https://www.cloudflare.com/git-competition/submit/`

Retain Apache-2.0 unless the owner deliberately chooses another permitted license; a gratuitous change to MIT is unnecessary. Keep all release claims verifiable and describe competitors neutrally. Obtain actual owner confirmation and submission receipt; never mark these steps done on their behalf.

## 11. Immediate next action

Start C00 and identify the exact source/deployment delta. Then begin C02 while C01's owner decisions are resolved. Finish existing vertical slices before opening new feature families. Complete and freeze C, then advance through R1, R2 and R3 without reopening C for unrelated improvements. Report blockers precisely, and stop when the applicable release gates are satisfied rather than generating more work.
