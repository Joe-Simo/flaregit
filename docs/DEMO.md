# FlareGit demo script (target 8–9 min, hard cap 10)

Every step uses a feature that exists in this repo. Steps marked **[PREP]** need setup before recording. Steps marked **[PRE-RUN]** should be started before the camera rolls, because agent and integration runs take real time.

Placeholders: `<repo>` = repository name, `<CHG>` = change id, `<CAND>` = candidate id, `<host>` = your deployment.

---

## Preparation checklist

- **Accounts.** One FlareGit account signed in through Clerk in the browser (reviewer/owner). A second account (or a second browser profile) is optional for the People tab; the human and agent attribution alone is enough.
- **CLI.** `bun cli/flaregit.ts auth login <token>` in a terminal (create the token in the UI; do not show it on screen). Check with `bun cli/flaregit.ts auth status`. Use `--pretty` on every command for readable output.
- **Repos to pre-create.**
  - `demo-main`: `bun cli/flaregit.ts repo demo --name demo-main` (ticket-booking demo repo with platform checks).
  - `demo-acts`: a second demo repo for the scripted Contradiction act, so it does not interfere with beats 1–2.
- **Issue.** In `demo-main` open an issue, e.g. `bun cli/flaregit.ts issue new demo-main "Change refund window" --body "..."`. Note its number `N`.
- **Webhook.** Settings → Add webhook with a receiver you control (e.g. a request-bin you own). For the retry beat, have a second webhook URL that returns 5xx, or temporarily make the receiver fail.
- **Status page.** `/status` only has incidents if probes have failed. If there are none, say so on camera; do not fabricate one.
- **Quota.** Each integration and each agent run consumes one run. Free plan: `FREE_RUNS_PER_DAY = 10` (`wrangler.jsonc`). This script uses about 6–8 runs (agent x1–2, integrations x3–4, Contradiction act x1). Do a full dry run on a different day, or use a Pro account or raise the cap on your own deployment.
- **Screen.** Browser at ~1440 px wide, terminal beside it, font size up. Close notifications.

---

## Beat 1. Parallel contributions, human and agent (≈1:30)

**Do**
1. Terminal: `bun cli/flaregit.ts work demo-main "Refund window 48h" --issue N --dir human-change`
2. In the same moment, in the browser on Issues → issue `N` → **Ask an agent**. (Alternative: Changes → **Start a change**, then **Agent** on its row.)
3. Terminal: edit the refund rule in `human-change`, `git commit -am "48h refund window"`, `bun cli/flaregit.ts push`, then `bun cli/flaregit.ts ready demo-main <CHG>`.
4. Browser: Changes tab shows both changes; open **People**.

**Viewer sees:** two changes created at the same time, each on its own Artifacts fork and branch; the agent change flagged as an AI agent; People lists the human and the agent separately.

**Narrate:** "A person and an AI agent start on the same issue at the same moment, each in its own isolated Artifacts fork, pushed with plain git."

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

## Beat 4. Stale base: compare-and-swap refusal (≈1:00) [PREP]

**Do**
1. Leave the Beat 2 candidate waiting for review (do not accept yet).
2. Land a different small change first: `work`, push, `ready`, `integrate`, then `bun cli/flaregit.ts accept demo-main <OTHER_CAND>`.
3. Now try to accept the Beat 2 candidate: `bun cli/flaregit.ts accept demo-main <CAND>`.
4. Show the candidate marked stale (`bun cli/flaregit.ts candidates demo-main --all --pretty`), then re-run `integrate` for the two changes.

**Viewer sees:** the push is refused because the branch moved since the candidate was frozen; the candidate is stale; the head contains the other change, nothing overwritten; re-run produces a new candidate on the new head.

**Narrate:** "The branch moved, so the compare-and-swap push is refused, the candidate goes stale and is re-run; nothing is overwritten."

**Prep note:** costs two extra runs. Rehearse the timing: the second integration must finish before the first candidate is accepted.

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

## Beat 7. Recovery after interruption (≈0:45)

**Do (pick what you can show)**
- Changes → cancel a running agent change (the **X** on its row, or `bun cli/flaregit.ts cancel demo-main <CHG>`). Show it marked Cancelled and that the accepted head is untouched.
- Or show an agent change that resumed from its already pushed branch (its branch commits in the change view).

**Narrate (code reference, not a live crash):** "Delivery rows are written in the same transaction as the event, and a Durable Object alarm re-sends anything not yet queued; publication rehydrates from the stored candidate ref, so a crashed step needs no original workspace."
Reference on screen briefly: `src/server/durable-object.ts` (transactional outbox, `alarm()`), and `tests/platform.test.ts` (crash recovery cases).

**Honesty:** do not stage a fake crash. Killing a container mid-run is not reliably reproducible on camera; narrate with the code reference instead.

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
