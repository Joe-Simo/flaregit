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
