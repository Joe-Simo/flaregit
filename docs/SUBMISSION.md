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

| Evidence | Status |
|---|---|
| Prior hosted concurrent contributions, conflict and saved issue/conversation context | Recorded in the owned exercise `pbd425298ee02`; accepted baseline began `69c59c2`, candidate began `2bb6` and awaited review. Recheck full IDs and state before filming; this does not establish accepted history. |
| Public source and application URL | Verified as described above; use the pinned implementation checkout for reproducibility. |
| New staged agent proposal/retry/resume and native external-CI safeguards | Implemented with native-Git and workerd/fixture verification. These checks are not proof that the latest hosted stages have been exercised. |
| Human approval and fresh-clone verification for the hosted exercise | **TODO: obtain explicit human review and actual matching accepted/clone SHA receipts.** |
| Hosted interruption/resume, external service callback, stale refusal, receiver retry/replay | **TODO: capture actual hosted receipts for each claimed behavior.** |
| Final competition video | **TODO: record, review and attach.** |
| Eligibility and final entry | **TODO: human confirmation and human form entry.** |

Avoid unsupported throughput, scale, uptime or universal conflict-repair claims. A native integrity pass does not mean application CI passed. A provider name is attribution metadata, not evidence of an authorized vendor connection. Original contributor history, merge queues, squash handling, profiles, issues, comments and optional mirroring remain part of the product rather than being removed to avoid failure cases.

## Human declarations and deadline

The human entrant must separately review [sections 2–4 of the official rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf), confirm eligibility and rights to the material, and personally make the required Workers/Artifacts and terms confirmations in the form. Eligibility includes legal US/Canada residence, age 18 or older at the start, and the stated exclusions. No eligibility claim is made here.

Deadline: **October 14, 2026 at 11:59 p.m. PDT.** Automated entry is prohibited. This draft prepares materials only; it does not enter, register, upload a video, agree to terms, or approve repository history.
