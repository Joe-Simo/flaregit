# Production evidence

Receipts for the competition goal, captured against https://flaregit.com.

| Date (2026) | What | Result |
|---|---|---|
| Oct 9 | `main` at `dece7b1`: GitHub CI `verify` and `native-boundary` | Both passed |
| Oct 9 | `bun test` on Bun 1.4.2 at the merged code | 2495 pass, 9 pre-existing skips, 0 fail |
| Oct 9 | Production deploy, Worker version `a64ab656` | `/` and `/health` 200; anonymous `/api/account` 401; title "Work in parallel. You decide what lands." |
| Oct 9 | Public landing layout at 390px and 1440px, light and dark (`public/`) | No horizontal overflow; both themes render after entrance animation |
| Oct 9 | Security review of new routes | One finding (probe reporter) fixed in `7833306`; no access-control gaps found |
| Oct 9 | Deployed agent image `flaregit-agentsandbox:a64ab656` (linux/amd64) | Runs as root with `setpriv`, `pkill`, `timeout`, `tar`, `git`, Bun 1.4.2; agent loop and edit-format tests inside it: 12 pass, 0 fail. This is the production image run locally, not a production agent run. |

## Signed-in production dry run (Oct 9, repository `demo-tickets`, imported from github.com/Joe-Simo/flaregit-demo-tickets with test command `bun test tests`)

| Goal item | Evidence | Result |
|---|---|---|
| 11 Get started checklist | `signed-in/11-get-started-checklist.jpg` | Ticks from real account state (2 of 3 done) |
| 8 Five tabs + More | `signed-in/08-five-tabs-more.jpg` | Code, Changes, Review, Issues, Settings, More |
| 4, 5 Live board, overlap | `signed-in/04-05-live-board-overlap.jpg` | Live over WebSocket; 3 agents; overlap warnings on `src/pricing.ts`; warnings passed into agents' context |
| 1, 3 Agent rounds and summary | `signed-in/01-03-agent-summary-plan.jpg`, `01-03-agent-summary-tests.jpg`, `01-agent-two-rounds.jpg` | Repository tests (5) ran in the isolated container; one agent's first edit was rejected and it succeeded in round 2 |
| Review | `signed-in/review-waiting-for-human.jpg` | Combined preview with its requirement and passing checks waits for a person |
| Production bug | commits `5bd12cb`, `68440e6` | Native verification closure for test-command repositories fixed and covered by a regression test |

Still to capture: contradiction decision end to end, rebase after merge, merge queue with 3+ changes, 
| Oct 10 | Signed-in Changes tab at 390px and 1440px, light and dark (`signed-in/12-changes-*.jpg`) | No horizontal page overflow; both themes render; healthy changes show no attention alert |
| Oct 10 | Rebase after merge (`signed-in/06-rebase-after-merge.jpg`) | After the human merged the refundable change (`1cf967e`), both other agent changes were restarted on `1cf967e` with their previous work kept; re-running the agents was refused by the managed spend cap (global_budget) |

## Security reviews (Oct 10)

| Scope | Result |
|---|---|
| Live board, overlap, agent loop, coordination, merge queue, rebase, probe runner (Oct 9) | One finding (probe reporter bound before untrusted code) fixed in `7833306` |
| Prepaid credits, Polar webhooks, checkout, auto-recharge, plan-price | Three findings fixed in `62140a4c` deploy: billing changes need an account session, checkout creation rate-limited, only USD orders credited |
| Run-agent-again, post-merge retry, requirement authoring | No vulnerabilities; one low-severity scope-check mismatch noted (requirement examples checked against current rather than target-branch scope) |


## Merge queue and credits on production (Oct 10)

| Evidence | Result |
|---|---|
| `signed-in/07-merge-queue-three.jpg` | Three changes queued in order (#1 group discount landing, #2 revised price guarantee, #3 older price guarantee) |
| `signed-in/07-queue-landed-then-stale-refused.jpg` | After the owner approved #1 it merged (main `1cf967e` → `55f0fac`); the next changes were built on the old base, so the queue refused them as stale ("Being revised · Waiting for the change to be updated and marked ready") and kept their places |
| same screenshot | Prepaid credits enforced: the re-run was refused with "Your credit balance ($0.00) doesn't cover this run ($0.66 is held until it finishes…)" once the 10 free daily runs were used |
| `signed-in/07-three-landed-in-order.jpg` | Three changes landed one at a time in order: `1cf967e` → `55f0fac` → `b25ed14` |

**Defect found in this run (being fixed):** `b25ed14` was an older change that still carried the losing "Price guarantee" requirement; it passed the repository's own tests and was approved, reverting the decided Group discount (`src/pricing.ts` sets `discountAmount = 0`). The decision updated only the change that took part in it, and merges do not yet check decided requirements. Not to be shown as correct behaviour until fixed and re-run.

## Full dry run on production (Oct 10, repository `demo-run`, `docs/evidence/dry-run/`)

| Step | Evidence | Result |
|---|---|---|
| Three agents start with runnable requirements; live board with overlap warnings | `1-live-board.jpg` | Live over WebSocket |
| Contradiction proven by running both changes (136 vs 160); person picks Group discount | `2-contradiction-proof.jpg` | Decision applied |
| Requirement check on the review card | `3-requirement-check-passed.jpg` | "Requirement checks · 1 of 1 passed · Group discount · decided" |
| Discount lands; the other agents redo their changes on the new code | `4-landed-then-agents-rebase.jpg` | Merged `6d80551` |
| Losing change returns revised with the decided requirement and passes it | `5-revised-change-passes-decided-requirement.jpg` | Merged `39f982a` |
| Merged code keeps the decision; plain merge message | `6-merged-plain-commit.jpg`, `6-merged-pricing-ts.txt` | 15% discount kept |
| Third change passes "2 of 2" requirement checks and lands in order | `7-three-landed-in-order.jpg` | Merged `caf4399`: `6d80551` → `39f982a` → `caf4399` |
