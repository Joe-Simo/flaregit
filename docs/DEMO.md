# FlareGit recording runbook — seven minutes

This is a filming plan, not a completed video or submission. Show real work and retained receipts. Speed up actual waiting if needed, label the edit, and keep the final recording between five and ten minutes. Screenshots can support visual review; they do not establish a movie or a successful workflow.

## Before recording

Use the current deployed release and note its exact source SHA. The interface uses Inter with JetBrains Mono for code, a restrained orange accent, a compact landing page, and a repository-first dashboard. Record the rendered browser at about 1440 px and check the same flow on a narrow screen. Keep the product visible rather than spending the demo reading implementation files.

Last recorded hosted exercise: repository `pbd425298ee02`, accepted baseline beginning `69c59c2`, candidate beginning `2bb6`, awaiting human review. These are historical pointers, not a fresh state read or evidence of acceptance. Open the authenticated repository and recheck the full SHA, candidate ID/status, checks, branch checkpoints, and comments before filming. Do not approve an abbreviated SHA or create a receipt by guessing missing IDs. Browser sign-in is available; a CLI account token is needed separately for the commands below.

Start new concurrency exercises in a new owned test repository, with its fixture purpose stated on camera. Do not mix an older diagnostic receipt with a newer functional run. New hosted-runner receipts request real discount and refundable-ticket features in `src/pricing.ts`; older unlabeled receipts used comment-only diagnostics and must retain that label.

Load credentials before recording, without arguments or echoed values. In zsh:

```zsh
read -s 'FLAREGIT_TOKEN?FlareGit account token: '
export FLAREGIT_TOKEN
export FLAREGIT_ORIGIN=https://flaregit.com
export FLAREGIT_API="$FLAREGIT_ORIGIN"
```

Keep shell tracing disabled. Use your own account token and receiver. Recordings must not show tokens, newly issued connection secrets, sensitive repository contents, or personal account details.

```bash
bun cli/flaregit.ts auth status --pretty
bun run demo:hosted prepare /tmp/flaregit-hosted-receipt.json
bun run demo:hosted status /tmp/flaregit-hosted-receipt.json
```

`prepare` creates an owned test repository, issue, two task comments carrying shared policy, and concurrently requests two actual agent workflows. Requested timestamps alone do not prove simultaneous execution: retain provider observations demonstrating overlap, separate forks, and native branch commits. If either run fails, show its honest status and recover it; do not substitute a simulated agent.

Each agent run and integration consumes managed-run allowance. Core collaboration and basic private repositories do not require Pro, but integrations still use FlareGit compute. Record current limits and any pre-run costs from the account rather than promise unlimited free execution. Contributor checks/previews require the deployed Linux isolation boundary. Same-user `NODE_ENV=test` fixtures are not production isolation proof; the local live-model demo fails closed outside the secure boundary.

## Seven-minute sequence

| Time | Show | Evidence and narration |
|---|---|---|
| 0:00–0:35 | Landing, sign-in, repository | “Parallel Git work, with purpose and human control over what lands.” Label the owned exercise as a test repository. Show the deployed source SHA. |
| 0:35–1:45 | Issue, two live agent changes, People | Read each functional goal: 15% discount from four tickets, and $5 refundable fee. Show both real runs overlapping, distinct forks/commits, and saved shared comments. Four refundable $40 tickets should total $156 under the approved fixture policy. |
| 1:45–2:40 | Compose the two changes; conflict/evidence | Show an observed overlap and actual native conflict, or state that this run merged cleanly. For a genuine conflict, inspect repair/resolution evidence. External-only CI mode stops for explicit conflict resolution and does not silently run AI repair. |
| 2:40–3:40 | Exact candidate diff, line comment, checks | Review full commit/tree/base identifiers and relevant changed lines. Explain whether checks are platform application checks, external CI, or native Git integrity only. A human explicitly accepts or rejects the exact candidate after inspecting it. |
| 3:40–4:25 | Accepted history and fresh clone | Show the persisted human review and accepted SHA, then run hosted verify. Successful output must match the accepted SHA from a fresh native clone and Git integrity check. |
| 4:25–5:15 | Pause/resume and preserved context | Show actual provider states before/after a permitted pause and resume, the same branch/context, and subsequent commits. Explain that pause may finish the current step; it is not a process-kill crash. |
| 5:15–6:20 | Connected check/comment and delivery replay | Show a scoped service reporting on the exact candidate, plus an owned webhook receiver's failure/retry/replay receipts and stable event ID. A report cannot approve history. Do not claim success from an unreceived callback. |
| 6:20–7:00 | Stale-base safety, health, source | Show hosted stale refusal if actually captured; otherwise label the real-Git local fault-injection test. Show workflow health with its scope, Apache-2.0 source, reproducible instructions, and the remaining alpha limits. |

The timings are editorial targets. Waiting can occur before filming or be sped up with disclosure. The final film must include actual parallel contributions, an overlap/conflict, stale-base handling, human review, durable integration, and interruption recovery. A table or local unit check does not close a missing hosted evidence gate.

## Integration, human review, and verification

After both actual changes are ready:

```bash
bun run demo:hosted integrate /tmp/flaregit-hosted-receipt.json
bun run demo:hosted status /tmp/flaregit-hosted-receipt.json
```

The runner never accepts review. A human opens the exact candidate in the app, reads its diff, repairs and checks, adds a line comment, and explicitly accepts or rejects. Only after human acceptance:

```bash
bun run demo:hosted verify /tmp/flaregit-hosted-receipt.json
```

`verify` requires approval bound to the current accepted commit, fresh-clones with a short-lived credential, verifies the commit and Git integrity, and rechecks that accepted state has not advanced. It records success only when these agree. It does not prove interruption recovery, external CI delivery, or webhook replay.

Unknown mutations are retained as `pendingAction`/`pendingAgents`. The runner refuses duplicate dispatch. Inspect the authenticated app and reconcile the exact resource/run before retrying; never clear pending fields blindly. Status observations include persisted task workflow IDs to help reconcile a lost dispatch response.

## Workflow interruption

Use exact IDs from the receipt:

```bash
bun cli/flaregit.ts workflow status <project-id> <workflow-id> --pretty
bun cli/flaregit.ts workflow pause <project-id> <workflow-id> --pretty
bun cli/flaregit.ts workflow status <project-id> <workflow-id> --pretty
# Resume only after the provider reports paused:
bun cli/flaregit.ts workflow resume <project-id> <workflow-id> --pretty
bun run demo:hosted status /tmp/flaregit-hosted-receipt.json
```

Repository owners control registered runs; an agent run's recorded initiator can control that agent run. Older unregistered agent runs cannot be controlled by guessing an ID. A persisted candidate-to-workflow association provides an exact integration fallback. `waitingForPause` means the transition is incomplete; show it honestly. Cancellation preserves pushed forks, but cancellation alone is not recovery.

Retain pre-interruption and resumed SHAs, prove the earlier saved work remains an ancestor where applicable, preserve conversation IDs, and verify the final accepted SHA. A killed-container recovery claim requires its own real fault and receipts.

## External CI and service reports

Use a custom imported repository for external-only CI, with a maintainer-selected required check, a policy captured before integration, and a registered run. Native integrity proves Git objects, frozen refs, scopes, and ancestry; it does not claim application tests passed. External-only composition runs no customer install/build/test or previews and blocks automatic conflict repair. Demonstrate a real service run, signed callback, passed required gate, and subsequent human review before describing external CI replacement as hosted-verified.

Read the one-time connection secret privately into the local service environment:

```zsh
read -s 'FLAREGIT_CONNECTION_SECRET?Connection signing secret: '
export FLAREGIT_CONNECTION_SECRET
```

```bash
bun cli/flaregit.ts service-candidate <project-id> <candidate-id> --service <connection-id> --commit <exact-40-character-SHA> --pretty
bun cli/flaregit.ts report <project-id> --service <connection-id> --file <report.json> --event <stable-event-id> --pretty
```

The snapshot exposes metadata and that service's assigned checks, not source or a clone token. A check report must include `type`, `candidateId`, `commit`, `tree`, `checkId`, `runId`, `policyVersion`, `sequence`, `status`, and `summary`; an automated comment includes `type`, `candidateId`, `commit`, and `body`, with an optional path/line. The CLI uses HMAC and no human bearer token. Reuse an event ID only with unchanged report contents; use a fresh event for a new status. Fresh timestamp/signature on a retry does not change durable event identity. Revoke the connection and show a denied request if recording capability enforcement.

Configure a webhook receiver you control in Settings. Record its receipt alongside FlareGit delivery status, sequence, attempts, and stable event ID. Intentionally fail only that owned receiver, restore it, and have the human select Redeliver. Replay must be observable at the receiver and safely deduplicated. Connected service callbacks and outbound webhooks are separate paths; show both if claiming both.

## Local evidence inserts and limitations

```bash
bun run demo:proof
bun test tests/platform.test.ts --test-name-pattern "stale base is refused|crash recovery settles"
bun test tests/native-integrity.test.ts
```

`demo:proof` uses deterministic scripted contributors and real concurrent Git clones/commits. It exposes a conflict, records a predetermined decision, refuses stale publication, and reconstructs a PREPARED journal after deleting a workspace. It is neither AI-agent evidence nor a hosted process crash. It prints a retained repository/receipt directory.

The platform stale test supplies an outdated expected base against an advanced canonical ref. The local recovery test reconstructs a publication journal and restores from real Git. Native-integrity tests execute actual Git and verify that customer source is not evaluated. These are protocol/fixture evidence; they do not establish customer-scale throughput, hosted reliability, or observed external service delivery.

Historical local Workers AI run on October 2 used `@cf/openai/gpt-oss-120b` and real parallel workspaces. Its retained `.flaregit-storage/demo-run-0mcEuC/controller/flaregit-local.state.json` recorded six agent tasks, five verification records, and two ACCEPTED entries: `4baf67b933b84299be1cb638c40fbd7d2ddfaa0f` and `7dc4e11e4d36c99403bbdedc658ad090a5ed5cea`. This is a historical local-controller receipt with automatic local acceptance; it proves neither hosted human review nor the newer execution security boundary. That ignored workstation directory is not distributed with the source.

Retain the final video, deployed source SHA, full contribution/candidate/accepted SHAs, overlapping workflow observations, conflict and stale refusal evidence, explicit human review, fresh-clone proof, interruption context, and receiver receipts. Current gaps must remain visible until those artifacts exist: hosted native external CI, callback/replay, interruption, stale-base handling, and the complete recording. Last-known candidate review is not completed acceptance.

```bash
unset FLAREGIT_TOKEN FLAREGIT_CONNECTION_SECRET
```

## Human competition entry

The [official rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf) require Workers and Artifacts, multiple concurrent agents, an approved LICENSE, run instructions, and a 5–10 minute video. Deadline: October 14, 2026 at 11:59 p.m. PDT. Judging weights prototype originality/quality 50%, concurrency/coordination/context/review/conflicts 25%, and product experience 25%.

The human entrant must separately confirm eligibility, including legal US/Canada residence, age 18 or older at the start, and the exclusions in section 3. The rules prohibit automated entry. The [human form](https://www.cloudflare.com/git-competition/submit/) requires team/contact information, project vision, Cloudflare usage, source URL, running instructions, and MP4/WebM/MOV upload up to 2 GiB. No submission or eligibility confirmation is established by this runbook.

Use the [Apache-2.0 repository](https://github.com/Joe-Simo/flaregit); recheck public access and the exact release SHA before entry. Preserve original contributions and keep the narration about product behavior, without personal attacks or unsupported comparisons.
