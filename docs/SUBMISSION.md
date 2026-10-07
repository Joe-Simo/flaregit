# Cloudflare competition entry draft — FlareGit

Draft only. Nothing has been sent through the competition form. Eligibility and entrant details require the human entrant's confirmation. The required video is unfinished.

This document maps to the [actual Cloudflare entry form](https://www.cloudflare.com/git-competition/submit/), inspected October 2, 2026. The event uses Cloudflare's own form; it is not a Devpost entry.

## Required team fields — human to complete

| Form field | Draft value |
|---|---|
| Team name | **TODO: human to choose** |
| Primary contact name | **TODO: human to confirm** |
| Primary contact email | **TODO: enter privately in the form** |
| Team location | **TODO: human to confirm** |
| First attendee name | **TODO: human to confirm** |
| First attendee email | **TODO: enter privately in the form** |
| Second attendee name/email | Optional; leave blank unless applicable |

Do not commit personal contact details merely to complete this draft.

## Project name

FlareGit

## Project vision — proposed form copy

FlareGit makes concurrent Git work understandable without losing the people and conversations behind it. Each human or coding agent contributes through an isolated real Git workspace. A contribution carries a goal, saved checkpoints, issue context, review conversation, and its relationship to other changes. Maintainers review a composed candidate and decide exactly what becomes accepted history.

The prototype treats coordination and recovery as part of that experience. It detects overlapping edits and stale bases, preserves original contributor forks, and binds checks and human approval to an exact candidate commit. Publication uses a durable journal and compare-and-swap update; retries inspect committed Git state instead of silently replacing somebody else's work. Agent proposals and context are saved before file application, so planning and application can resume independently. Recovery never authorizes a merge.

Contributors can use their own editors and agents through ordinary Git. Repository-scoped services can read candidate metadata and provide signed checks or automated comments. External-only CI retains native Git integrity checks while leaving application checks with the selected service. A service cannot approve history. Public read views and basic private repositories coexist, with explicit access boundaries.

The interface emphasizes contributions, context, and the review decision, using Inter, JetBrains Mono, restrained orange accents, responsive layouts, and clear saved, waiting, and failed states. This is a working prototype with evidence gaps listed below, not a claim of production-scale reliability.

## How you used Cloudflare — proposed form copy

Cloudflare Workers serves the application and authenticated API. Artifacts stores the canonical Git repositories and isolated contributor forks, accessed through native Git with scoped, short-lived credentials. SQLite-backed Durable Objects hold task context, membership, candidate policy snapshots, agent generations, publication journals, service receipts, and delivery state. Workflows coordinate agent planning/application and candidate composition, verification, human review, and publication; Queues carry integration events.

Containers perform managed Git work and isolated application verification when that mode is selected. External-only CI runs native object, ancestry, scope, and protected-path checks without executing customer install/build/test commands or previews. Workers AI powers the built-in coding agents and explicitly surfaced repair attempts; bring-your-own agents remain supported. R2 stores immutable evidence and permitted preview assets. Integration callbacks use signed, repository-scoped requests and stable event identities; webhook delivery has retries and replay. Durable state and Git refs outlive the ephemeral execution containers.

## Demo video — required, unfinished

**TODO: attach the actual final 5–10 minute MP4, WebM, or MOV, at most 2 GiB.** No video URL or file is claimed in this draft.

Use the [seven-minute recording runbook](DEMO.md). Capture real overlapping agents, an actual conflict, stale-base handling, saved context across interruption, exact human review, accepted Git state recovered through a fresh clone, and delivery/replay at a receiver you control. Disclose pre-runs or sped-up waiting. Screenshots and deterministic test scripts do not substitute for the required recording.

## Open source repository URL

[https://github.com/Joe-Simo/flaregit](https://github.com/Joe-Simo/flaregit) — public, Apache-2.0, with a LICENSE file; visibility and GitHub's detected license were checked October 2.

Verified implementation snapshot: [`ab695a3a1227443e9a02f96df180301afa00dbb1`](https://github.com/Joe-Simo/flaregit/tree/ab695a3a1227443e9a02f96df180301afa00dbb1). The commands below pin the implementation independently of later documentation updates. Refresh this reference if the final implementation changes.

Public application: [https://flaregit.com](https://flaregit.com), HTTP 200 checked October 2. This confirms the URL responds, not every authenticated workflow. A browser session is required for owned repository work; private exercise repositories are not public demo data.

## Instructions to run your project — proposed form copy

Visit https://flaregit.com and sign in with your own account. Create a repository or import a public HTTPS Git repository. Use isolated changes, issues and comments to coordinate work; inspect the exact candidate diff and checks before explicitly accepting history. Basic private repositories do not require Pro. Managed agent/integration runs have usage limits; external services require maintainer-issued scoped credentials and are not connected to vendor accounts automatically.

For the reproducible source snapshot, install Bun and Git, then:

```bash
git clone https://github.com/Joe-Simo/flaregit.git
cd flaregit
git checkout ab695a3a1227443e9a02f96df180301afa00dbb1
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun test
bun run demo:proof
```

`demo:proof` uses real Git with deterministic scripted contributors; it is labelled accordingly and does not represent live AI agents. Tests that use model/store doubles are fixture checks, not hosted reliability evidence. Some workerd tests require local loopback-server access. Customer code must run under the deployed Linux execution boundary; trusted local test mode must not be used for real model output or imported repositories.

To self-host, follow the README Cloudflare setup: Workers Paid, Artifacts namespace, Durable Objects, Containers, Workflows, Queues, R2, Workers AI/AI Gateway, Clerk issuer/key configuration, and Docker for the image build. Set secrets through Wrangler's secret mechanism. Build and deploy with `bun run build` and `bunx wrangler deploy`. The [README](../README.md) specifies the bindings, origin configuration, and optional integrations. The hosted acceptance runner uses environment-only credentials and never accepts human review automatically.

## Evidence and remaining gaps — do not paste as completed claims

This audit separates implementation and local verification from observations of the deployed application. A deployed build, passing test suite, or visible sign-in page does not establish the customer workflow below completed.

| Required behavior | Source and local evidence | Hosted evidence / remaining work |
|---|---|---|
| Real repositories and concurrent human/agent work | Artifacts forks and ordinary Git; isolated run IDs; native Git and fixture tests for concurrent changes. | Historical owned exercise `pbd425298ee02` recorded agents/conflict/context; baseline began `69c59c2`, candidate began `2bb6` and awaited review. Recheck full IDs. The newer staged implementation has not yet been demonstrated end to end. |
| Purpose, progress, dependencies and decisions | Tasks, linked issues, comments, agent attribution, stacked changes and explicit decision records; contribution-centered UI. | Historical context exists; capture current staged states and attribution in the final recording. Public source viewers cannot yet inspect these private collaboration records. |
| Overlap, stale bases and conflicts | Changed-file evidence, scope containment, native merge conflicts, immutable candidate inputs and compare-and-swap publication; actual Git/local tests. | Current hosted conflict/stale-base receipts remain pending. Diff inspection explicitly refuses more than 5,000 changed files; broader repository scale is not established. |
| Context and interruption recovery | Durable run generations, frozen task/context/branch state, immutable proposals, explicit failed-proposal recovery and deterministic Git reconstruction; workerd/native-Git tests. | Capture interruption, exact saved proposal and branch SHAs, resumed SHA ancestry, comments and final accepted SHA. Pause/resume alone is not a process-crash test. |
| Human review and accepted history | Diff/comments/checks; exact-commit human decision, required connected-check gate, native integrity evidence and publication journal; actual workerd gate/rollback tests. | **Pending:** human acceptance in the owned hosted exercise and matching accepted/native-clone receipts. An awaiting-review candidate is not an accepted landing. |
| Durable integration and deployment references | Canonical Git CAS, crash reconciliation, transactional accepted-event outbox; commit-addressed R2 evidence and permitted previews. | Hosted integration/fresh clone and recovery receipts pending. There is no demonstrated customer deployment adapter or durable deployment-event consumer; preview artifacts are not evidence of a production deployment. |
| Integration delivery, retry, replay and duplicates | Signed webhook IDs, sequence/attempt ledger, retries/replay; repository-scoped BYOT signatures, immutable event identity, nonce-protected reads and revocation; actual Worker/workerd tests. | Owned hosted receiver delivery/retry/replay and current external-service receipts pending. Generic transport does not prove any particular vendor integration executed. |
| Saved/failure states and repository navigation | Durable import jobs preserve ownership/source/policy before provider requests; bounded readiness checks and explicit resume; virtualized diffs and lazy source reads. | Current authenticated rendered flows still need observation. Provider import completion, large-history behavior and narrow responsive paths need actual receipts. |
| Authentication, isolation and secrets | Clerk/API-token scope checks, exact-subject ownership, repository roles, validated inputs, server-side credentials; real Docker UID/proc/file/macro isolation proof with fake credentials and networking disabled. | Hosted authorization/isolation exercises still pending. Credential detection is pattern-based; it is not proof that arbitrary previously committed material contains no secrets. |
| Community, profiles, issues and contribution history | Member profiles, issues, review conversations, human/agent attribution and activity; private repositories are not gated by a paid subscription. Explicit owner-confirmed public accepted-source/history/diff browsing and revocable grants have workerd tests. | **Implementation gap:** unaffiliated public contributors have no complete issue/contribution entry path; public community/conversation discovery is not implemented. Confirm free-private and revocation flows on the hosted app. |
| Operational accountability and abuse handling | Scoped availability probes, unique workflow outcome counts, unresolved starts, incident derivation and operator report backlog/resolution storage. | Public health is transport/outcome evidence within its stated scope, not an uptime or successful-workflow guarantee. Actual operator response and incident communication are not yet evidenced. |
| Migration and GitHub independence | Public HTTPS imports, safe ownership-verified legacy reference migration, durable pending import recovery; optional non-forcing GitHub mirror failures do not block canonical work. | No forced shallow depth is requested; imported full-history/other-ref completeness is **unverified**. Long-history import and hosted mirror outage/retry need receipts. Source and original remote references remain distinct. |
| Polished accessible interface | Inter/JetBrains Mono, light/dark semantic colors, focused review surfaces, keyboard diff navigation and responsive source/public screens; build checks. | Verify current authenticated UI across key sizes, keyboard/focus/error states and both themes. Source checks do not establish a complete accessibility audit. |
| License and reproducibility | Apache-2.0 `LICENSE`, pinned implementation checkout, Bun commands, Cloudflare setup and labelled local test/proof runners. | Published source/application URLs are listed above. Reproduce the selected checkout before final entry; hosted setup requires its actual bindings and credentials. |
| Competition delivery | Seven-minute recording runbook and candid submission draft. | **Pending:** actual 5–10 minute recording, entrant eligibility/rights confirmation and required human form submission before the stated deadline. |

Avoid unsupported throughput, scale, uptime or universal conflict-repair claims. A native integrity pass does not mean application CI passed. A provider name is attribution metadata, not evidence of an authorized vendor connection. Merge queues, squash handling, profiles, issues, comments and optional mirroring remain implemented. Imported history completeness and public contribution entry remain subject to the gaps above.

## Human declarations and deadline

The human entrant must separately review [sections 2–4 of the official rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf), confirm eligibility and rights to the material, and personally make the required Workers/Artifacts and terms confirmations in the form. Eligibility includes legal US/Canada residence, age 18 or older at the start, and the stated exclusions. No eligibility claim is made here.

Deadline: **October 14, 2026 at 11:59 p.m. PDT.** Automated entry is prohibited. This draft prepares materials only; it does not enter, register, upload a video, agree to terms, or approve repository history.
