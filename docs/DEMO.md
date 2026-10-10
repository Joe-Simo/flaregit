# FlareGit demo script — seven minutes

Filming plan for the Cloudflare "Build the Next-Gen Git Platform" entry. This is a script, not a recording. Every shot must come from a real run on https://flaregit.com; speed up waiting if needed and say so on screen. Keep the final cut between six and eight minutes.

The script is built around four flows, weighted to the judging criteria (agent collaboration 50%, multi-agent coordination 25%, ease of use 25%):

| Flow | What it proves |
|---|---|
| Contradiction decision | Agents' requirements are checked by running code; a human settles the conflict and the losing agent revises itself. |
| Live agent board | Several agents working at once, visible in real time, with overlap warnings as they happen. |
| Rebase after landing | When one change merges, the other agents' changes move onto the new base and re-check themselves. |
| Merge queue | Three or more changes land one at a time, in order; a stale change is refused and re-queued. |

## Before recording

- Use the current production deploy and note its source commit (shown in the footer / `/status.json`).
- Import the public demo repository `https://github.com/Joe-Simo/flaregit-demo-tickets` as `demo-tickets`, with test command `bun test tests`. Say on camera that it is a test repository.
- Start three agents with these goals and requirements (A and B contradict on purpose; C is independent):

  | Agent | Goal | Requirement example | Expected |
  |---|---|---|---|
  | A | Group discount | 4 tickets × $40 | total `136` |
  | B | Price guarantee | 4 tickets × $40 | total `160` |
  | C | Refundable fee | 2 refundable tickets × $40 | total `90`, `isRefundable` `true` |

- The human entrant must personally click **Approve commit** and personally pick the winning requirement in the contradiction decision. Do not automate either step.
- Sign in with your own account. Keep tokens, emails and personal details off screen; hide the browser bookmark bar.
- Do one full dry run the same day; record the dry-run evidence in `docs/evidence/`.

## Script

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:30 | Home with the "Get started" checklist; open the test repository. | "FlareGit is a Git platform where people and coding agents work side by side, and a human decides what lands." |
| 0:30–1:40 | Start three agents from the three issues. Open the **Agents** board: three rows go live, each showing goal, status, files and round. | "Each agent gets its own real Git workspace. This board updates live — no refreshing." |
| 1:40–2:30 | An overlap warning appears on the board: two agents are editing the same file. Open one agent's change: its plan now mentions the other agent's work. | "FlareGit checks every agent's saved work against the others while they work, and tells the agents about each other." |
| 2:30–3:30 | Open an agent's change: goal, plan, files, test rounds (failed → fixed → passed), plain-language reasoning. | "Agents don't rewrite and hope. They edit, run the tests in an isolated container, read the failures and try again." |
| 3:30–4:50 | **Contradiction decision.** The two conflicting changes are flagged. Show the proof: the same order, two expected prices, each side's actual result from running the code. Pick the winning requirement. The losing agent restarts with the decision as context and produces a revised change. | "Two agents can both be right by their own instructions. FlareGit runs the code to prove the requirements disagree, asks a human to decide once, and the other agent fixes its work to match." |
| 4:50–5:50 | **Merge queue.** Mark the three changes ready. The queue lands them one at a time. Land one change manually first so a queued change goes stale: it is refused with a clear reason and re-queued. | "Changes land in order, each re-checked against the latest code. Nothing stale slips through." |
| 5:50–6:30 | **Rebase after landing.** After a merge, the remaining agent change moves onto the new base and re-runs its checks on the board. | "When something lands, the other agents' work catches up on its own." |
| 6:30–7:10 | Each change's progress bar reads Merged. `git clone` the repository in a terminal and show the merged commits and passing tests. | "What you approved is exactly what's in Git." |
| 7:10–7:30 | Close on the repository page. | "FlareGit — built on Cloudflare Workers, Durable Objects, Workflows, Containers, Artifacts and Workers AI." |

## Rules for the recording

- Show only real runs. If a step fails during filming, show the clear failure state rather than cutting to a different run.
- Label any sped-up section on screen.
- Say "test repository" when it first appears.
- Talk about FlareGit only; the competition rules prohibit disparaging other people or products.
- Do not show tokens, connection secrets, email addresses or private repository contents.
