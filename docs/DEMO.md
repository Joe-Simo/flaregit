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

Every step below was dry-run on production in the repository `demo-run` on October 10 (evidence in `docs/evidence/dry-run/`). Waiting is sped up in the edit and labelled on screen.

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:30 | Home: the Get started checklist and the credits bar. Open `demo-run` (a test repository imported from github.com/Joe-Simo/flaregit-demo-tickets). | "FlareGit is a Git platform where people and coding agents work side by side, and a person decides what lands." |
| 0:30–1:30 | Changes → Start with an agent, three times, each with a requirement and a runnable example: Group discount (4 × $40 → $136), Price guarantee (4 × $40 → $160), Refundable fee (2 refundable × $40 → $90). | "Each agent gets its own real copy of the repository and a requirement FlareGit can run." |
| 1:30–2:20 | The Agents board at the top of Changes: three rows live, then "Also editing src/pricing.ts … edits may conflict." | "The board updates live. Agents see each other's work while they're still working." |
| 2:20–3:00 | Open one change's "What the agent did": plan, reasoning, attempts (tests run in an isolated container; a rejected attempt, then a passing one). | "Agents don't rewrite and hope. They edit, run the repository's tests, read the result and try again." |
| 3:00–4:20 | Select Group discount and Price guarantee → Combine selected (2). Review → Decisions needed: both requirements, each change's code returning $136 vs $160. Click "This one is right" on Group discount → Apply choice. | "Both agents followed their instructions. FlareGit ran the code to prove the requirements disagree, and asks a person to decide once." |
| 4:20–5:20 | Review: the discount's card shows "Requirement checks · passed · Group discount · decided". Approve commit. The queue lands it; the other changes conflict and their agents redo them on the new code. | "Changes land one at a time. When something lands, the other agents catch up on their own." |
| 5:20–6:20 | The revised Price guarantee returns carrying the Group discount requirement and passes it; approve. The refundable change passes "2 of 2" requirement checks; approve. | "The decision sticks. Every later change is checked against it before it can merge." |
| 6:20–7:00 | Code → src/pricing.ts at the merged commit: the 15% discount is still there, the price-guarantee line and refundable fee were added around it. Landed list shows three merges in order. | "What you approved is exactly what's in Git." |
| 7:00–7:20 | Close on the repository page. | "FlareGit — built on Cloudflare Workers, Durable Objects, Workflows, Containers, Artifacts and Workers AI." |

## Rules for the recording

- Show only real runs. If a step fails during filming, show the clear failure state rather than cutting to a different run.
- Label any sped-up section on screen.
- Say "test repository" when it first appears.
- Talk about FlareGit only; the competition rules prohibit disparaging other people or products.
- Do not show tokens, connection secrets, email addresses or private repository contents.
