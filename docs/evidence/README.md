# Production evidence

Receipts for the competition goal, captured against https://flaregit.com.

| Date (2026) | What | Result |
|---|---|---|
| Oct 9 | `main` at `dece7b1`: GitHub CI `verify` and `native-boundary` | Both passed |
| Oct 9 | `bun test` on Bun 1.4.2 at the merged code | 2495 pass, 9 pre-existing skips, 0 fail |
| Oct 9 | Production deploy, Worker version `a64ab656` | `/` and `/health` 200; anonymous `/api/account` 401; title "Work in parallel. You decide what lands." |
| Oct 9 | Public landing layout at 390px and 1440px, light and dark (`public/`) | No horizontal overflow; both themes render after entrance animation |
| Oct 9 | Security review of new routes | One finding (probe reporter) fixed in `7833306`; no access-control gaps found |

Signed-in flows (agent rounds, live board, overlap warnings, contradiction decision, merge queue, rebase after merge, Get started checklist, signed-in layouts) are not yet captured here.
