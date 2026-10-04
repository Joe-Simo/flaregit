# FlareGit completion roadmap

Scope: a complete, production Git collaboration platform and GitHub replacement,
not merely a competition prototype. The competition is a delivery milestone.
The owner has deferred the demo until explicitly requested.

This is the single completion tracker. Percentages are not used: a capability is
complete only when its implementation, usable interface, failure recovery, and
required production evidence are verified. Tests and synthetic fixtures do not
substitute for hosted or external-provider evidence.

## Delivery order

| Milestone | Current state | Exit gate |
| --- | --- | --- |
| 1. Ship the current reliability batch | In progress | Fixed-source lint, typecheck, full tests, build, native isolation, commit/push, deployment, and hosted regression checks pass. |
| 2. Complete everyday repository collaboration | Partially implemented | Tags/releases are usable; maintainer permissions, invitations, issues, reviews, history controls, and navigation pass multi-user acceptance. |
| 3. Complete open integration and migration | Partially implemented | Bring-your-own agents/review/CI, delivery recovery, GitHub mirroring, and migration preserve real Git and conversation history with explicit coverage. |
| 4. Prove production safety and responsiveness | Partially verified | Cross-account isolation, interrupted workflows, stale/overlapping work, large-repository interaction, accessibility, and operational recovery pass defined acceptance scenarios. |
| 5. Validate sustainable paid offerings | Incomplete; checkout disabled | Measured provider costs, bounded free/paid allowances, merchant configuration, billing recovery, and approved policies support the published offering. |
| 6. Release and competition entry | Incomplete | Reproducible public source, operational runbooks, full acceptance evidence, eligibility confirmation, and human submission are complete. Demo remains owner-deferred. |

Work on later milestones may run in parallel in disjoint files. Release-critical
failures take priority. Do not add another feature inventory while an active
milestone has an unresolved acceptance failure. Necessary safety fixes are part
of that milestone, not an excuse to replace its scope.

## Current batch: milestone 1

| Item | Evidence/state | Remaining action |
| --- | --- | --- |
| Preserve private Git input/candidate pins before first acceptance | Source checkpoint `dacaf54b38b950240365349bbc48342211f6e2a0`; native Git and durable-ledger tests | Verify the next deployed version with actual hosted pending contribution refs. |
| Protect essential Git compute within existing spending totals | SQLite admission tests; optional work cannot consume the protected floor | Deploy the required configuration and verify hosted admission behavior. This is not a complete invoice ceiling. |
| Share manual/automatic durable mirror execution | Local HTTP/JWT/SQLite/Git proof covers lost ACK, destination drift, owner withdrawal, stable IDs, and SDK disposal failure | Re-run the full integrated gate; hosted GitHub export requires explicit private-export consent. |
| Preserve mirror delivery reporting after optional failure | Three full-suite failures identified; focused correction passes budget, actor-revoked, and lookup scenarios without changing accepted history | Full-suite verification of the corrected snapshot. |
| Durable invitations and explicit human joining | Actual Worker/DO/SQLite HTTP proof; same-user retry, owner-role preservation, legacy ratification, and removed-member denial | Final integrated gate and hosted two-account acceptance. |
| Store known branch credentials before fingerprinting | Raw-first and positive-revocation fault tests | Include in the fixed-source release and native/hosted recovery checks. |
| Tags/releases controller and interface | Native controller and local rendered component evidence | Routes, final DTO alignment, repository navigation, unknown-ACK discovery, and hosted acceptance are not complete. Do not activate incomplete controls. |

Last broad audit: 1,269 passed, one platform-specific skip, three failures. Those
failures were mirror reporting expectations; a subsequent focused run passed
the corrected scenarios. This is **not** a claim that the latest full suite is
green. The next exact-source result replaces this entry after verification.

The deployed source remains `34a1e7a2c67c006243766462deda9578735328df` until a
new deployment is verified. `dacaf54` is a pushed source checkpoint with passing
CI, not a deployed release.

## Full-platform acceptance checklist

### Git and concurrent collaboration

- [ ] Ordinary Git clone/fetch/push, empty/imported repositories, branches and
  tags work with durable attribution and repository isolation.
- [ ] Real humans and multiple real agents work concurrently in separate
  workspaces; purpose, progress, dependencies, decisions, and context survive
  reload and interruption.
- [ ] Overlap, stale bases, conflicts, and contradictory requirements have
  understandable recovery; another contributor's work is never overwritten.
- [ ] Review includes readable diffs, comments and checks; exact human decisions
  control accepted history. Merge queues and supported merge/squash/rebase modes
  retain explicit semantics and original attribution.
- [ ] Accepted commits remain recoverable after interruptions and subsequent
  work; deployment requests identify committed, recoverable repository state.

### Community and everyday use

- [ ] Profiles, contribution history, issues, repository discussions, review
  conversations, notifications, and community navigation work for signed-in
  users without a separate disconnected forum.
- [ ] Invitations, membership removal, maintainer delegation, and owner controls
  pass multi-account scenarios and retry safely after lost acknowledgements.
- [ ] Tags and releases support exact Git identities, draft/published states,
  revision-safe notes, attribution, and explicit recovery.
- [ ] Basic private repositories and bring-your-own tools remain available
  without requiring paid checkout.

### Integrations and migration

- [ ] External agents, AI reviewers and CI providers use documented Git/API/check
  interfaces; provider failure does not block browsing or human review.
- [ ] Signed deliveries expose stable event identities, attempts, retries and
  replay; a real receiver safely handles duplicates.
- [ ] GitHub mirroring survives withdrawal, lost ACK and unavailable GitHub
  without ambiguity or replacement pushes. Core workflow remains independent.
- [ ] Migration reports and verifies heads, tags, reachable Git objects, LFS
  bytes, and conversation coverage. Inline reviews, discussions, reactions and
  attachments are explicitly accounted for. Partial migration cannot claim
  completion or manufacture identities.

### Security, experience, and operations

- [ ] Authentication, authorization, repository isolation, validation and
  credential cleanup pass fresh-session and cross-account negative tests.
- [ ] No secrets enter client bundles, logs or agent context.
- [ ] Light/dark/system appearance, Inter/code typography, responsive layouts,
  keyboard operation and accessible state/error recovery pass rendered review.
- [ ] Large-repository browse/diff/navigation benchmarks report actual tested
  repository sizes, devices, latency and resource limits; no unsupported scale
  claim is published.
- [ ] Workflow-based health distinguishes success, failure, unresolved work and
  unavailable evidence. Incident/recovery procedures have exercised evidence.
- [ ] Abuse and impersonation reports have accountable review, resolution,
  appeal and safe moderation, verified through the actual UI and API.
- [ ] Backup/restore, retention and explicit deletion preserve accepted history
  and hold uncertain storage/credential/native cleanup until reconciled.

### Commercial and release readiness

- [ ] Free/paid offerings are backed by measured infrastructure and external
  service costs, liability controls, abuse limits and a sustainable margin model.
- [ ] Billing, failed payment, cancellation, webhook replay and account recovery
  pass end-to-end tests before checkout is enabled.
- [ ] Terms/privacy and merchant requirements are reviewed and approved; drafts
  are not presented as approved policies.
- [ ] Apache-2.0 source, running instructions and release documentation reproduce
  the accepted commit on a fresh environment.
- [ ] Full hosted acceptance passes; remaining limitations are disclosed.
- [ ] Competition eligibility and required human entry are separately confirmed
  before the user-specified October 14, 2026, 11:59 p.m. Pacific deadline.
- [ ] The owner requests the demo; its real 5–10 minute recording and human
  submission are completed. Do not produce it prematurely.

## Tracking rules

1. Every update names the milestone, concrete finished gate, evidence, and next
   unresolved gate. Avoid percentage guesses or repeated status summaries.
2. Record local, committed, pushed, deployed, hosted and provider-verified states
   separately. A source checkpoint is not production availability.
3. Keep failed cases and missing evidence visible. A green narrow test does not
   close a broader acceptance item.
4. Update this file when a gate changes. Mark checklist items complete only when
   all relevant evidence exists; foundations alone remain incomplete.
5. Finish the current usable workflow before opening another feature lane.
