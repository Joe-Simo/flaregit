# FlareGit demo script (target 8–9 min, hard cap 10)

This is a recording plan, not evidence that a hosted rehearsal or recording has completed. Local Git tests exercise the protocol; they do not establish hosted Artifacts or live agent recovery. Steps marked **[PREP]** need setup before recording. Steps marked **[PRE-RUN]** should be started before the camera rolls, because agent and integration runs take real time.

Placeholders: `<repo>` = repository name, `<CHG>` = change id, `<CAND>` = candidate id, `<host>` = your deployment.

---

## Preparation checklist

- **Accounts.** One FlareGit account signed in through Clerk in the browser (reviewer/owner). A second account (or a second browser profile) is optional for the People tab; the human and agent attribution alone is enough.
- **Deployment.** Set `FLAREGIT_API=https://<host>` before any CLI command, and verify the origin with `auth status`. Follow the README deployment steps first; the CLI otherwise defaults to `https://flaregit.com`.
- **CLI.** `bun cli/flaregit.ts auth login <token>` in a terminal (create the token in the UI; do not show it on screen). Check with `bun cli/flaregit.ts auth status`. Use `--pretty` on every command for readable output.
- **Repos to pre-create.**
  - `demo-main`: `bun cli/flaregit.ts repo demo --name demo-main` (ticket-booking demo repo with platform checks).
  - `demo-acts`: a second demo repo for the scripted Contradiction act, so it does not interfere with beats 1–2.
- **Issue.** In `demo-main` open an issue, e.g. `bun cli/flaregit.ts issue new demo-main "Change refund window" --body "..."`. Note its number `N`.
- **Webhook.** Settings → Add webhook with a receiver you control (e.g. a request-bin you own). For the retry beat, have a second webhook URL that returns 5xx, or temporarily make the receiver fail.
- **Status page.** `/status` only has incidents if probes have failed. If there are none, say so on camera; do not fabricate one.
- **Quota.** Each integration and each agent run consumes one run. Free plan: `FREE_RUNS_PER_DAY = 10` (`wrangler.jsonc`). This script uses about 6–8 runs (agent x2, integrations x3–4, Contradiction act x1). Do a full dry run on a different day, or use a Pro account or raise the cap on your own deployment.
- **Screen.** Browser at ~1440 px wide, terminal beside it, font size up. Close notifications.

---

## Beat 1. Parallel contributions, human and agent (≈1:30)

**Do**
1. Terminal: `bun cli/flaregit.ts work demo-main "Refund window 48h" --issue N --dir human-change`. Run subsequent edit, commit, and `push` commands inside `human-change`.
2. Start two real agent changes before either completes: `bun cli/flaregit.ts change new demo-main "Extend the refund window to 72 hours; preserve checkout behavior" --agent --pretty` and `bun cli/flaregit.ts change new demo-main "Add a clear refund eligibility message and preserve checkout behavior" --agent --pretty`. Record their change IDs and workflow IDs. Use the browser to show both active at once; if they did not overlap in time, repeat the run rather than claim concurrency.
3. Terminal: edit the refund rule in `human-change`, `git commit -am "48h refund window"`, `bun cli/flaregit.ts push`, then `bun cli/flaregit.ts ready demo-main <CHG>`.
4. Browser: Changes tab shows both changes; open **People**.

**Viewer sees:** a human change and two real agent workflows overlapping in time, each on its own Artifacts fork and branch; the agent change flagged as an AI agent; People lists the human and the agent separately.

**Narrate:** "A person and two coding agents work concurrently, each in an isolated Artifacts fork. Their goals, branch commits, and attribution remain visible."

**[PRE-RUN]** Agent runs take minutes. Start the agent before recording and cut to it once it has pushed; say so honestly ("sped up").

---

## Beat 2. Overlapping change: text conflict and AI repair (≈1:30)

**Do**
1. Make sure both changes touched the same lines (the issue wording pushes both to the refund rule; check with `bun cli/flaregit.ts diff demo-main --change <CHG>`).
2. Changes → select both → **Integrate 2 together** (CLI: `bun cli/flaregit.ts integrate demo-main <CHG1> <CHG2>`).
3. Integration tab: watch the stages; open the evidence drawer.

**Viewer sees:** candidate composed on the current accepted head, a text conflict found by `git merge-tree`, an **AI Repair** round confined to the change scope, then **Verification** passing. The repair is listed in the evidence the reviewer sees.

**Narrate:** "Both edited the same lines, so FlareGit composes them on the accepted head, repairs the conflict, and shows the repair to the reviewer instead of hiding it."

**Backup:** if the live agent did not overlap, use the scripted **Text conflict** button on the Integration tab of `demo-acts`.

---

## Beat 3. Contradiction pauses for one product decision (≈1:00)

**Do**
1. `demo-acts` → Integration → **Contradiction**.
2. When **Product Decision Required** appears, read the question; pick an option; **Apply Choice & Auto-Integrate**.
3. Before choosing, cut to Commits / Code to show the head has not moved.

**Viewer sees:** integration paused with one question; the last accepted version unchanged; after the choice, integration continues.

**Narrate:** "When two requirements contradict each other, FlareGit stops and asks one product question; the accepted version stays live until a person answers."

---

## Beat 4. Stale base: refusal without work loss (≈0:50)

The hosted merge queue holds a landing lease while a candidate awaits review. Starting another normal integration behind it does **not** reliably move the accepted head: it queues. Do not stage that sequence as a stale-base demonstration.

Show the executable local Git check instead:

```bash
bun test tests/platform.test.ts --test-name-pattern "stale base is refused"
```

Open the corresponding test: it moves the real canonical ref after candidate creation, attempts publication, and asserts that the newer ref is preserved. Say: "This is a local real-Git fault-injection check, with a scripted model. It proves the stale publication guard, not hosted failure recovery." A hosted equivalent remains a recording gate until rehearsed with an authorized independent canonical-ref update and a recovered ledger.

---

## Beat 5. Human review on the exact commit (≈1:15)

**Do**
1. Changes → **Review** on the change (or the candidate in Integration, **Waiting for your review**).
2. In the diff press `j`/`k` (next/previous file), `n`/`p` (next/previous hunk), `?` for the help.
3. Add a line comment (CLI equivalent: `bun cli/flaregit.ts comment demo-main "Why 48h?" --candidate <CAND> --path <file> --line <n>`).
4. **Accept into history** (CLI: `bun cli/flaregit.ts accept demo-main <CAND> --note "ok"`).

**Viewer sees:** keyboard-driven diff, a line comment in the conversation, the "N of M checks passed. Accepting moves the branch to exactly this commit." text, then accept.

**Narrate:** "The approval is bound to this exact candidate commit; what I review is byte-for-byte what lands."

Optional: `bun cli/flaregit.ts review demo-main --change <CHG>` shows the terminal reviewer with the same keys.

---

## Beat 6. Durable integration: commit, webhooks, issue (≈1:00)

**Do**
1. **Commits** tab: the new landed commit at the top (or `bun cli/flaregit.ts log demo-main --limit 3 --pretty`).
2. **Settings** → webhooks → **Delivery log**: point at the event, `#<seq>`, attempts, HTTP status. Mention the `webhook-signature` header (show it in your receiver).
3. For the failing webhook: entry shows "retrying" with attempts increasing; click **Redeliver** (manual replay).
4. **Issues** → issue `N`: closed, with the FlareGit comment "Resolved by change … accepted as <sha>".

**Narrate:** "Events are emitted only after the ref update commits, in order, signed, retried, and replayable; the issue closes itself with the commit reference."

**[PREP]** Receiver set up before recording.

---

## Beat 7. Recovery after interruption (≈0:55)

Cancellation is not recovery: cancellation deletes the task fork. Do not cancel the change whose work you intend to recover.

For reproducible protocol evidence, run:

```bash
bun test tests/platform.test.ts --test-name-pattern "crash recovery settles"
```

Show the test: a real Git landing exists; the persisted journal is deliberately restored to PREPARED, then a fresh controller restores from disk and reconciles against the actual Git ref. It checks both accepted and aborted outcomes. Narrate precisely: "This local test reconstructs an interrupted publication journal and recovers from the real repository ref. Its model is scripted; this is not a live Cloudflare crash."

**Hosted recording gate:** capture a real workflow interruption and restart against the same pushed change branch, its pre-interruption SHA, the resumed SHA (verify the former is an ancestor), preserved task comments, and final accepted SHA. The current CLI has no workflow interrupt/resume command. Use an authorized Cloudflare workflow control only after a rehearsal, and record the exact operation. Do not replace this gate with cancellation, code narration, or an unverified promise. Until captured, the competition's live interruption-recovery demonstration remains incomplete.

---

## Beat 8. Status page with raw evidence (≈0:30)

**Do:** open `https://<host>/status` (and `/status.json`).

**Viewer sees:** each subsystem with its latest check, failed checks in the last 24 h, and an incidents table (subsystem, started, ended, duration, failed checks, last error). No uptime percentage.

**Narrate:** "Every subsystem is probed every 5 minutes, and we publish raw failure counts and incidents, not an averaged uptime number."

---

## Closing (≈0:20)

"FlareGit is open source under Apache-2.0: <repo link>. Self-host it on your own Cloudflare account with the steps in the README."

---

## Things not to claim

- No throughput, user, or "N agents at once" scale numbers. Limits that exist: one landing at a time per project, at most 8 changes per integration, 7-day review window, 20-minute landing lease.
- Only cite measured numbers that appear in the README: diff time-to-interactive about 0.8–1 s in Safari; 60 fps scrolling at 3,000–8,000 px/s with at most about 100 DOM rows for a 12k-line diff; the landing-race test runs 20 branches by default and can be run with 500 (`RACE_BRANCHES=500`). Say "a test you can run", not a production benchmark.
- No uptime percentage.
- Do not claim the AI repairs every conflict: failing repairs are blocked, not published.
- Do not claim ongoing sync from GitHub: imports are one-time clones (depth 200). You may show the optional one-way mirror to GitHub only if you configured it and it shows an ok run.
- Do not claim contradiction detection works on free-form text; it needs structured assertions on requirements.
- If a step was sped up or pre-run, say so.

## Reproducible local Git recording insert (≈1:00)

```bash
bun run demo:proof
```

This standalone protocol demonstrator requires only Bun and Git. It creates two isolated clones and commits/pushes concurrently with `Promise.all`, exposes a native text conflict, records an explicit predetermined resolution, rejects a stale compare-and-swap push, and preserves an independent maintainer commit. It then deletes the integration workspace after publication while its journal is PREPARED, fresh-clones the repository, reconciles that journal, and verifies both contributions' files. The printed directory retains `canonical.git`, `journal.json`, and `receipt.json` with actual commit SHAs.

For the recording, run it, open the emitted receipt, and show `git --git-dir <printed-directory>/canonical.git log --all --graph --oneline`. Label this insert **local real Git, deterministic contributors**. It is a standalone Git protocol illustration; it does not run the FlareGit controller, Cloudflare workflows, AI agents, human review, or a process-kill experiment. Pair it with the platform tests above, and retain the hosted recovery/concurrency gates. It is not a substitute for the required real-agent demonstration.

## Evidence to retain before submission

Save the final 5–10 minute recording and repository URL, plus the deployed source commit; real overlapping agent workflow IDs and timestamps; each contribution base/head; conflict evidence and reviewer decision; accepted commit SHA verified by a fresh clone; webhook event ID, attempts and replay; and interruption/recovery receipts. Record what was pre-run or edited for time. None of these receipts are supplied by this script itself.

The human entrant must separately confirm eligibility and complete the required entry process before October 14, 2026 at 11:59 p.m. Pacific. This repository does not submit an entry or establish eligibility.

## Official competition checklist (verified October 2, 2026)

Cloudflare's [official rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf), sections 2–4 and 6, specify:

- Deadline: October 14, 2026, 11:59 p.m. PDT.
- Build with Workers and Artifacts and enable multiple agents to work concurrently.
- Provide a 5–10 minute video, source repository, running instructions, and an approved open-source LICENSE. The Apache-2.0 LICENSE in this repository satisfies the license choice.
- Judging: originality/prototype quality 50%; concurrency, coordination, context preservation, review, and conflict handling 25%; product experience 25%.
- The entrant must confirm eligibility separately: legal US/Canada residence, age 18 or older at the start, and the exclusions in section 3. Eligibility is not established by this repository.
- Entry must be performed by a human: the rules prohibit automated entry.

The [human submission form](https://www.cloudflare.com/git-competition/submit/) requires the project vision, Cloudflare usage, repository URL, run instructions, team/contact details, and video upload (MP4, WebM, or MOV, maximum 2 GiB). No entry has been submitted by these instructions.

A live read of GitHub metadata on October 2 returned [Joe-Simo/flaregit](https://github.com/Joe-Simo/flaregit) as **PRIVATE**, with Apache-2.0 detected. Public open-source access remains a delivery gate; recheck visibility before using that URL in the submission. A private repository with a LICENSE is not evidence of public publication.

## Observed local AI run — October 2, 2026

`bun run demo` ran two Workers AI coding agents concurrently through `Promise.all` in separate real Git workspaces for each act, using `@cf/openai/gpt-oss-120b`. These are local controller results with a live Cloudflare model; they do not verify hosted Artifacts containers or the hosted human-review gate. The local scenario controller accepts verified candidates automatically.

| Act | Observed result | Recoverable accepted commit |
|---|---|---|
| Overlapping edits | Native text conflict; two repair rounds; protected verification passed | `4baf67b933b84299be1cb638c40fbd7d2ddfaa0f` |
| Clean merge, broken behavior | Protected verification detected failure; two repair rounds; verification passed | `7dc4e11e4d36c99403bbdedc658ad090a5ed5cea` |
| Contradictory requirements | Paused: “Should the group discount apply to the refund fee?” | Accepted head remained `7dc4e11e4d36c99403bbdedc658ad090a5ed5cea` |

Local receipts and repositories were retained at `.flaregit-storage/demo-run-0mcEuC/`, including `controller/flaregit-local.state.json` with six agent commits, five verification records, and two accepted publication journal entries. This ignored directory belongs to the observed workstation run; use `bun run demo` with your Cloudflare credentials to produce your own receipts. The competition recording and hosted acceptance gates remain pending.
