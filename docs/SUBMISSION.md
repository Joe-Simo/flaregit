# Cloudflare competition entry draft — FlareGit

Draft only. Nothing has been sent through the competition form. Entrant details and the final eligibility confirmation are the human entrant's to make in the form. The required video is unfinished.

This document maps to the [actual Cloudflare entry form](https://www.cloudflare.com/git-competition/submit/), inspected October 2 and re-checked October 9, 2026: the same 14 fields (team, project, demo and source) plus two declaration checkboxes, no stated character limits, and a 2 GiB MP4/WebM/MOV video upload. The form notes that submission details and video are retained for up to 180 days. The event uses Cloudflare's own form; it is not a Devpost entry.

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

FlareGit is a Git platform where several coding agents work on one repository at the same time, and a person decides what lands. Each part has one purpose and one place:

- **Agents that check their own work.** Each agent edits a real copy of the repository, runs the repository's own tests in an isolated container, reads the failures and tries again, within a fixed number of rounds. A change only reaches review after its tests pass.
- **A live board.** The Agents board shows every agent's goal, status, files and round as it happens, and warns when two agents are editing the same file. Agents are told about each other's in-flight work, so they can plan around it.
- **Requirements you can run.** A requirement is a plain statement plus a runnable example: a file, a function, an input and the expected result. When two agents' requirements disagree, FlareGit finds it by running the code, shows both expected and actual results, and asks a person to decide once. The other agent then revises its change to match.
- **Changes land in order.** A merge queue lands ready changes one at a time, re-checking each against the latest code. After a merge, the other agents' changes are moved onto the new code and re-checked automatically.
- **A person always decides.** Every change shows what the agent did: its goal, plan, reasoning, files and attempts, with the requirement and test results beside it. Nothing merges until a person approves it.

The interface is built around five tabs plus More, a five-step progress bar on every change, and a Get started checklist that reflects the repository's real state. This is a working prototype; items still awaiting a recorded end-to-end run are listed under "Pending verification" below.

## How you used Cloudflare — proposed form copy

- **Workers** serves the app and its API.
- **Artifacts** stores every repository and each agent's separate copy, reached through ordinary Git.
- **Durable Objects** hold each repository's shared state: the live agent board (pushed to browsers over WebSocket), requirements and the decisions people make about them, and the merge queue.
- **Containers** run each agent's edits and the repository's own tests in isolation, so agent code never runs next to the platform.
- **Workflows** drive the agent loop (plan, edit, test, retry) and the path from review to merge, so work resumes after an interruption.
- **Queues** carry events between these steps; **R2** stores test output and other files a change produces.
- **Workers AI** powers the built-in coding agents. You can also bring your own agent through ordinary Git.

## Judging criteria map — for planning, not form copy

The rules score three criteria from 1 to 5. Weight the video and form copy accordingly:

| Criterion | Weight | What to show |
|---|---|---|
| Originality and quality of the agent-oriented collaboration prototype (also the tiebreaker) | 50% | Agents that run the repository's tests in isolated containers and retry; runnable requirements; contradictions found by running code and settled once by a person. |
| Multi-agent concurrency, coordination, context, review and conflicts | 25% | Three agents live on the board with overlap warnings; merge queue; automatic rebase of other agents' changes after a merge. |
| Ease of use and product experience | 25% | Five tabs plus More, per-change progress bar, Get started checklist, "What the agent did", and the "Waiting for your review" screen. |

Keep the video and copy about FlareGit; the rules prohibit disparaging other people or products.

## Demo video — required, unfinished

**TODO: attach the actual final 5–10 minute MP4, WebM, or MOV, at most 2 GiB.** No video URL or file is claimed in this draft.

Use the [seven-minute recording runbook](DEMO.md). Capture real overlapping agents, an actual conflict, stale-base handling, saved context across interruption, exact human review, accepted Git state recovered through a fresh clone, and delivery/replay at a receiver you control. Disclose pre-runs or sped-up waiting. Screenshots and deterministic test scripts do not substitute for the required recording.

## Open source repository URL

[https://github.com/Joe-Simo/flaregit](https://github.com/Joe-Simo/flaregit) — public, Apache-2.0, with a LICENSE file; visibility and GitHub's detected license were checked October 2.

Source snapshot: `main` (see final commit at submission). Before submitting, record that commit here along with its `bun run typecheck`, `bun run lint`, `bun test` and GitHub CI results.

Public application: [https://flaregit.com](https://flaregit.com), Worker version `a64ab656` on October 9: `/` and `/health` returned HTTP 200 and an anonymous `/api/account` returned 401 (`docs/evidence/README.md`). Sign-in is required to work in a repository; the public demo repository above is the suggested starting point.

## Instructions to run your project — proposed form copy

**Try it on flaregit.com**

1. Go to https://flaregit.com and sign in with your own account.
2. Import the public demo repository `https://github.com/Joe-Simo/flaregit-demo-tickets`. Name it `demo-tickets` and set the test command to `bun test tests`.
3. Start two or three agents, each with a goal and a requirement (a statement plus an example: file, function, input, expected result).
4. Open the **Agents** board to watch them work live. Overlapping files are flagged as they happen.
5. Open a change to see what the agent did and its test rounds. When it reads "Waiting for your review", check the requirement and tests, then approve it yourself.

Private repositories do not require a paid plan. Built-in agent runs have usage limits.

**Run the source**

Install Bun and Git, then:

```bash
git clone https://github.com/Joe-Simo/flaregit.git
cd flaregit
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun test
```

To host your own copy, follow the README's Cloudflare setup (Workers Paid, Artifacts, Durable Objects, Containers, Workflows, Queues, R2, Workers AI, and Clerk for sign-in). Set secrets with `wrangler secret`, then run `bun run build` and `bunx wrangler deploy`.

## Verified on production (October 9) and pending verification — planning, not form copy

Verified on https://flaregit.com while signed in:

| Claim | Evidence |
|---|---|
| Live agent board over WebSocket with three agents and overlap warnings on `src/pricing.ts` | `docs/evidence/signed-in/04-05-live-board-overlap.jpg` |
| Agents run the repository's tests (`bun test`, 5 tests) in an isolated container with bounded rounds; one agent used two rounds after its first edit was rejected | `docs/evidence/signed-in/01-agent-two-rounds.jpg`, `docs/evidence/signed-in/01-03-agent-summary-tests.jpg` |
| "What the agent did": goal, plan, reasoning, files, attempts | `docs/evidence/signed-in/01-03-agent-summary-plan.jpg` |
| Five primary tabs plus More; five-step progress bar per change | `docs/evidence/signed-in/08-five-tabs-more.jpg` |
| Get started checklist built from real repository state | `docs/evidence/signed-in/11-get-started-checklist.jpg` |
| Requirements attached to changes (title, statement, runnable example) and a review screen reading "Waiting for your review" with the requirement and checks | `docs/evidence/signed-in/review-waiting-for-human.jpg` |
| A production bug found and fixed: verification for repositories with a test command now closes with the right checker | commits `5bd12cb`, `68440e6` |

Pending verification (do not claim as done until recorded):

- Contradiction decision, end to end (proof shown, person picks, the other agent revises).
- Automatic rebase of other agents' changes after a merge.
- Merge queue landing three or more changes.
- Signed-in layouts in light and dark at 390px and 1440px.

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
| Competition delivery | Seven-minute recording runbook, candid submission draft, pinned snapshot verified October 9. | **Pending:** actual 5–10 minute recording, the entrant's rights confirmation and the required human form submission before the stated deadline. |

Avoid unsupported throughput, scale, uptime or universal conflict-repair claims. A native integrity pass does not mean application CI passed. A provider name is attribution metadata, not evidence of an authorized vendor connection. Merge queues, squash handling, profiles, issues, comments and optional mirroring remain implemented. Imported history completeness and public contribution entry remain subject to the gaps above.

## Human declarations and deadline

The human entrant must separately review [sections 2–4 of the official rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf), confirm eligibility and rights to the material, and personally make the required Workers/Artifacts and terms confirmations in the form. Eligibility includes legal US/Canada residence, age 18 or older at the start, and the stated exclusions. The entrant has stated they are a US citizen; residence, age and the exclusions are still confirmed only by the entrant in the form.

Deadline: **October 14, 2026 at 11:59 p.m. PDT** (the form shows only "October 14"; the PDT time comes from the official rules). Winners are announced October 16; finalists present at Cloudflare Connect, San Francisco, October 21. Automated entry is prohibited. This draft prepares materials only; it does not enter, register, upload a video, agree to terms, or approve repository history.
