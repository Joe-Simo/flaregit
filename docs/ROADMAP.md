# FlareGit — single execution tracker

Owner-selected finite release plan, reconciled 4 October 2026 from
`FLAREGIT_FINISH_ROADMAP.md`. This file replaces the prior broad milestone
checklist while preserving its evidence below. No competing tracker is created.

**Product:** Work in parallel. Integration happens automatically.

## No-money plan — October 8, 2026 (supersedes the deferred list below)

The owner's requirement: the app must be buildable and testable without money. Checked against Cloudflare's
pricing pages on October 8, 2026:

- **Free tiers exist for:** Workers (100,000 requests/day, 10 ms CPU per invocation), Durable Objects with SQLite
  (100,000 requests/day, 5 GB stored), R2 (10 GB-month, 1 M Class A and 10 M Class B operations/month), D1 (5 GB).
- **Paid only:** Cloudflare Artifacts (Workers Paid plan, $5/month minimum, then per-operation and per-GB charges;
  billing starts October 14, 2026). Cloudflare Containers (Workers Paid plan, then compute, memory, disk and egress).

Therefore the product should not depend on Artifacts or Containers. Replacements that need no money:

1. **Git storage stays on Artifacts.** The contest rules require Workers and Artifacts, and the owner's Theo
   requirement keeps PRs, CI, profiles and community. Replacing Artifacts with our own Git store was rejected because it
   breaks the contest rules. The cost is the Workers Paid plan ($5/month minimum plus Artifacts usage).
2. **Untrusted execution (replaces Containers):** run customer verification outside the platform on free runners
   (for example GitHub Actions, free for public repositories). The Worker is the trusted publisher: it accepts only
   signed attestations bound to the exact commit, tree, policy and runner identity. This is a product decision; see
   the decisions list below.
3. **Hosted receipts:** produced by the free Worker and Durable Object tiers and by the free runner. No paid
   resource is required for any receipt.

**Work that remains, with no money required:** F01 route-level HTTP tests for the guarded non-project routes; F02
signature verification; F03–F20 (not started). Each will be recorded here as it lands.

## Superseded: earlier no-spend scope — owner decision, October 8, 2026

The owner has ruled out spending money. The active scope is therefore limited to work that costs nothing:
local source, local tests, local Docker images, and reading public documents. Everything that needs paid
Cloudflare resources or a paid decision is moved to the deferred list below. Nothing is deleted; the original
text and evidence remain in this file and in git history.

**Active (no-spend):**
- Source implementation and local tests for C02–C09 and F01–F20 where no paid resource is needed.
- Local gates: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`, and clean-clone reproducibility.
- Documentation of evidence, status, and blockers.

**Removed from the roadmap (owner decision, October 8, 2026):** everything that costs money. That is every hosted receipt and
hosted proof (C02–C09, F01–F20), all Containers and billed Artifacts runs, new Cloudflare resources beyond the free tiers, the
untrusted-execution replacement design, F18 billing, F01 rename/default branch/forks/ownership transfer/deletion (they change
Artifacts state or spend), and travel. Nothing paid is planned, requested or tracked. The original text stays in git history.
The C11 contest entry is a manual owner step and is not engineering work.

**Completion now means:** local source, local tests, lint, typecheck and build for every free item. Free-tier items such as the
R2-backed Git LFS store stay in scope behind a storage interface tested locally.

**Committed locally on `main`, not pushed (October 8):**
- F01: archive/unarchive, visibility, and topics (`109c2ab`, `e9adc73`, `8720856`), with HTTP and unit tests.
- F02: Git LFS batch validation and content-derived hash checks (`0e45935`), with 5 tests.
- Tracker updates: `75b0087`, `9e3b70c`, and the commits before them.

**Still open without spend (local engineering):**
- F01: non-project route guards for archived repositories (wired; route-level HTTP tests still open).
- F02: commit signature verification status.
- F03–F20: not started. Each still needs local source work and tests, and any paid step moves to the deferred list.

**Status:** Not complete. Remaining scope is free local engineering only.

## Current handoff — October 7, 2026

- The owner authorization/device blocker is resolved. The bounded native run
  produced candidate `cand_76bccf87-e3c1-4f4f-ac09-e042eae8f215`, commit
  `b32da71ef32aa60688e79875c2e5a7562382c266`, from original request
  `b96691ae-cf8b-45ab-b825-9377964733d1`. Native Git integrity passed.
  These are manual contributions, not coding-agent execution evidence.
- Current private Worker is `10b36839-c2a3-4a5e-80c9-44817b898846`, core
  `cf59d76fee82c2647ce056b9c3e6a71edef477e2`, module
  `4ee18d4f093dc2d38984d7f78448493392d10a8efe23cc749bf10cfedfae5a27`.
  Exact core/UI retarget preserves namespaces, image, reservations and disabled
  general/model execution. Queue consumers remain zero.
- Owner approval was recorded through normal review UI. Journal
  `jrnl_a737aa27-1708-4bee-9708-e275155b1017` is now ACCEPTED; accepted history
  contains exact commit `b32da71ef32aa60688e79875c2e5a7562382c266`, tree
  `14336b94e9b082941f7f1c78fc197cc45ed87e7e`, and survives normal reload.
  Publisher `pub-jrnl_a737aa27-1708-4bee-9708-e275155b1017` completed all three
  steps successfully. Native publication ran 09:07:31–09:07:44 UTC and its
  instance is inactive. The initial requested acknowledgement was not mislabeled
  as acceptance. Evidence: `FlareGit-Evidence/c03-fd8ad51-retarget/`.
- Fresh post-publication Git clone passed through the actual hosted Git gateway
  at Worker `da82bb24-a7a8-4d8d-a167-a4e336fbce8e`. HEAD and tree exactly match
  approvedb32/tree143. Both manual input commits and former accepted6f514c9
  remain ancestors; README blob is unchanged; `git fsck --full` passes.
  Exact-release headers and normal owner-created30-minute read-only credential
  were used, masked throughout and privately downloaded. The local ASKPASS
  validator initially used the wrong token shape; fixed to the existing account
  token schema before the successful clone. No credential was printed.
- A later normal owner Changes UI read of `/contribution-targets` returned200,
  currentmain acceptedb32, acceptedVersion1 and policyVersion1, truncatedfalse.
  This is now an observed controller projection, replacing the earlier unknown
  version qualification; it is not reconstructed from history length. Receipt:
  `FlareGit-Evidence/c03-c9df-read-control/actual-accepted-contribution-targets.json`.
  Every new trial must still obtain its own fresh accepted target/version.
- Temporary Git-read authority was withdrawn through one same-module upload,
  changing only `C03_ACCEPTED_GIT_READ_SCOPE_JSON` to empty. An unpinned follow-up
  Git read returns403. Both downloaded secret copies were removed; credential
  metadata retains its original30-minute expiry rather than a claimed token
  revocation. PUB is explicitly revoked. READ scope dates/counters and all caps
  remain unchanged. No extra native execution started. Evidence:
  `FlareGit-Evidence/c03-c9df-read-control/fresh-clone-receipt.json` and
  `withdrawal-receipt.json`. Full hosted race/recovery matrix remains open.
- Accepted-history runtime inspection is now visible and read-only. The actual
  saved ledger reports38 completed commands, zero pending acknowledgements,
  two recorded stops and three credential-revocation receipts. It candidly says
  verification is closed while the original workflow is not complete; separate
  successful publisher completion is not used to rewrite that ledger.
- Latest coherent private UI source includes masked credentials and accepted
  runtime visibility. Lint/typecheck/build and23 focused tests/149 assertions
  pass. Source1115 Git blobs and36 asset hashes were verified. No public release
  or main push occurred. Local storage was rechecked at approximately9.6 GiB free.
- Earlier attribution checkpoint is `d463a41887ea3cb913241ca701f7a17385b395e7`.
  Creator-attested external-tool provenance preserves existing owner/member
  permissions. Immutable candidate/journal/accepted-history attribution preserves
  exact commit, original purpose and people independently of later task changes.
  Legacy attribution is explicitly unavailable. Combined attribution checks:
  12 tests/47 assertions, lint, typecheck, build; rendered fixture confirms journal
  precedence, no stale People history across repos, and 390px layout. Fixture data
  is synthetic and is not hosted attribution proof. Earlier source-only external
  provenance and runtime wording checkpoints remain archived.
- Earlier preparation at `8dd8953` and Worker `945c836d` is superseded by the
  actual publication above. Its evidence remains archived. Full-suite baseline
  `de0f600` had447 files/1794 passes/zero failures and six existing skips; latest
  focused source checks are recorded with their checkpoints. Main/index remain
  unchanged. C02/C03/C05 and later release gates remain open.

### C06/C07 honest browser recovery — October 7

Source checkpoint `ed290fb0dba838c2166f57a360d7297cdb0c34b9` (parentc9df4bd)
confirms exact retained browser recovery before issue, tag or release dispatch.
A successful storage call with a dropped/altered record no longer reports saved
state; failed removal no longer reports discarded recovery. Existing content,
request identity and repository/account isolation remain preserved. Issue checks:
9 tests/34 assertions. Release recovery/native Git/signed HTTP checks:5 tests/19
parent assertions. Lint/typecheck/build pass. These are local checks, not hosted
C06/C07 completion; no public release/main push/provider mutation occurred.

### C05/C06 static assets and comment retention — October 7

Source checkpoint `973b89087b0243e930f69d7d5d1eea76cea7b23d` (parented290fb0)
accepts AVIF images and OpenType fonts in verified static output, matching the
existing preview-storage MIME support. Actual Bun HTML build/reference/byte/hash
preservation passes with owned synthetic binary fixtures; this is not image/font
rendering or hosted-preview proof. Focused artifact/build tests:17 passes/79
assertions; preceding journey/native-local checks:19 passes/69 assertions.
Comments also require exact retained browser recovery before dispatch; silent
write loss sends no request and lost acknowledgement retains the original UUID.
Four tests/21 assertions pass. Root reran the new asset/comment tests together:
5 passes/29 assertions. Lint/typecheck/build pass. No provider mutation/public
release occurred. The coherent source chain is retained under a local checkpoint
ref; main/index are unchanged. C05/C06 remain open for real hosted journeys.

### C03 actual ref checkpoints and C05 pre-admission — October 7

Source `6d3c02eb30a49e41f17436ba06bf8d59519a2885` moves existing initialization
compute admission before empty/README provider creation. Denied funding now
allocates no provider repository. SDK failure retains one held reservation and
no VM; the original dispatch fence prevents a duplicate creation. Eleven local
tests/106 assertions and lint/typecheck/build pass.

Source `6f3942a90dcc1ef6ceb3f84d2998bfc2d3376b09` adds default-OFF private
checkpoints immediately around actual force-with-lease dispatch, preserving its
final production authorizer. Before-hold leaves the ref unchanged; after-hold
preserves committed Git and PREPARED journal for read-only reconciliation. Active
malformed grants hold; disabled mode makes no callback even with a leftover
service binding. Twenty-five focused tests/125 assertions and statics pass.

Source `f41c148ca45b3c8784c44f51f919b4b700de5a07` includes the private service
and actual workerd test in repository fixtures/tests so they are reproducible.
The public HTTP handler returns404; service registration pins the actual deployed
Worker UUID, actor/project/case and original resume ID. Root combined checks:
17 tests/129 assertions, plus added actor/project/duplicate negatives in the
service child test; lint/typecheck/build pass. These are local proofs. No new
provider deployment, native allocation, grant clock or model call occurred.

The remaining race needs bounded concurrent grants: current single phase config
cannot admit two publishers through the same repository controller. That selector
is being implemented before a hosted trial; serial pause/retry is not labeled a
real race. C05 ordinary staging is prepared with bounded essential creation and
committed-target human SDK workspaces, but remains unactivated pending final
scope/image/headroom checks. Unborn workspace native verification remains separate.

### C03 two-case source and C05 OFF rollout — October 7

Source `08ae00f74559eedd56be54ae61a0b73b712fb4b2` adds a default-OFF, max-two
private phase/checkpoint selector. Controller-derived identities select distinct
immutable grants without resetting allocation consumption or deadlines. The scalar
contract is preserved. Twenty-two focused tests/71 assertions, statics and peer
review pass. The race driver now invokes both actual publishers concurrently;
serial pause/retry is not used as race proof. Hosted trials remain pending.

The C05 ordinary owner wrapper/core/UI is now deployed privately in OFF mode,
with36 assets, unchanged budgets/counters/credentials/namespaces/image and zero
queue consumers. An initial upload401 was reconciled independently as unchanged
before refreshing credentials and uploading once successfully. Evidence:
`FlareGit-Evidence/c05-off-deployment/off-deployment-receipt.json`.

Actual browser testing exposed a mismatched login mount element and missing
read-only-entry flag; creation testing has not begun. A wrapper repair is in
progress. Read-token access to the creator's safe status projection also incorrectly
required write authority; a narrow getter-only repair is being tested. No creation
grant, activation clock or new native execution was generated.

Fresh10:22 provider readback confirms trusted image d32, one-instance limit, and
allthree instances inactive. Whole-account usage is sampled/delayed, with billing
plan last observed Paid. Subscription API returned403; no fresh invoice/plan or
zero-charge guarantee is claimed. Planned one1200-second standard-2 invocation
is bounded by1200 CPU seconds/7200 GiB-seconds/14400 GB-seconds. No new subscription
or payment action occurred. `FlareGit-Evidence/c05-hosted-preflight/` retains
qualified evidence.

### C05 branch browsing: hosted verified — October 7

Actual0d6 instrumented attempt on p874 failed at funding before credential issuance,
with Git-write capacity exhausted but15,600 read quota remaining. The category bug
was repaired in cf59: HTTP inventory and its credential cleanup now use existing
repository-read admission; native branch writes retain their write/native pools.
Actual workerd tests preserve fully exhausted write quota while read succeeds, then
reject exhausted read before token mint. Six tests/26parent assertions, native write
regression suites, lint/type/build passed. No cap/reset/refund change.

Exact cf59 module4ee18d4 deployed15:01:44 UTC on Worker10b36839, assets36 unchanged,
grantsOFF, budgets/counters/source scope preserved. Actual normal owner branch GET
returned200 and shows unborn main correctly. Signed inspection200 confirms complete,
credential revoked, nativeState not_allocated. Write reserved stays92,400 before and
after; READ reserved58,800→64,800, exactly6,000. Native compute was not allocated.
Receipt: c05-cf59-read-budget/successful-inspection.json; screenshotbranches-confirmed.
A second real committed repository view shows acceptedb32 with confirmed main and
alpha.txt/beta.txt/README preserved under the same disabled execution state. Full
C05 two-account clone/push/workspace/preview acceptance remains open.

Checkpoint0d6 also includes bounded immutable asset retention and pinned cold-release
import/export. Five actual Bun tests/39 assertions and static/build gates passed.
Only verified immutable build outputs enter retention; current HTML/unhashed workers/
JSON/maps remain excluded. Private builder successfully imported verified3ab prior
assets; current assets were identical, so a changed-chunk rollout remains to prove.
No untrusted Actions cache is treated as production asset provenance.

### VM-free branch read repair — October 7

Local checkpoint `3ab992b5e2d24fdc6e0fd6f8657c7abbfdd475f5` follows f8f. Fresh
branch inventory now reads bounded Git smart-HTTP advertisements without requesting
native compute, while retaining provider identity/owner/context checks before and
after read-token revocation. HTTP inspection receipts and recovery explicitly record
not_allocated; unknown token issuance/cleanup remains visible. Branch create/CAS and
native write recovery stay separate. Real Git HTTP empty/committed fixtures and
actual workerd permission/provider-swap races passed, with existing native write
assertions retained:15 focused tests/86 parent assertions, lint/type/build and peer
review GO. The health banner also gains readable light-mode contrast.

Exact private3ab UI/module preparation passed with six source blob matches and
36 assets; module6a199822 and six focused wrapper tests/36 assertions. It is prepared,
not deployed or hosted-verified yet. Current deployed f8f/4c757d12 still returns409
for branch inventory until this repair ships. No native grant, counter reset or
budget change was introduced by the read repair. Main/index remain unchanged.

### C05 ordinary empty initialization: hosted verified slice — October 7

Exact normal owner request `73fb0279-2792-47d5-8451-0fe6d2730f0d`, empty/private
`c05-owned-empty-oct07`, first returned409 while execution OFF without SDK dispatch.
After reviewed forward-only policy preparation, the exact same UUID/body ran once
under f8f, trusted d32/max1,100sec admission/120sec stop authority,16commands and
one allocation. Actual POST returned201 and repository `p87411aa0d917` persisted.
Saved request shows Empty repository/no initial commit/Repository ready; after client
reload and grant withdrawal, the real repo still shows private/no accepted commit.
This is native Git initialization, not runtime-agent or application-CI evidence.

The trial grant was withdrawn. Initial post-write binding read was stale; a later
GET reconciled exact intended bindings and Worker703e6c0d at100%, with no repeated
write. Both pc807 accepted history and p874 are retained in static read scope. All
five actual provider instances are inactive. Original5dc/38ef request and its43,008
liability remain intact. Forward policy215040 aggregate=essential/slots4/read78000
was preserved; no counters reset or optional model headroom. Evidence:
c05-f8f-ui/creation-activation-receipt.json;
c05-empty-withdraw/withdrawal-reconciled-receipt.json and repository screenshot.

Actual older client dynamic chunk navigation failed after201; explicit reload
recovered the saved repo. This exposed a rolling-asset retention/recovery gap, not
Git data loss. The new f8f UI separately corrects empty busy text and reports missing,
stale or forbidden health observation as unknown rather than eight service outages.
UI3tests/9assertions+lint/type/build passed; private new-client rendering confirms
health unknown. Full C05 clone/push/workspace/invitation/preview journey remains open.

Registered branch GET allowlist repair deployed on current Worker4c757d12, sourcef8f,
modulefe9106aa, assets36/grantsOFF. Exact branch-operation/recovery GETs now200;
/branches is409 because production branchInventory always allocates native compute,
even for empty repos. A fresh bounded VM-free Git advertisement read is assigned;
no historical proof will be represented as current provider verification.

### Future allocation receipts: compatible and deployed — October 7

Checkpoint3e8 retains the old five-column fence contract, separate per-attempt
bindings/immutable receipts, and invalidates attribution for legacy reserved writes.
SameUUID retries have distinct attempts; stale settlement cannot close replacement.
15tests/87parent assertions plus actual workerd trigger checks, lint/type/build and
peer review passed. Private deployment and signed diagnostic200 preserve original
settled rows as legacy_unknown, with original current provider absence. No backfill,
rearm, or refund. Frozen source f8f also preserves this backend slice.

### C05 current provider presence and next trial — October 7

Private c2be module deployed13:11:44 UTC on Worker17058d10; exact module1b5224,
36 unchanged assets, grants OFF, budgets/counters/image/namespaces preserved. Normal
signed owner diagnostic200 now reports original canonical repository currently
absent through stable two-pass SDK inventory. Exact original settled fence IDs and
create_possible remain unchanged. SDK errors report unknown; no credentials/remotes
or other repository names exposed. Presence tests5/22, module/type gates passed.
Receipt: c05-c2be-presence/actual-signed-presence.json. Current absence is not generic
historical dispatch provenance and does not authorize retry/refund/deletion.

A one-case empty-repository trial draft is prepared only: no request UUID, actor
source override, deadline, grant or provider activation. Forward-only proposed
caps215040 aggregate=essential (zero optional headroom), slots4, read78000 and
unchanged write166800. Original43,008 liability and acceptedb32 remain preserved.
Fresh rolling32-day account telemetry fits one bounded20min case arithmetically;
metrics remain sampled/delayed and not invoice proof. Current browser Google account
could not access intended9888 plan page; no account switch or plan change occurred.
Artifacts pricing checked live: billing beginsOct14, then10,000 operations and1GB/mo
included. Conservative retained3x1GB envelope can exceed that included storage by
up to$1/mo; four by$1.50/mo. No future-free guarantee is made. Evidence:
fresh-included-headroom-oct07/rolling32/rolling32-comparison.json; official
https://developers.cloudflare.com/artifacts/platform/pricing/ .

Future allocation-outcome receipts are in revision, not deployed: root review caught
that ALTERing the existing5-column fence table breaks old rolling-version INSERTs,
and intent-level first-wins receipts cannot distinguish same-UUID retry attempts.
A compatible per-attempt design is required before freezing this slice. No legacy
backfill, rearm, refund or destructive cleanup is authorized by that repair.

### C08/C09 exact evidence fixes — October 7

Local checkpoint `c2be3c1ec459a4bdf45448488ba278e41804ef5d` follows e036 with
four focused paths. Native migration inventory now reports gitlinks in historical
commit trees even when removed from current HEAD; external repository objects stay
explicitly excluded. Before repair the native test failed; afterward7 tests/36
assertions passed. The CLI acceptance runner now requires the exact saved integration,
distinct contribution set, reviewed accepted commit, and passed evidence for that
commit; it repeats identity after cloning and persists the tuple. Its20 focused
tests/75 assertions passed. Root combined24 tests/104 assertions and build passed;
agent lint/typecheck gates passed; independent source review GO. Existing release
pin tests are byte-identical to e036 and retained in the checkpoint. Main/index
unchanged. C08/C09 hosted release acceptance remains open; this checkpoint is local.

### C05 signed and responsive verification — October 7

Browser runtime recovered without a filesystem workaround. Actual owner sign-in
verified e036/Worker10fd, and normal Inspect operation capacity returned200 with
correct quota UI (no false unconfirmed state). Original38ef allocationId is retained;
account/project allocation rows are settled with that exact ID, global named row is
absent, and storage active/daily counts are3 against caps3. Native funding remains
reserved43,008/1200 seconds; lifetime stopped, native access reservations0. This is
not a refund or generic retry authorization: original intent lacks persisted dispatch
source/ledger-incarnation provenance. Original create_possible remains preserved.
Receipt: c05-e036-capacity/actual-signed-diagnostic.json.

Normal NewRepo displays the real3/3 daily allowance and saved original request at
both desktop and390px. Capacity refresh returned200; response-body observer failed
for that tab, so no body receipt is claimed. With a valid local-only name, Create
remained disabled and saved-request refresh enabled. No creation POST was sent;
field was cleared and temporary viewport reset. Mobile document width384 <=390.
Screenshots: preflight-desktop.png, preflight-mobile.jpg, and
preflight-mobile-recovery.jpg in c05-e036-capacity. This verifies the capacity slice,
not the full two-account C05 Git/preview journey. Browser restart request withdrawn.

### C05 capacity preflight: source verified — October 7

Checkpoint `e036831e369cfad6f3af48f4e204a66c561209a1` follows ec1f and includes
nine focused paths. Signed-human `/account/storage-capacity` and NewRepo preflight
use actual recorded daily named-repository accounting and configured caps; unknown
namespace/inventory returns unknown usage rather than a false full state. Recorded
and checked timestamps remain distinct from provider verification. Read-sequence
and submit guards prevent stale responses or known-full fresh submissions; saved
request recovery and original canRetryOriginal protection are preserved.

Nine focused tests/38 assertions passed, including actual RS256/workerd HTTP
anonymous401, token403, expired401, owner3/3 versus second account0 and no repository
names. Lint/typecheck/build exited0; independent source review GO. Main/index remain
unchanged. Exact private OFF wrapper/UI deployed at12:28:52 UTC on Worker
`10fd0c65-42d2-4baf-9096-3c8c722aa4b9`, modulee05a. Provider readback verified
source/36 assets, all grants OFF, unchanged budgets/counters/image/namespaces and
accepted pc807 scope. Six wrapper tests/45 assertions plus module/frontend/type
gates passed. Actual HTTP200 readback of changed index.html and JS bundle matched
the reviewed byte counts and SHA256 hashes. Receipt: c05-e036-capacity/
budget-diagnostic-deployment-receipt.json. This proves deployed bytes, not rendered
or signed-in hosted acceptance. No SDK/native retry or capacity change occurred.

### C06/C07 current local acceptance and browser runtime — October 7

At checkpoint ec1f, four actual workerd fixtures passed for private anchored comment
recovery, exact review authority, delegated review invalidation, and public profile
privacy. C07 local acceptance passed21 tests/96 assertions for native Git, signed
HTTP, release identity/revisions/permissions and lost-response recovery. No source
defect was reproduced; these local checks do not close hosted multi-user or tag
journeys. C06 remains IMPLEMENTED and C07 LOCAL_VERIFIED.

Browser availability was tested through the supported Node REPL browser runtime;
setup failed because its configured26.1002.51308/browser-service.mjs is missing.
The installed client is26.1002.52244. No copied cookies, direct page API injection,
symlink workaround, or original creation retry was used. Signed-in ec1f diagnostic
readback remains pending. C05 capacity preflight implementation is delegated to
prevent avoidable submission failures with actual owner-scoped storage inventory.

### C05 exact allocation inspection — October 7

Checkpoint `ec1f28564d45b8ce1baf396da5043ad7d7a7bd96` follows0bb and preserves
four focused diagnostic files. Named allocation inspection now distinguishes an
absent row from reserved, allocating and settled rows; creator diagnostics include
the actual original allocationId. Five focused tests/16 assertions, lint, typecheck
and build passed. Prepared wrapper restores the real coreGitCapacity response
contract and checks exact allocation identity before exposing diagnostic phase.
The exact core/wrapper deployed privately at12:10:09 UTC on Worker
`2fc9dd60-ec83-464c-86cc-6a5aa860afec`, module4d71. Provider readback confirms
36 assets retained, all grants OFF, budgets/counters/namespaces/image unchanged,
accepted pc807 scope retained, queue consumers zero. Six wrapper tests/45 assertions
and module/type gates passed. Receipt: c05-ec1f-diagnostic/budget-diagnostic-deployment-receipt.json.
Browser control is unavailable in this turn; the new signed-in diagnostic response
has not been observed and no original SDK/native request has been retried. Main/index
remain unchanged. Current local storage has26 GiB free; old Docker builder prune
reclaimed0 bytes, so no cleanup benefit is claimed.

### C05 initialization admission ordering — October 7

Local checkpoint `0bb532b7b6a958fe1c78bdd03ec52ef9fac3053f` follows fdcd and
contains five focused files. Both empty and README initialization now admit storage,
then fund native work and record creation intent in an allocator before-dispatch
hook, then invoke SDK creation. Storage refusal consumes no native envelope. Known
pre-dispatch funding failures settle allocation holds; lost creation-intent replies
preserve the initialization journal, and unknown SDK outcomes retain allocation
holds. This changes future attempts; it does not recover original event38ef or refund
its reservation. Lint/typecheck passed;42 focused tests/308 assertions passed;
independent source review GO. Main/index and deployed source remain unchanged.

### C05 original hosted creation: unresolved, preserved — October 7

Normal owner sign-in was repaired and browser-verified. On source6aef, the normal
creation UI saved request `5dc65a31-e18d-404a-b1a4-9a78d04beab5` for private
`c05-owned-first-project`; OFF returned409 before execution. One bounded grant
was then installed for that exact body, maxone VM/1200 seconds/16 accesses, with
aggregate and essential caps both172032 (optional headroom zero). The normal UI
retried its original UUID once. No new creation identity or repeated SDK create
was sent after the unresolved response.

The response was409; the saved ledger remains `create_possible`, metadata/token
issuance unresolved, no recorded commit/publication. Creator-only diagnostic200
now gives event `38ef6998-ebb7-4caf-adbc-f9387bcb7cae`, project `p98eaeb186ba1`,
canonical `flaregit-p98eaeb186ba1`, metadataRecordedfalse/commitRecordedfalse/
publishedfalse. Native SQL records zero access reservations and stopped/unsealed
lifetime. Provider independently links instance7032… to that exact readme event,
trusted image d32, inactive11:04:36 UTC. A cause has not been established; zero
recorded accesses does not prove no provisioning.

Creation authority was withdrawn at Worker `daf889fd` by changing only its grant
to null, retaining all records/caps. Read-only diagnostics sourcefdcd and wrapper
were then deployed with execution disabled; no new SDK call or native start is
performed by the diagnostic. Safe getter source passes actual workerd and static
checks; no credentials/seal blobs are exposed. Evidence:
`FlareGit-Evidence/c05-fdcd-diagnostic/actual-original-creation-diagnostic.json`,
`c05-6aef-retarget/same-creation-instance-readback.json`, and withdrawal receipt.

Operational diagnostic200 on Worker cbf910 confirms verified recorded inventory:
three active global/account slots against caps of three, no active named reservation
for the original canonical name, null pending account/project holds, and native
funding still reserved at43008 microUSD/1200 seconds. This getter refreshes existing
daily measurement bookkeeping; it does not dispatch SDK/native work or change caps.
Null pending holds do not distinguish absent from settled allocation rows and do
not prove SDK dispatch never happened. Exact raw allocation fence state and retained
history are needed before recovery. Source review found create_possible is recorded
before storage admission; a focused ordering repair is underway. The capacity page
also incorrectly reports unconfirmed quota despite this diagnostic200; its response
projection is being repaired. Original request, event, deadline and accepted b32
history remain intact. Evidence: c05-fdcd-diagnostic/actual-budget-diagnostic.json.
C05 remains open. Local storage is9.7 GiB free.

### C03 remaining hosted matrix — October 7

Local focused matrix passes26 tests/139 assertions across8 files, using local
Git/workerd and synthetic ports. Remaining hosted trials are: competing verified
candidates sharing acceptedb32 base (one winner, explicit stale loser); separate
task-supersession and policy-change refusals before CAS; and interruption after
actual ref update with lost acknowledgement, duplicate callback and same-journal
recovery. Undispatched cancellation must allocate no VM. These require new
additive candidates; acceptedb32 must never be reset or substituted as race proof.
Fresh scoped preflight is required before native allocation. No new trial ran.

### C03 saved approval and publication-control repair — October 7 (pre-publication history)

The owner's exact `b32da71` decision is persisted as a real human review and
PREPARED journal `jrnl_a737aa27-1708-4bee-9708-e275155b1017`; main remains
`6f514c9` at the prepared version-zero target. Same-module READ renewal used
preserved exports/bindings/assets after two rejected settings PATCH attempts;
both failures were reconciled as unchanged and retained. Exact PUB grant install
then passed at `945c836d`, without native allocation or quota resets.

The live owner journey exposed a parent UI defect: an approved verified candidate
with a PREPARED journal disappeared from actionable reviews. Source checkpoint
`fd8ad515a8b96081ad6f93e597a5e2e4ae355db2` fixes both parents, retaining the
initial complete-diff approval gate while exposing exact saved publication during
diff failures. Five focused tests/27 assertions and lint/typecheck/build pass.
Private coherent core/UI retarget is being prepared; no publisher was bypassed
through browser scripting. READ capacity is exhausted at 54,000. Four scoped
post-publication reads require cap58,800 and aggregate166,800, preserving the
108,000 write pool and all prior reservations. Native quota/deadlines/model flags
stay unchanged. This is internal admission quota, not an invoice claim.

### C05 generic static preview support — October 7

Coherent source checkpoint `261b69cc17bf304a491560162dd743fce03cd9ca`
(parent `15ebfeff`) removes ticket-fixture-only preview eligibility. Supported
verified Git sources with root `index.html` use the existing offline isolated
builder. README-only/server sources fail before untrusted dispatch and report
`not_supported`, with no retry/rebuild or automatic polling. Nineteen focused
real-Git/signed HTTP tests pass, including owner/member/current-commit/expiry,
plus lint/typecheck/build. Styled actual-component local rendering verifies
light desktop, dark390px, keyboard refresh, no horizontal overflow and no auto
polling; it is explicitly synthetic. Source/control evidence:
`FlareGit-Evidence/source-c05-generic-preview/`.

Normal authenticated production UI reads separately confirm prior owned test repo
`pb0004cda6e6b` still holds accepted `868aba34103e1f7a425807835c93906f427b3c37`,
tree `fd3f9df4135b5669696dc68d5eba51f06d5e115b`, canonical name
`flaregit-pb0004cda6e6b`, owner `user_3KCsuqYcyBkkilJLIi7rRz0xKUc`, and root
`index.html`. No preview/onboarding job was triggered. An isolated read-only
accepted-source control is being prepared; it will not substitute for ordinary
repository/fresh-user hosted acceptance. Legacy incarnation/provider ID are not
invented from UI metadata.

### C05 preview interruption recovery — October 7

Source-only checkpoint `33d4c52cc24a031eac8dab4f16fa295b186b8ad6`
(parent `8dd8953`) contains the three recovery paths.
Replacement-preview requests now save their exact idempotency UUID before
sending and recover it across reloads, scoped to the signed-in actor and source.
A storage failure refuses dispatch. Duplicate clicks are locked; late responses
from a different actor are ignored without leaving recovery permanently busy.
Four focused tests/32 assertions, lint, typecheck and build pass. Root rendered
the actual component in an explicitly synthetic local fixture: the first two
POST bodies retained the same UUID after reload; delayed actor-switch responses
did not show a ready state and the controls became usable. This is local source
verification, not hosted preview acceptance. The C05 ticket remains open.

### C08 webhook account isolation — October 7

Source-only checkpoint `c8bf29c4e689c6af56727ad1c2d3bce7deec7424`
(parent `33d4c52`) fixes webhook state across actor changes. Identity/project/role
keyed remounts clear old hooks, deliveries, secrets and saved replay state; async
mutation setters also validate the original actor before displaying results.
Five focused tests/13 assertions, lint, typecheck and build pass. Root rendered
the real component in an explicitly synthetic fixture: a delayed creation reply
did not reveal a secret or success notice after identity changed, and the next
actor render cleared prior form/hook state. Evidence:
`FlareGit-Evidence/source-c8bf29c-webhook-session/receipt.json`.
This does not replace hosted signed-delivery/replay acceptance. C08 stays open.

### C02 current-source hosted security checks — October 7

All ten fixed hosted security-fixture cases completed once on source `8dd8953`
and immutable untrusted image `16f1e6`. Boundary UUID
`89d5c76b-4097-46ac-887d-67f936a230d6` proved cross-task, supervisor,
credential-operation, credential-disclosure and fabricated-inventory refusal.
DOM UUID `d6b5b5b4-7664-4abe-9350-015952982b32` observed `Blocked`, the
expected trusted verifier failure, native cleanup and exact browser-history
closure for session `0a16a934-073c-48cc-8dca-021388b8b195`. These six cases
executed at Worker version `0822a587-7766-4a20-a640-c92b658d2dea`.

Network UUID `ce4542f5-468a-470a-b1c1-9bf9702dee28` executed at
`9040ff17-975d-40e6-9d26-e026cfc07168`, producing four positive receiver
controls and four matching native-interceptor refusals, with settled commands
and native cleanup. Coverage is HTTP/HTTPS clients and HTTP/1.1-framed raw
TCP/TLS, not arbitrary binary traffic. The exact-request receiver adapter added
namespace `dde232d0b1f64eb9960cc1abe41de815` and a separate C02 credential;
both legacy namespaces and all four legacy credentials remained unchanged.
Registration is disabled at receiver version
`6e8454b8-e7b9-48be-be1e-db66a8822108`, adapter module `1651a028`.

Source-only checkpoint `15ebfeffccf4930add2168e86eb87367ec7248aa`
(parent `c8bf29c`) repairs read-only status: it exposes a cloned original network
plan from durable storage. Lint, typecheck, build and the affected local workerd
test pass. An exact frozen observer archive verified all 1,112 blobs. Its
private disabled deployment is `95631a7c-52e1-477c-a2e0-21640a354c98`, module
`49b2fbfc`; execution/replay code and image build inputs are unchanged.
Independent validation used the actual saved original plan and reproduced all
four denial results; every historical execution field remained identical.
The earlier reconstructed-plan consistency receipt is retained with its limits.

Final provider readback confirms all three execution flags false, the same six
namespaces, unchanged applications/image/caps, four original inactive logical
records and zero active instances. All three completed batches remained readable
after authority withdrawal; start requests were refused and the temporary bridge
was stopped. Existing C03 state and old terminal namespaces were unchanged.
Evidence: `FlareGit-Evidence/c02-fresh-scope-8dd-preparation/`, including
`boundary-independent-validation.json`, `dom-independent-validation.json`,
`network-full-original-plan-validation.json`, `observer15eb-provider-readback.json`
and `receiver-registration-off-summary.json`. These hosted security fixtures do
not establish production Git, coding-agent concurrency or full release acceptance.
C02 remains IMPLEMENTED pending release reconciliation; C03 publication and C05
hosted preview gates remain open. Latest local storage check: 14 GiB free.

### C02 current reconciliation — October 7

Prior boundary/network/browser receipts retain their own recorded versions.
Current core trusted verifier image d32 is distinct from the untrusted canary
image e517; they must not be substituted. Dockerfile.untrusted and dockerignore
match the prior immutable build inputs, but current package/lock files add five
Radix production dependencies. The exact current local rebuild is recorded
below; the hosted fixture results above retain their exact execution versions.

Nine local boundary/network/lifetime checks passed without a VM or provider call.
A fresh disabled Worker/DO/container namespace configuration and three immutable
batch UUIDs preserve consumed singleton receipts. Expected canary inventory is
five boundary, four network, and one DOM outcome; C09's separate twelve-case
matrix is unchanged. Evidence: `FlareGit-Evidence/c02-fresh-scope-8dd-preparation/`.
After the owner unlocked the Mac, Docker daemon29.6.1 was verified without a
restart/reset. One exact frozen-source local build succeeded as image
`sha256:b78760c4444825f6d85b65d1416248b56532f2a12134739ab1ed0fbb50429568`.
All1,112 Git blobs matched the checkpoint; Worker bundle/lint/typecheck and nine
focused tests passed. Network-disabled, read-only/cap-drop Docker inspection
confirmed no platform source, trusted checks or credential-named environment.
Actual offline React bundling produced its sentinel while ignoring a forged
package build script. The fixture receipts explicitly deny hosted/acceptance proof.
The arm64 image is local-host verification only. Official Cloudflare container
requirements call for linux/amd64. One separately tagged amd64 build from the
same frozen inputs succeeded as
`sha256:16f1e6c98d042e1f7272830047d4ffb36be51f01ac6ef1d82dab1bf6e612ead7`.
Its actual x64/Bun1.3.4 network-disabled hygiene and offline React build both
passed. Separate IID/inspect/build/layer/hygiene receipts preserve the arm64 proof;
no image alias or historical canary resource was overwritten. Storage remains
approximately 14 GiB free on the latest check.
The existing amd64 image was pushed once to the private account9888 registry.
Actual push and Docker RepoDigest readback returned immutable digest
`16f1e6c98d042e1f7272830047d4ffb36be51f01ac6ef1d82dab1bf6e612ead7`.
The initial fresh Worker deployed disabled at version
`2313fc87-e867-4a2e-9232-81384626dc3f`. Read-only provider readback
verified 100% traffic, all exact vars, six fresh unique namespaces, three
applications capped 1/1/2 and zero reported logical instances before execution.
No public application route was added. Subsequent fixed runs are recorded above.
Fresh billing showed all
variable usage within included tiers; the 104,598,007-byte image fits substantial
observed R2 headroom. Registry billing mapping is not explicitly documented, so
this bounded preflight does not assert a guaranteed zero invoice.
No registry push occurred; the new dedicated canary config remains disabled and
still identifies retained e517 until a separately verified immutable cloud image
is available. Three fixed batch UUIDs and historical namespace receipts remain
unchanged. No budget, grant, cloud allocation or public release was activated.

### Earlier preparation evidence (historical)

- Inactive C03 adapter is deployed privately as Worker
  `5c2efe80-622c-4a46-b0ea-684fdd5ad2cf`, core `de0f600`, module
  `99c5321c28f72dc512e58784b483172b8c825fdfe55113f4b34e188afc85dbea`.
  Fresh provider readback verifies zero binding changes, retained assets, unchanged
  container configuration and zero queue consumers. Browser owner sign-in and exact
  source/Worker display pass; repository operations/execution remain visibly disabled.
  The first invocation mistyped a metadata hash and stopped locally before any
  provider request; the corrected reviewed invocation performed one upload.
  New bounded activation approval for request `b96691ae` is pending; the old
  `952181f`/40-group request does not transfer. A fresh signed-in billing UI read
  reports Oct 4–Nov 3 cycle usage through Oct 6 within included tiers; the proposed
  maximum VM fits displayed memory/CPU/disk allowances. Values are rounded/delayed,
  exclude existing base subscription fees, and do not guarantee future invoices.
  Artifacts billing starts Oct 14 per official changelog; the trial hard stop remains
  Oct 13 at 23:50 UTC. No caps, grants, consumer, VM or acceptance were activated.
  Evidence: `FlareGit-Evidence/inactive-candidate-adapter/`.

- C03 inactive phase adapter now passes twenty local tests/seventy assertions,
  typecheck, lint and build. A separate actual RS256/JWKS check passes one test/
  eighteen assertions, including private owner access and rejection of primary
  origin, forged/expired tokens, outsiders and revoked owner authority. These are
  local fixtures, not a native run or hosted phase proof. Blob reads now require
  membership in the exact recorded commit trees before content is forwarded;
  unscoped file/history SDK routes remain outside the grant. The full original
  UI POST body was captured from a blocked retry without headers/credentials,
  parsed against the current schema and retained with hash
  `d1e0e9e0308d4fa78f730730fca3368ed9b5fa7cc3b2fb2c52411181092d673e`.
  Dates remain null, approval false, caps unapplied; final independent review is
  pending. Evidence: `FlareGit-Evidence/private-operation-preparation/candidate-de0-preparation/`.

- C03 original integration request is prepared through the normal hosted Changes
  UI, without new grants or budget changes. Selecting alpha/beta and Integrate
  returned the OFF gate's 403 before core dispatch; the UI retained request
  `b96691ae-cf8b-45ab-b825-9377964733d1` and its exact heads/base/policy across
  reload. No candidate or native allocation was created. Existing authenticated
  metadata GETs remain readable; both task accepted targets report incarnation
  `4456c750-bf44-45df-a36d-1fee63750ba3` from observed HTTP 200 state responses.
  No credentials were extracted. The old 40-group proposal is superseded in
  preparation by 40 core plus 20 read groups: static tally requires 36 core groups
  even on first success, and review needs a usable read allowance. New caps and
  phase remain unapplied; new exact-source human approval is required.
  Owner-only plan: `FlareGit-Evidence/private-operation-preparation/candidate-plan-de0-preparing.json`.

- Latest private deployment is Worker
  `d27e95cf-38ba-48aa-b24e-9bff58a92614`, at 100%, with core source
  `de0f6003264d89293e53d2a1a2a371f910ac343a` and module hash
  `02d0b7388495cd667815f50ad88f939d484ae900530eac79fdfdd1d3fbc3862f`.
  One scoped private code update changed only the source pin and narrowed native
  execution to false. Assets remain `952181f`; this does not deploy the new UI.
  Actual readback verifies retained bindings/assets, unchanged budgets/container
  configuration and zero queue consumers. Preview provisioning and phase grants
  remain absent. Owner browser reload confirms signed-in access, exact source/
  Worker identity and visibly disabled repository operations/execution.
  The original helper stopped after comparing JSON property order; independent
  semantic comparison proved exactly the intended two changes. Read-only follow-up
  completed all remaining checks; no second upload or rollback was needed.
  Immutable version `57d163a5…` is retained as rollback. Owner-only provider and
  rendered receipts: `FlareGit-Evidence/source-upgrade-de0/execution-helper/`.
  Public deployment, main/index and remote remain unchanged. This hosted result
  proves the private OFF owner/runtime flow; C02/C03/C05 acceptance remains open.

- Official competition rules and entry form were rechecked read-only on October 5.
  Workers plus Artifacts, actual concurrent agents, accepted source license,
  runnable instructions and a 5–10-minute video remain required; deadline remains
  October 14 at 11:59 p.m. PDT, and automated entry is prohibited. Owner eligibility
  is unconfirmed and a separate factual confirmation is pending. No terms were
  accepted, no entry fields submitted, and demo production remains held. The rules
  do not explicitly prohibit optional Clerk/BYO integrations; that is an inference,
  not sponsor approval. Sources:
  [official rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf)
  and [entry form](https://www.cloudflare.com/git-competition/submit/).

- C05 normal preparation now performs allocation and provisioning in one bounded
  operation; Resume is retained for interrupted requests. Local actual-controller
  and HTTP checks show preparation reaches active and repetition of the original
  UUID makes no further provider calls. Lost-upload acknowledgement retains the
  same request and resumes against exact provider observation. Root rendered the
  unchanged panel with an authoritative synthetic server: one Prepare POST reaches
  ready and survives reload. This is local evidence, not hosted provisioning.
  Exact child `de0f6003264d89293e53d2a1a2a371f910ac343a` passed its two
  focused parent tests, lint, typecheck and build; child controller/HTTP assertions
  are retained separately rather than inflated into parent counts. The original
  full isolated suite completed with exit 0 on this exact source: 447/447 files,
  1,794 passes, zero failures/errors and six existing skips, with unchanged
  deadlines. Complete inventory, results, summaries and per-file logs are retained
  with hashes at `FlareGit-Evidence/source-de0f600-preview-oneoperation/`.
  This is a full local source gate, not hosted acceptance or ticket completion.
  The earlier `cc9789b` snapshot retains the two-step behavior as historical evidence.

- Fresh private preflight at `2026-10-06T02:22:17Z` confirms Worker version
  `57d163a5-7bbe-4851-88f0-68b5e22be063` at 100%, declared core source
  `952181ffc477889d07c40e5510949cf49930bc58`, and current module hash
  `e38ddc66b7e987676d96d3e61857ca4da548ef82cbbbff595c558256c25b20b3`.
  Existing budgets and zero queue consumers are unchanged. RUNS remains false;
  integration phase configuration and preview provisioning settings/token are
  absent. The inherited native-enabled flag is true: the newly prepared strict
  OFF port requires explicitly narrowing it to false before deployment, rather
  than assuming the current binding matches. No provider mutation occurred.
  Integrator namespace/app/image linkage matches; provider active/assigned counts
  are zero but do not prove physical VM shutdown. Sanitized, hashed evidence:
  `FlareGit-Evidence/preflight-cc9789b/`.

- C05 onboarding now has source controller, HTTP and repository-settings UI
  wiring. It defaults OFF with zero allocation allowance; lifetime global quota
  reservations survive retirement, and provider credentials remain server-side.
  Local controller/HTTP tests cover insufficient or revoked tokens, expired
  sessions, owner changes during awaited work, original request recovery, and
  disabled provisioning without provider calls. Root-rendered local server checks
  show lost-response recovery and active state after reload; two synthetic
  prepare/resume requests retain the same UUID. The owner-reconciliation guard
  blocks Resume even when a conflicting fixture says `canRetry: true`.
  Final API-to-UI checking found successful POST responses lacked `canPrepare`;
  the owner corrected this and server/UI now share a strict DTO schema. Exact
  combined source revision `cc9789bd57d3a6b60c2e29e24dcd464c1d480e7c`
  passed 13 tests/45 parent assertions across five files, lint, typecheck and
  build. All seventeen hashes match; local checkpoint
  `codex/preview-onboarding-checkpoint` and durable
  `FlareGit-Evidence/source-cc9789b-preview-onboarding/` preserve the exact source
  and checks. Main/index and remote remain unchanged. This source is undeployed;
  no hosted provisioning or C05 completion is inferred. Local rendered receipt:
  `/private/tmp/flaregit-clone-clipboard-proof/preview-receipt.json`.

- C05 exclusive preview onboarding is being implemented source-only. The new
  durable allocation helper reserves repository/incarnation-derived origins and
  records dispatch before provider calls. Independent review identified duplicate
  registration after overlapping/lost responses and misleading retry status when
  dispatch remains unknown; these are unresolved repairs, not completed gates.
  Provider adapter, controller/HTTP wiring and hosted provisioning remain open.
- Combined source revision `b63affd260f17652b3ec162fd84bc22691888cb7`
  preserves sixteen replay/preview paths atop `8278ea4`. Its isolated gate passed
  19 tests/68 parent assertions across seven files, lint, typecheck and build.
  `codex/replay-preview-checkpoint` and durable
  `FlareGit-Evidence/source-b63affd-replay-preview/` retain the exact archive and
  checks. Replay HTTP is wired in source; preview onboarding is not. Root then
  found the preview upload omitted the required `PreviewAssetBroker` service
  entrypoint, so this snapshot is not called release-ready for provisioning.
  The owner corrected that metadata and is wiring authorized bounded onboarding.
- C08 replay failure now refreshes delivery state while retaining the original
  error and delivery ID; three local tests/five assertions, lint and typecheck
  passed. The backend currently increments generation on each explicit replay,
  so lost-response retry is not yet idempotent. Backend and client owners are
  implementing an original request identity and expected-generation contract;
  Hosted signed delivery remains open.
  HTTP source and local signed-auth checks passed: original requests
  preserve generation, malformed requests return 400, members/read tokens are
  denied, and queue-failure recovery retains the same generation. Root-rendered
  storage failure sent zero requests; lost acknowledgement/reload/retry generated
  two identical UUID/base-generation bodies and one generation. Fixture records
  are synthetic, not hosted delivery evidence; exact local receipt is retained at
  `/private/tmp/flaregit-webhook-replay-local/rendered-proof.json`.

- C05/C06/C07 narrow interaction repairs passed root-rendered local checks:
  credential copying catches missing/synchronously failing clipboard APIs and
  clears stale success on rejected retry; Inbox Archive Enter performs one
  triage write without navigation, while explicit Open preserves triage state
  and routes issues/reviews to their repository sections; release editor Escape
  retains notes when browser storage fails, closes after recovery, clears the
  resolved warning, and resumes the exact notes. Fixtures render actual components
  with explicitly synthetic local APIs. No hosted evidence or ticket completion
  is inferred. Exact child revision
  `8278ea4992eaa19f4adf5ad0e86c9b4bb02e139a` passed 11 tests/50 assertions
  across three files, lint, typecheck and build. Its five source files match the
  frozen manifest; local checkpoint `codex/interaction-recovery-checkpoint` and
  durable `FlareGit-Evidence/source-8278ea4-interaction-recovery/` preserve source
  and receipts. Main/index and remote remain unchanged; this revision is undeployed.

- C03 source revision `973dee5a5ec7d786a919b6cc910c674bd2db362c` closes the
  verified candidate-to-publication phase gap locally:
  the candidate grant permits only `integrate-*` under its single allocation,
  while the later publisher uses the same workflow. Replacing/removing the
  original binding cannot authorize publication. A distinct immutable publication
  grant is implemented against the existing exact human-review/PREPARED
  journal authority and verification cleanup closure, with fresh funding and
  separate allocation/command limits. Original grants are not reset. Rebase
  follow-ups remain separate; no hosted grant or acceptance has been authorized.
  Its exact isolated gate passed30 tests/123 parent assertions across seven files,
  lint, typecheck and build. Native/provider ports remain synthetic. A local
  `codex/verified-flaregit-973dee5` checkpoint and owner-only source archive/check
  receipts preserve the revision beyond temporary-directory cleanup. Main and
  remote remain unchanged; this publication revision is not deployed.
  Source-only composite Worker export verification subsequently passed two local
  workerd cases/eight assertions: exact approval admits publication, missing
  approval refuses it. The fixture imports the controller from the actual
  composite entry. Lint/typecheck/build pass. Its runtime classes come from
  `973dee5`, but ordinary fetch and custom deny-egress remain `952181f`; this is
  not a whole-source deployment, and the newer People HTTP fix is not served.
  The prior claim that publication requires a new HTTP route was incorrect:
  existing workflow RPC contracts are unchanged. The initial same-process
  Miniflare timeout is retained; separate fresh processes passed both cases.
  Evidence: `FlareGit-Evidence/private-operation-preparation/source-upgrade-973/`.

- The earlier comment-recovery source-only revision is
  `4560bdcb98e9ca4790b50b50c8de11566f729b7b`. It repairs the comment dispatch
  boundary after rendered testing of intermediate `c3468bd` found one synthetic
  POST despite unavailable recovery storage. That failure and intermediate checks
  remain retained. The repair's exact isolated three tests/15 assertions, lint,
  typecheck and build passed. Rendered rechecking now shows zero POSTs on storage
  failure, retained body/anchor, and an explicit no-comment-sent message; restored
  storage permits the original attempt. Line2 plus its draft survived reload.
  Parent `c3468bd` contains the migration publication-hash check (seven tests/31
  assertions); its combined source gate passed nine tests/42 assertions and static
  checks, but was not treated as release-ready after the rendered failure.
  These revisions remain undeployed; live private source is still `952181f`.
- The temporary candidate-plan file was absent on recovery. Its reviewed scope is
  now retained in the owner-only durable evidence file
  `FlareGit-Evidence/private-operation-preparation/candidate-plan-recovered.json`.
  Approval remains pending, activation is false, dates remain unset, and this
  recovered record is not an executable runtime. Rebuild and verify the exact
  private wrapper/config plus fresh preflight before any later activation; do
  not treat a missing temporary script as permission to reset reservations.
- Offline admission preparation has been recovered against archived `952181f`:
  six tests/25 assertions, typecheck and lint pass; foreign, legacy, model and
  publication events are refused. It is not a deployable Worker. Read-only
  Cloudflare recovery also retained the actual private deployed JavaScript bundle,
  version metadata and bindings owner-only, with canonical module hash
  `c88bcbd116b17fe7441e49214b9cc19e7baa7dcd9195ee8bad8575c4852b2663`.
  This recovers deployed bytes, not the missing original TypeScript harness.
  No deployment, quota, credential grant, queue or VM changed during recovery.
- Bounded history recovery found initial harness copies but no final copies
  matching retained hashes; they remain unverified and are not replayed. The new
  offline typed bridge now passes15 tests/46 assertions, typecheck, lint and build,
  plus independent review of frozen hashes. It retains the unchanged deployed
  baseline and ordinary authentication. Exact candidate scope/image/release gates,
  bounded131072-byte body reads, singleton queue batches, RUNSfalse and the fixed
  October13 stop are enforced. Local authority ports are synthetic; real signed
  Clerk authentication, hosted RPCs and deployment remain unverified. Approval,
  dates and activation remain unset. This is preparation, not deployment.
- Additional local bridge signature verification passed one test/14 assertions
  using the actual pinned verifier with synthetic local keys; wrong signature,
  expiry, issuer, authorized party, outsider and API-token cases did not execute
  core code. This is not hosted Clerk verification. Exact asset rebuilding matched
  only14/32 retained files, so unmatched outputs remain quarantined. Normal browser
  delivery recovered the private login JS with its exact retained `01b686ef` hash;
  no cookies or credentials were extracted. Deployment preparation is evaluating
  the documented asset-retention mechanism rather than substituting partial assets.

- Parallel source repair batch is frozen as
  `a54048baf149444d968442b1a5a121901e0a5e42`, fifteen paths on `952181f`:
  C05 clone clipboard recovery; C06 exact writer attribution with repository-scoped
  public card IDs and visible issue-linked request recovery; C07 persistence before
  tag/release writes; C08 preservation of one-time webhook secrets. File owners
  have frozen the completed slices, including visible restored issue context.
  The exact isolated checkout passed27 focused tests/99 assertions across seven
  files, plus lint/typecheck/build (55470 exit0). All fifteen captured hashes
  still match. These repairs are not deployed or ticket completion.
  Local rendered C07 verification observed zero POSTs during storage failure, one
  synthetic lost-acknowledgement attempt after storage recovery, and restoration
  of the original tag form after reload. Exact request identity is separately
  covered by focused source tests; no hosted tag write is claimed.
- Additional local verification of `a54048b`: clipboard rejection displayed
  manual-copy guidance with zero unhandled rejections; changing credentials
  cleared the prior feedback. Actual clipboard contents were not verified.
  The rendered webhook card kept creation disabled while its synthetic one-time
  secret was visible (POST count1), then allowed a second creation only after
  explicit acknowledgement (count2). These fixtures made no provider requests.
  New local workerd tests also exercised the actual People HTTP route: membership
  removal during profile loading returned403, and parent-token revocation returned
  401, without returning the private People response. The two test files are frozen
  in `2da92e5e2e983bafb3ff1fa6ec78ea8b289ad8a2`; its exact isolated HTTP test
  passed, and runtime bytes remain identical to verified `a54048b`. Hosted
  revocation remains unproven.

- Previous verified LOCAL and current LIVE source:
  `952181ffc477889d07c40e5510949cf49930bc58`.
  Final coherent source checks passed (handle27742 exit0): actual local workerd
  transport parent1test/1assertion with delegated child success, plus
  lint/typecheck/build0. No hosted VM or current full-suite proof. It adds
  native phase counter/date enforcement, atomic startup race fix and actual local
  Integrator transport tests, with14 changed paths since passing parent `95a`.
  Intermediate `f3e6` local24/103/static pass missed a concurrent stale
  `phase.started` bug and was not promoted. Controlled regression retained the
  old two-start failure; fixed controlled transport88662 exited0 with one
  start/two exec. Final952 independently rechecked the child transport and exact
  atomic Integrator hash. Intermediate phase24/103 evidence remains scoped.
  Parent `95a5c6b7` separately passed45/246 across8files/static checks and its
  build-only retry after retained NoSpaceLeft failure. No hosted/native candidate
  execution or current full-suite claim for952; ancestor3ae whole-suite separate.
- Current LIVE private source is `952181ff` on Worker
  `57d163a5-7bbe-4851-88f0-68b5e22be063`, with the scoped typed bridge installed
  but inactive. The single official upload returned200; readbacks confirm retained
  assets, exactly unchanged bindings/caps, zero consumers and unchanged Integrator
  image/configuration/namespace linkage. Normal owner UI confirms the new Worker,
  source952, original root and unchanged exhausted/expired operation limits.
  The prior immutable `fe60fe2e` remains the verified rollback target. Bindings
  remain identical; caps60000/read24000/managed43008, namespaces,
  secrets and expired READ window are unchanged. RUNSfalse, phase binding absent,
  consumer0 and container rolloutnone; no candidate/VM activation. Normal owner
  UI confirms exact source/Worker, WRITE0/READ1200 with expired22:42 window, setup
  cleanup/root6f, and both prior Ready checkpoints after fresh navigation. No
  legitimate saved integration row is expected; Integrate disabled without
  selection. No Select/POST/Retry or accepted-history mutation occurred.
- The fixed READ window expired October5 22:42:12 UTC. Fresh normal owner UI
  capacity readback on cfb/d53 showed WRITE0/account_budget and READ1200 remaining
  for a requested1200 envelope, but window inactive: no new admission. Setuproot
  and cleanup were confirmed. Cache-disabled reload showed rich current content
  while script query1271 remained; cache/version labeling issue, not absent
  deployment. Cache/network diagnostics were restored. Existing incident cleanup
  remains the explicit exception; prior reservations retained, quota is not cash.
- `95a` now coherently freezes strict stored/dispatched keyed-intent proof,
  prepaid cleanup closure and read-only existing core-reservation proof. Bounded
  four-by-two cleanup groups include fallback/alarm; explicit current-month holds
  retain original records. Offline actual getter/plan checks passed4/22 with
  types/lint. These source checks are not hosted closure or phase enforcement.
- Monthly policy explicitly HOLDs old-month records: original records remain
  identifiable, but no new current calls without funding, no reset/backdate.
  Funded cleanup closure is required before the one-candidate plan can run.
  The next owned source work is generic optional native-phase counter/date
  enforcement and an offline wrapper, preserving caps and cleanup funding.
  Proposed plan is one20-minute trusted VM/40new core groups; it remains disabled.
- Pinned d32 image compatibility receipt compares all14 loaded protected CLI
  files and Zod lock inputs with `9f` unchanged. This is read-only source/toolchain
  compatibility, not a native candidate run or hosted current-release proof.
- Actual local frozen95a UI QA/syntheticAPI preserved the original alpha+beta
  unknown-ACK intent while a separate alpha-only action created a new key.
  Storage failure issued0requests, then restoring storage allowed1. At390×844,
  fullUUID/SHA wrapped, Close stayed visible, Tab trapped and Escape returned to
  Inspect. Local tab5 closed/viewport reset; private tab2 unchanged. This is real
  local UI proof, not hosted candidate/publication proof.
- Storage recovery removed18 owned obsolete dry-run outputs (~190MiB), with
  safe nonforced cache cleanup partially denied for administrator-owned entries.
  Approximate available space688MiB. No source/evidence/history/installed app,
  user data or secret deletion; forced removal was rejected and not used.
- Consumers, candidate execution, model calls, new VM allocation, integration,
  acceptance and primary production changes remain off. A human approval question
  for the bounded40groups/one20-minuteVM candidate plan is pending; no reply is
  presumed. Exact verified candidate acceptance remains a separate later decision.
  Main/origin stay `bcd29bf9`; no public push/deploy/demo. Goal remains active.

Next: await the explicit bounded candidate-plan approval while preserving the
disabled952 rollout and its exact date/counter/funded-cleanup guards. No native
phase activation, fresh allocation or integration is implied by source or UI
checks. Earlier cfb/d53 receipts retain their separate historical source scope.
No cap/model/VM/queue/provider activation yet. Cleanup must remain funded before
any candidate work; later acceptance still requires the actual exact verified
candidate. Goal remains active; earlier hosted version receipts stay separate.

## Preserved execution history

### Earlier live READ-window handoff — window now expired

- Latest frozen source: `cfbfa5802277c6b2b9bb6d51db9265845d236c90`, a three-file
  read-only capacity delta on `5fa6025a`. Focused10/69, private helper2/18 and
  static checks passed, including effective wrapper lint. Earlier `5fa` typed
  refresh checks (19/88 plus session22/74) stay separately scoped. Private
  zero-byte Ready policy separately passed an actual local
  workerd HTTP socket fixture (one test/13 assertions). No full suite is claimed
  for this source; ancestor `3ae57f1` retains 417 files/1692 passing tests.
- Private Worker `d53e4d67-5dcf-45f0-975b-6aca3a4fb805` runs `cfbfa580` with
  a fixed one-hour READ extension, unchanged write/native limits, state/server
  secrets and no container rollout. The fixed zero-byte
  normalization is limited to the exact Ready request; malformed/foreign inputs
  remain denied. Earlier null-only and fixture failures are retained.
- Root's third alpha Ready attempt succeeded after the changed transport strategy:
  actual browser network HTTP200, UI Ready, Saved
  `ccd73897d5c41df6818382f6bcfabfae161e1a4e`, one checkpoint. Accepted root remains
  `6f514c9d9c698ea0821209fe1cd3e126d87b9712`. No release response headers were
  present, so source/Worker are deployment context rather than an HTTP header pin.
  The repository stayed visible through Verifying→Ready. First unknown outcome
  and second403 denial remain preserved; neither is relabeled as success.
- Alpha and beta bounded hosted Ready slices are proven. One beta Ready POST
  returned HTTP200 and UI Ready/Saved `8d51c342`/one checkpoint/`beta.txt`. Both
  tasks show Ready, Shared0, and accepted root stays `6f514c9d`. No alpha re-ready,
  extra workspace pushes, VM, integration or acceptance occurred. Contributors
  are manual; coding-agent runtime and full C03 remain open.
- Initial authenticated capacity showed core/read0 account_budget; that receipt
  is retained. The explicit fixed READ extension adds 12000 read allowance without
  resetting reservations: aggregate60000/read24000/write36000 unchanged,
  managed43008 unchanged, active 21:42:12–22:42:12 UTC. Owner readback then showed
  read12000 remaining/core0. Exactly seven reviewed variables changed; local5/102
  and independent4/32 checks passed. New read admissions stop at expiry; existing
  incident cleanup remains available. Official Artifacts billing begins October14;
  observed included-usage/$0 is not a final invoice or future-spending guarantee.
- Alpha Ready, exact saved commit and one checkpoint persisted across the new
  Worker/navigation. Expanding saved metadata showed `alpha.txt` without an extra
  SDK/Git read. An expired private cookie returned to its login, then the normal
  Open Staging owner JWT flow restored the dashboard and Changes. This is the
  controlled private gate flow, not a claim about a public authentication bug.
- Beta review diff and blob-by-hash GETs returned200; one added line and original
  goal comment2 were visible. Git Recovery403 did not block the readable diff.
  The exact full40 commit anchor came from visible DOM title, not React memory.
  A local nonsensitive line1 review draft survived reload with its body/anchor,
  diff and old comment, then body/anchor were cleared normally. No Comment POST.
- Actual hosted manual task Git remains proven on `3cd12305/e95`; canonical
  recovery/root/README is separately proven on `ef4c11d1/f7a9`. Credential delivery
  is resolved and secret files are excluded. Issue/comment identities, draft
  reload/discard, auth hydration and Changes honesty keep their bounded receipts.
- Main/origin remain `bcd29bf9`; production remains `ac98c981`, tag `34a1e7a`.
  No public release, accepted-history change or new model spend. C03/C05/C06 remain
  IMPLEMENTED; full acceptance, eligibility/IP and demo timing remain open.

Next: preserve both trusted checkpoints and the readable review context, then
resolve the defined integration/publication gate under the actual remaining
capacity. Core reservations remain exhausted; no integration or acceptance is
implied by the READ extension. Continue independent local $0 acceptance work.



### Earlier denied-Ready handoff — superseded by alpha success

- Latest frozen source: `b380770a848d6ee395f52d3c16f159873c861d94`, an 11-file
  Ready READ-funding/auth hydration/issue-identity delta on `a611ecb0`, including
  the valid Releases sign-in return route. Focused checks passed 37 tests/242
  assertions across seven files; lint/typecheck/exclusive build/dry-run passed.
  Private Ready guard passed two tests/13 assertions; wrapper checks passed four
  tests/24 assertions. No full-suite result is claimed for this source; ancestor
  `3ae57f1` retains its separate 417-file/1692-pass receipt.
- Private Worker `06173553-0965-4959-a8ad-f01f3a46ac75` runs exact `b380770a`
  after the private null-body guard update.
  Metadata changes only the source binding; caps/state/secrets stay unchanged and
  container rollout was `none`. Intermediate `5ecf` was never deployed. An
  overlapping-build tooling failure was preserved, then exclusive build passed
  without weakening code/tests.
- Normal reload initially reported “Loading sign-in…” then authenticated Changes,
  with no marketing page observed. The later screenshot shows authenticated
  Changes; it is not a loading-frame proof. Unknown checkpoint states stay honest.
- Root clicked alpha Mark ready once. The page showed “Repository state changed
  during read”; actual HTTP status and Ready outcome are unconfirmed. A read-only
  Retry/refresh restored two working tasks and accepted root `6f514c9d`. No second
  alpha Ready, beta Ready or integration action occurred. Source inspection found
  the normal no-body POST mismatches the private guard's required `{}` before
  admission; that is a source diagnosis, not an invented hosted403 receipt.
- The private null-body fix passed four local tests/23 assertions and unchanged
  caps, but a second actual alpha Ready click was denied. Browser network evidence
  reports HTTP403 and UI “Outside the exact private setup request”; the response
  lacks release headers, so Worker0617/sourceb380 are deployment context only.
  Accepted root remains unchanged. No beta, third alpha, or integration attempt.
  A true zero-byte HTTP POST can expose a non-null stream; runtime is switching
  to bounded zero-byte normalization only for the fixed Ready route, with actual
  Bun HTTP socket and negative checks before a reviewed update. The first unknown
  outcome and failed null-only strategy remain retained. Masked action-error source
  repair is independent. Ready success remains unproven.
- Actual hosted parallel manual task Git remains proven on `3cd12305/e95`, alpha
  `ccd73897` and beta `8d51c342`; canonical fresh clone/fsck/root/README recovery is
  separately proven on `ef4c11d1/f7a9`. Credential delivery is resolved, with no
  token files/revealed screenshots in evidence. No new contribution acceptance,
  coding-agent runtime proof or model spend has occurred.
- Issue/comment identities and cross-update unsaved draft reload/discard are
  proven within their bounded root UI scopes. The current honesty display is
  verified; trusted checkpoint validation and full issue-review-accept remain open.
- Main/origin remain `bcd29bf9`; primary production remains `ac98c981`, tag
  `34a1e7a`. No public release or cap raise. Eligibility/IP and owner demo timing
  remain pending. C03/C05/C06 remain IMPLEMENTED rather than DONE.

Next: verify the changed zero-byte-stream Ready guard strategy at the real HTTP
socket boundary and its reviewed same-cap private rollout, then reconcile the
existing denials before any further Ready/integration action. Current task commits and accepted history stay
preserved; no broader audit is needed.



### Earlier a611 handoff — superseded by bounded Ready attempt

- Latest frozen source: `a611ecb05e904d6ddb2c705c81b0ad1a991b38b4`, a three-file
  Changes inspection-status fix on `ef4c11d1`. Three focused tests/five assertions
  and lint/typecheck/build/dry-run passed. Ancestor `ef4c11d1` read-budget checks
  passed 29 tests/149 assertions. Neither has a new full-suite claim. Ancestor
  `3ae57f1` separately passed 417/417 files, 1692 tests,
  zero failures/errors and six existing skips.
- Private Worker `951a5e3e-2d3a-4036-8eb3-dd7b06f3431e` runs exact `a611ecb0`
  after an authorized same-cap rollout. Current Changes UI shows two active
  tasks, Shared files “—”, “2 changes awaiting inspection”, and both labels
  “Checkpoint not verified yet”; Integrate stays disabled. Earlier canonical
  clone/fsck remains proven on `ef4c11d1/f7a9`, with accepted root `6f514c9d`.
  No primary production state or admission caps were changed.
- Credential delivery is resolved: explicit standard Reveal UI delivered the
  approved credential directly to an owner-only file without model output,
  then hid it again. No token file or revealed screenshot is in the evidence
  packet. Earlier failed download/clipboard attempts remain chronological history.
- Actual Git run handle `57006` exited zero on source `3cd12305`, Worker
  `e95acc3a-d3ed-413a-9978-098199c84c60`. Two parallel manual task flows cloned,
  committed, pushed, fetched and freshly re-cloned exact task branches:
  alpha `ccd73897d5c41df6818382f6bcfabfae161e1a4e`; beta
  `8d51c34295aee91368d9abd5c0e9a65affdc45f8`. README digest
  `2386cd28454250e1d52c0dd63fa6fd2c0d41adc273664cef167bce9072a1f21d` and original
  canonical-workspace main `6f514c9d9c698ea0821209fe1cd3e126d87b9712` were preserved.
  These are real hosted manual contributions, not coding-agent runtime proof.
- A dedicated canonical read first used an incorrect URL; that script is
  preserved. The corrected read returned `429 capacity_budget`, with no writes
  and no completed canonical clone. Diagnosis found nativeRead charging the core
  pool instead of reserved read capacity. `ef4c11d1` fixes that routing; exact
  canonical recovery handle `61508` exited zero on Worker `f7a9d6ab`, preserving
  the accepted commit/tree and README. The expired-token failure remains retained;
  no workspace push was repeated during recovery.
- Real owner UI/API reports confirmed issue 1 and alpha/beta comments 1/2
  persisted across reload with the same IDs. Saved/recovered screenshots are
  private evidence. Normal Code UI shows the original accepted root/tree/README;
  Issues shows one issue with no duplicates after replay. Changes shows two active
  tasks; the inaccurate earlier “No pushed checkpoint yet”/Shared 0 display
  is preserved as history and corrected by the current honest uninspected state.
  No contribution is ready, integrated or accepted yet.
- Normal unsaved issue draft reload restored title and description with the form
  expanded across the ef4→a611 client update; issue count stayed one. Discard
  collapsed the form without Open issue or a creation request. Initial auth
  hydration briefly flashed the landing page before correct authenticated Issues
  recovery. This closes the bounded unsaved-draft reload slice, not all principal
  switching or collaboration acceptance cases.
- Main/origin remain `bcd29bf9a97ffc35584ce6d878f9cb88758d3ac5`; production remains
  Worker `ac98c981-da52-4cb7-84b0-c593c899e43a`, tag `34a1e7a`. No public release,
  new model spending or proposed new native alternative allocation is claimed.
- C02 hosted synthetic receipts keep their exact independent source versions.
  Full C03/C05/C06 acceptance, eligibility/IP confirmation and owner-requested
  demo timing remain open.

Next: root owns a coherent source freeze and reviewed same-cap private update
for the completed Ready read-funding repair, then the trusted inspection/Ready
gate for the two already-pushed task commits. Ready and integration have not
been invoked. Canonical recovery is proven on
`ef4c11d1/f7a9`; task durability remains separately proven on `3cd12305/e95`.
The current `a611/951a` display proves honesty, not checkpoint validation. Full
C03 acceptance and coding-agent runtime proof remain open.



### Earlier credential-delivery handoff — superseded by actual hosted task Git

- Latest frozen source: `3cd12305b857726893d675313f084046643ab59d`, a four-file
  UI API/issue draft recovery delta on `3ae57f1`. Focused checks passed: 32 tests,
  107 assertions; lint/typecheck/build exited zero. The current source has not
  repeated the full suite. Ancestor `3ae57f1` separately passed 417/417 files,
  1692 tests, zero failures/errors and six existing skips.
- Private Worker `f619bb3c-f6da-4f93-a766-62842057aa7d` runs exact `3cd12305`
  plus separately reviewed staging helpers on `private-c03.flaregit.com`.
  Only the source binding changed from the earlier `e3e611f9` rollout; isolated
  state, budgets, server-secret names and container bindings stayed unchanged.
  Container rollout was `none`. Strict TLS and no-store client delivery passed.
  Actual authenticated issue-context recovery and Code browsing are next.
- Real owner setup already confirmed private repository `pc8073e43b0cb`, original
  README root `6f514c9d9c698ea0821209fe1cd3e126d87b9712`, native Git-integrity and
  review-required policy. Alpha and beta were each created once; checked UI/API
  reports confirmed creation and revoked fork credentials. These reports do not
  substitute for independent clones or contribution acceptance.
- Latest equivalent repository-write/1800-second renewal was approved and minted
  once. Its displayed expiry was October 5 15:51 America/New_York (19:51 UTC,
  minute precision). UI Copy reported success, but the actual credential was
  never delivered to the requested plaintext Downloads file. Nonsensitive local
  handoff probes are not real-token or native-clipboard proof. Temporary local
  server handle `60217` is stopped; a nonsensitive CUA Blob download timed out
  and reset. No further handoff loops or silent duplicate mints are underway.
  This is a delivery-capability limitation, not missing scope approval.
- No hosted Git clone/push, new contribution acceptance or proposed native
  alternative has started. Native allocation remains on hold under the existing
  admission cap; billing API `403` remains an unavailable read, not zero usage.
  Local two-task Git runner receipts stay synthetic and separately qualified.
- Main and origin/main remain `bcd29bf9a97ffc35584ce6d878f9cb88758d3ac5`.
  Production remains Worker `ac98c981-da52-4cb7-84b0-c593c899e43a`, tag `34a1e7a`;
  no public release, newer CI or production-history change is claimed.
- C02 hosted synthetic boundary, browser and network receipts retain their exact
  individual versions. They do not establish current C03/C05 acceptance.
  Eligibility/IP confirmation and owner-requested demo timing remain pending.

Next independent work: normal authenticated issue-context preservation/recovery
and Code repository browsing on the exact private source, preserving all current
credentials and accepted history. Hosted Git remains a later gate after supported
credential delivery. C03, C05 and C06 remain IMPLEMENTED rather than DONE.



### Earlier October 5 handoff observations — superseded current-state summary

- Latest local frozen source: `3ae57f1be053286f07416eb8b162b5f12100726b`.
  Exact full suite passed: 417/417 files, 1692 pass, zero failures/errors, six
  existing skips; lint/typecheck/build passed. This is local source verification,
  not hosted token recovery or C03 acceptance. Earlier `23919dc` controller and
  ancestor `d71cc0d` full-suite receipts remain separately preserved.
- Main and origin/main remain `bcd29bf9a97ffc35584ce6d878f9cb88758d3ac5`.
  No newer public push or CI result is claimed.
- October 5 read-only deployment check still shows production Worker
  `ac98c981-da52-4cb7-84b0-c593c899e43a` at 100%, tag `34a1e7a`.
  Log: `/private/tmp/flaregit-c00-production-readback-oct5.log`.
- C02 owned hosted boundary batch `8729c924-ff43-48d0-9f0e-9a4aca8ce544`
  completed all five cases on `bcf2760`; both native instances shut down.
  Execution was withdrawn as Worker `e269808d-572b-44f2-8612-8f3c661c9cd2`.
  Build/DOM and network receipts retain their separate exact versions.
- Next: finish the user-requested normal native clipboard/plain-text Downloads
  handoff for the single renewed token before 18:24:54 UTC, then independently
  clone the registered workspaces. Equivalent repository-write/1800-second
  approval was already received. No further mint or scripted credential read.
- Owner approved idle staging setup with "Do what you need to do continue."
  Current private frontend Worker `e3e611f9-d49f-40f4-8ed7-9d22eef4f3a1` contains
  frozen core `3ae57f1` plus separately hashed access helpers. Real owner sign-in
  and exact authenticated runtime identity passed on `private-c03.flaregit.com`.
  State is isolated. One capped README initialization completed; models,
  integrations, payments, consumers and crons remain off. The owner inspected the
  private repository, native Git-integrity and review-required policy, then
  created alpha and beta once each; both checked UI reports confirm creation and
  revoked fork credentials. Scoped token issuance is confirmed; private delivery
  and independent hosted clones remain pending.
  The fixed-expiry Git-access control is deployed with unchanged bindings/caps;
  three local cases (20 assertions) passed. A normal reload now confirms exact
  source `23919dc` and Worker `ab9e8ee7`, with the Git control visible after the
  content-addressed/no-store cache correction. The control shows write access for
  this repository for exactly 30 minutes, without contribution acceptance. Token
  issuance received actual action-time human approval and one mint click. Normal
  UI confirms repository write scope, 30 minutes, expiring October 5 at 12:14:03
  America/New_York (16:14:03 UTC). The download observer timed out and reset;
  a second normal download click targeted the same credential without reminting,
  but no Downloads file is confirmed. This is a delivery-capability handoff,
  not missing human approval. At actual clock October 5 17:42:09 UTC, the original
  credential is expired and the exact Downloads file remains absent. Copy CTA
  and supported expired-token recovery are being prepared as source-only fixes;
  no renewal has occurred. No token value/ID was copied into evidence.
  Earlier deployed `b13e3e32` and stale rendered `7bc4ce4e` receipts are retained.
  Final private clone runner passed an actual local Git exercise on exact
  `task/c03-manual-alpha` and `task/c03-manual-beta` branches: independent clones,
  commits, push/fetch and fresh re-clones preserved README and original remote
  main. Earlier runs pushed fork main and are retained as historical local
  receipts, not task-workflow proof. This synthetic local fixture uses no cloud
  credentials or coding agents. Final hook review and hosted clones remain
  pending; the original approved token expired without successful delivery.
  Original approval and mint metadata remain retained. No hosted Git request or
  native allocation has started.
  Latest local receipt uses serialized owner-only atomic rename; this does not
  establish interruption or fsync durability.
  Earlier idle/access deployments retain their own receipts below.
- Normal owner reload confirmed source `3ae57f1` and Worker `16bbf06b`. The
  owner inspected the expired original token and no matching active token, then
  renewed the previously approved repository-write/1800-second scope once. UI
  confirms expiry October 5 14:24:54 America/New_York (18:24:54 UTC). Copy
  privately reports success, but the CUA clipboard returns zero characters;
  Terminal access is blocked and TextEdit timed out. No plain-text Downloads
  file is confirmed. This is a native delivery-capability handoff, not approval
  or scope uncertainty. No token value was retrieved/printed; no hosted Git has
  started. Earlier expired `239` evidence remains unchanged.
- The ordinary private `3ae57f1` frontend now renders through real owner sign-in
  on Worker `e3e611f9`. Account confirms one active renewed write token (metadata
  only), defaults read/repository-restricted/seven-day controls, keyboard repository
  selection, and fitting controls at 390×844. The selection remained a draft;
  no create/revoke/profile/settings mutation was performed. Profile, discovery
  and billing guard failures are visible and are not claimed functioning.
  Earlier `16bbf06b` auth/assets failure is preserved; exact 32-file assets and
  private public-key bootstrap fixed this bounded rendering path. C05 remains
  open: credential-file delivery and hosted Git clones have not occurred.
- Final private clone runner SHA-256 is
  `5fde83b144df18d1a755d9e42d738e0cde3e651c761bd91d38a3bd74e98c002c`.
  It reuses frozen `3ae57f1` release-pin/Git-origin configuration, checks expected
  Worker `e3e611f9` before hosted work, and refuses redirects. One independent
  local case (nine assertions), Bun build and actual local two-task Git run
  passed. The local receipt has `releasePin: null`, so it is not hosted pin proof.
  Local task branches, original main and README are preserved. Root confirmed the
  exact Downloads credential file is still absent; the original staging tab stays
  open without reload. No new mint since the approved renewal, and no hosted Git
  request has started. Native plaintext file handoff remains the next step.
- Eligibility/IP confirmation and owner-requested demo timing remain pending.

The entries below retain chronological evidence. Earlier disabled/preparation
states are historical; use this handoff and ticket rows for current state.



### C03 private staging preparation and pricing limits — October 5

Authentication preparation found no supported JWT export/device-login handoff
in the existing app/CLI; production keys on localhost are not an acceptable
substitute. Clerk's supported same-root subdomain flow is viable instead.
Read-only dashboard verification identified the actual FlareGit application
`app_3K77B7r28DR95F8LskvkQdYnpDS`, production instance
`ins_3K79xuED550uaOZNHXbSPHF5oak`, primary `flaregit.com` verified, with its
allowed-subdomains restriction disabled. The older dashboard link referred to
Rivetport and was not used as FlareGit configuration evidence or changed.
Private-browser access is being prepared for a fixed FlareGit subdomain using
normal Clerk authentication and an exact owner-subject gate; operator secrets
stay server-side. No Clerk setting, DNS record or primary application code was
changed during this read-only check.

The tmp-only owner browser gate now uses normal Clerk signature/issuer/authorized
party validation plus an exact owner subject, standard JOSE encrypted HttpOnly
host-only cookies bounded by JWT expiry, and fixed-origin write checks. Local
independent crypto checks passed 4 tests / 24 assertions. They reproduced and
fixed missing-origin write admission and echoed operator-header leakage in the
draft; failed receipts were retained. Git requests are refused if actual staging
credential verification is absent or fails. Credentials in these tests were
synthetic; real owner login and hosted Git authentication remain unverified.
No DNS record, cookie key, execution flag or deployed wrapper was changed by
this preparation.

Private hostname collision checks completed read-only: the active full
`flaregit.com` zone is `c3ef266bf5ab602ca96243cd5d0c9dad`; account custom-domain
inventory has no `private-c03.flaregit.com`, and zone Worker routes are empty.
DNS API read lacked permission, so the signed-in DNS UI was checked instead:
all 12 records were visible, followed by an exact `private-c03` search returning
no records. Apex and preview still map to `flaregit`. No DNS permission was
expanded and no record was edited during collision verification.

After the frozen access-only checks passed, the same private Worker was updated
as `0de478e5-0551-45e8-a773-90fd51b4d9f4`, and only `private-c03.flaregit.com`
was attached. System TLS verification passed; public login resources returned
200, protected unsigned requests returned 401, and the root redirected to login.
Production apex/preview mappings remain unchanged. Native execution, RUNS,
payments, all budgets, queue consumers and crons remain disabled. The private
`239` packet retained 16 verified hashes without changing its earlier 11 files.

Normal browser sign-in then used the existing real owner Clerk session. The UI
showed Joseph Simo and confirmed owner verification; the normal SDK session POST
is checked server-side against signature, issuer, private origin and exact owner
subject. No cookies/tokens were extracted, no actor was minted administratively,
and no Google consent or terms were accepted. Direct browser navigation to the
runtime JSON endpoint was blocked by the browser client, not a server failure;
normal in-app metadata fetching is being added for release-identity verification.
No repository, Git acceptance, model or native job has run in this environment.

The private client was then corrected to validate the session response and fetch
runtime identity through its normal authenticated SDK path. Two client checks /
11 assertions, strict types, lint, build and dry-run passed. The client-only
deployment is Worker `e183c629-a58e-41c8-b86f-1ce3549c6e04`; actual backend bindings
are identical to the preceding access deployment. Root's normal browser reload
confirmed owner verification and displayed exact core source
`23919dcfdb8dc26f50c15d5ef8d3b4d0fea05042` plus that exact Worker UUID. No token or
cookie was extracted by tooling; the UI used the ordinary Clerk SDK and guarded
runtime endpoint. The private `239` packet now preserves 21 verified hashes,
with earlier 16 files unchanged and UI observations labeled separately from
raw HTTP receipts. This closes sign-in/version prerequisites, not hosted Git
publication or recovery; native execution and all budgets remain disabled.

Next real-Git trial contract was checked against source `239`: ordinary
`POST /api/projects` repository creation with README initialization already
requires real Artifacts/native funding. It defaults to Git-integrity verification
and review-required acceptance; no policy rewrite is needed. Each workspace
creation must include the exact target from `GET /contribution-targets` in its
original request. Ready reads the actual remote branch SHA rather than trusting
a caller-provided commit. Integration uses the registered production workflow;
new candidate review binds `expectedCommit` and `expectedTarget`.

First-phase plan is one private README repository with stable creation request
`07fde1f6-f407-4c1b-9bdb-42c7f1011bfd`, two fixed committed-base workspaces,
then a repository-scoped 1800-second write credential and independent Git clones.
It stops before readiness, integration and candidate review. Source reservation
is 43,008 USD-micros for one native allocation at the actual image's maximum
1200 seconds, 1 vCPU, 6 GiB memory and 12 GB disk. This is conservative reserved
capacity, not an invoice cost. Git transport caps propose 48,000 USD-micros
split across 30 core and 10 read envelopes; optional/model capacity stays zero.
Only the trusted Integrator app may be provisioned, with max one instance;
agent/untrusted/browser execution is outside this phase. Server-side setup
limits and fresh included-allowance checks are required before activation.

The finite setup policy passed 4 tests / 36 assertions, including exact body and
target matching, replay identities, extra-operation denial and required metadata
reads. Stage API-token checks passed 6 tests / 38 assertions against actual core
authentication with local ledger ports; real token issuance remains unproved.
Setup configuration passed strict types, lint and local Wrangler dry-run. A
private owner setup control is being wired to the fixed creation UUID because
the ordinary form generates a different random ID. It uses normal Clerk session
requests and must recover the original intent on an uncertain response. No
allocation or repository request has yet been sent.

The reviewed first-setup configuration was subsequently activated privately as
Worker `07c4b90b-4881-4de9-b7be-60ea43ca5982`. App
`a03bf6e2-6b70-47e9-97b8-1ba72d0d1ca4` reports the exact trusted image, max one
instance, 1 vCPU/6 GiB/12 GB, and zero live instances before the owner action.
Normal signed-in UI confirmed the original request was absent, then sent exactly
one creation POST. Its strict durable report confirms repository
`pc8073e43b0cb`, root commit `6f514c9d9c698ea0821209fe1cd3e126d87b9712`, published
README baseline, nativeStopped and credentialsRevoked. A fresh GET of the same
UUID preserved that repository and root. The private `239` packet has 27 verified
hashes, preserving the prior 25 files unchanged.

This is a checked real owner UI/API report, not an invented raw native-command
receipt or fresh-clone proof. Separate account observations identify the original
initializer DO; empty instance lists are not used as cleanup proof.

The project-bound workspace update is Worker
`7bc4ce4e-f648-4669-bfe6-915201f3411a`, with the same core source and budgets.
Normal owner UI inspection confirms the repository is private, native
Git-integrity is enabled, review is required, and `refs/heads/main` still points
to `6f514c9d9c698ea0821209fe1cd3e126d87b9712`. The owner clicked alpha and beta
creation once each. Both strict checked UI/API reports confirm workspace
creation and revoked fork credentials. The private `239` packet now retains 31
verified hashes, preserving its prior 30 files. These task-journal outcomes do
not assert native absence or completed Git publication. Next: normal scoped
Git access and independent clones before ready/integration.

No contribution has been accepted;
the requested README is only the initialization baseline. No primary production
state, model calls, integrations or new candidate approval were touched.

Approved idle setup completed without production-state reuse. Four actual DO
namespace IDs differ from production; six workflows bind to the new Worker and
have zero instances. Queue `0c6cdadd471a4ecf872808a8a7f76de2` has no consumers;
the new R2 bucket has no objects. The separate Artifacts namespace is a binding
only and has not materialized because no repository was created. Two new
staging-only secrets were uploaded server-side; their values were neither logged
nor copied into evidence. There are no crons or production routes, and container
rollout was omitted. Five read-only probes—including a compiled asset and a
valid operator header while disabled—returned 401/no-store. The private `239`
packet retains 11 verified hashes with owner-only permissions.

This closes idle setup only. Hosted C03 publication/recovery remains unproved.
Next requires a bounded trial plan, fresh allowance checks, real signed-in owner
bootstrap and a scoped staging credential. Browser access must keep the operator
secret on a server; no client embedding. A new review-required candidate needs
new exact-commit human approval. No native jobs, models, repositories, customer
state copies or public application release occurred during setup.

Tmp-only config `/private/tmp/flaregit-c03-stage-preparation/worker.jsonc` imports
immutable core `23919dc` behind an operator gate, with separate DO state,
Artifacts namespace, R2 bucket, queue and workflows. Local Wrangler dry-run
passed; gate negative checks passed 3 tests / 17 assertions. Execution, models,
payments and compute/read budgets are disabled. There is no queue consumer or
cron, so disabling the gate cannot start a retry loop. This preparation is not
hosted verification or authorization to create resources.

The installed Integrator remote image pin is verified as
`d32bbfb56e65f0264a053ddb186c572331dc3cafad41409816cd2be71e2bfad2`, with matching
local RepoDigest. A stopped local container inspection verified all 353 files in
`/opt/flaregit/src/**`, package.json and bun.lock against exact source
`1b6a3f09b2985a5146e200989990fd420cd99d22`: no missing, extra or mismatched files,
including SHA-256, size and mode. No image program ran; only the owned stopped
container was removed. Receipt:
`/private/tmp/flaregit-integrator-content-zTr9Ph/receipt.json`.
The Git diff of `src/core/verification` from that source to `23919dc` is empty.
One subsequent offline pinned-image command verified actual Git 2.47.3 and Bun
1.4.2. The protected native-integrity CLI passed a real synthetic Git candidate
with matching commit/tree/base and Git-version toolchain digest. Candidate files
would throw if executed, but no candidate program ran. Docker used network-none,
pull-never, one CPU, 512 MiB and a 30-second timeout; the owned container was
removed after terminal exit 0. Receipt:
`/private/tmp/flaregit-integrator-toolchain-9O9Rxs/receipt.json`.
This closes current Workflow native-command compatibility with the pinned image,
not all transitive dependency provenance or whole-image reproducibility.
The trusted image is distinct from the untrusted build image.

Official pricing has no listed per-resource idle fee for these services, but
R2 bucket creation/listing consumes Class A operations. The observed account
had 299 Class A operations against its included million; this is an observation,
not a provider spending cap. Artifacts pricing states billing starts October 14,
with 10,000 operations and 1 GB included monthly, then metered overages. Namespace
creation's exact billing classification is not explicit. Local budgets set to
zero do not cap provider charges. Revalidate headroom before any execution.
Sources: [Artifacts pricing](https://developers.cloudflare.com/artifacts/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/).

**Handoff:** C | C00 (root), C02 (root with delegated boundary owners) |
main source `bcd29bf9a97ffc35584ce6d878f9cb88758d3ac5` matches `origin/main`
(rechecked); its historical local gate had 1,427 pass / 6 opt-in skips / 0 fail |
CI `37231011519` remains completed/failed at that exact SHA (rechecked). Portable
fixture repairs are in the newer local source; no newer push/CI result is claimed.
Baseline CI `37215340488` passed |
deployment `ac98c981-da52-4cb7-84b0-c593c899e43a` rechecked read-only through
`wrangler deployments list --name flaregit`: 100% at tag `34a1e7a`, uploaded
2026-10-04T14:26:50.614Z; operator source
`34a1e7a2c67c006243766462deda9578735328df`; no deployment performed by this push |
C01 scoped exceptions approved; C02 hosted trust/egress gates remain open.
Latest replay checkpoint: `b396722b88b56c807dfc7456d8fbf060e6a0fa1e`
(`codex/preview-replay-b396722b88b5`): includes the actual writer-claim fixture API.
Lint/typecheck/build passed. Full isolated suite completed with exit 0 under
session 47758: 385/385 files, 1565 pass / 0 fail / 6 existing skips / 0 errors.
The exact frozen worktree remained clean. Receipts:
`/var/folders/vy/rt9z2qpd4w380flzsz307d200000gn/T/flaregit-isolated-tests-tqJKg5`.
Log: `/private/tmp/flaregit-b39672-isolated-suite.log`. This is source verification;
no push, deployment or hosted verification occurred.
Private canary preparation from this exact checkpoint passed Wrangler dry-run
with `--containers-rollout none`; it exited without upload. C02 execution stays
disabled and image/source variables remain empty. Log:
`/private/tmp/flaregit-b396-c02-dry-run.log`. No registry push or cloud execution;
this does not prove hosted trust boundaries.
Additional zero-cost Linux verification mounted this exact source read-only into
the existing local image
`sha256:d32bbfb56e65f0264a053ddb186c572331dc3cafad41409816cd2be71e2bfad2`.
With networking disabled and strict native proof required, UID isolation and
diagnostic sanitization passed four tests / 51 assertions. Image runtime was Bun
1.4.2; the Mac full suite used Bun 1.3.4. Log:
`/private/tmp/flaregit-b396-linux-boundary.log`. This is local Linux defense-in-depth
evidence, not a new image release, complete Linux CI or Cloudflare isolation proof.
The two exact portability cases that failed main CI `37231011519` also passed
locally under Linux after installing this checkpoint's frozen dependencies in a
local test image. Current source/tests were mounted read-only and test networking
was disabled: two tests, zero failures. Logs:
`/private/tmp/flaregit-b396-linux-dependencies-build.log` and
`/private/tmp/flaregit-b396-linux-portability-current.log`. The first attempt with
the older dependency image failed to resolve Puppeteer and is retained separately.
This validates the affected local Linux cases; remote CI remains failed at its
older main SHA until a separately authorized source push and new run.
Verified local receipts and an exact-source archive are also retained outside
temporary storage at `/Users/josephsimo/Downloads/FlareGit-Evidence/b396722b88b5`.
The operator-private packet contains the source tree, suite inventory/results,
static gate logs, dry-run and qualified Linux receipts, with verified SHA-256
file hashes in `manifest.json`. Permissions are owner-only. It explicitly records
`hostedVerified:false` and `publicRelease:false`; it has not been cleared for
publication and is not the C10 submission/demo package.
Clean-source reproduction also passed lint, typecheck and build from the exact
preserved archive in a fresh local Linux workspace, without a Git checkout or
networking during the checks. Dependencies came from the preceding frozen-lock
local image install with lifecycle scripts disabled. This is qualified setup
evidence, not a hosted journey or full competition package. Log:
`/private/tmp/flaregit-b396-clean-source-reproduction.log`, retained in the private
packet with updated verified hashes.
Previous corrected checkpoint: `e3c6ca2b3bb7a7c7cfe88b8e44fb375895cbd2e8`
(`codex/preview-corrected-e3c6ca2b3bb7`): migrated fixtures, compute/upload
waiting-reader fixes, atomic writer claim and explicit no-output replacement.
Lint/typecheck/build passed. Full isolated replay completed with exit 1 under
session 52452: 385/385 files, 1564 pass / 1 fail / 6 existing skips / 0 errors.
The remaining lifecycle fixture failure was reproduced at the frozen revision:
its shared funding helper omitted the new writer-claim RPC. Adding the actual
SQLite writer claim preserved the two-store and unresolved-write assertions;
12 focused tests / 181 assertions and typecheck passed. A new frozen full replay
is still required. Receipts:
`/var/folders/vy/rt9z2qpd4w380flzsz307d200000gn/T/flaregit-isolated-tests-nPjor9`.
Log: `/private/tmp/flaregit-e3c6ca-isolated-suite.log`. Not pushed/deployed; this
run remains failed and is not combined with the focused pass as a full success.
Previous local source checkpoint: `215462614183ef8d01b6719c7b01d447946779c7`
(`codex/preview-source-215462614183`). Isolated preview/recovery migration,
dispatch ownership and output/source-cache recovery are implemented. Lint,
typecheck and build passed. Full isolated suite completed with exit 1 under
session 89147: 385/385 files, 1553 pass / 6 fail / 6 existing skips / 0 errors.
Five failures are in `build.test.ts` and one in `workflow-lifecycle.test.ts`;
both fixtures still target the retired preview builder and are being migrated
without weakening persistence, funding or cleanup assertions. Receipts:
`/var/folders/vy/rt9z2qpd4w380flzsz307d200000gn/T/flaregit-isolated-tests-iMr9LN`.
Log: `/private/tmp/flaregit-215462-isolated-suite.log`. No push/deployment or full
suite success is claimed. Earlier progress filtering missed the failed-file
label; this final aggregate is authoritative.
Follow-up repairs preserve the old build/lifecycle durability assertions while
using the isolated pipeline. Actual SQLite/R2 barriers exposed and verified fixes
for both compute-stage and upload-stage waiting readers: one funded build and one
writer remain authoritative; waiting readers cannot mark shared failure or clean
up the winner. Build/shared tests passed 17 tests / 76 assertions; lifecycle
passed 12 / 181. Atomic writer tests passed 4 / 24. Confirmed shutdown with no
output now permits an explicit replacement generation while keeping the original
dispatch sealed; unknown cleanup remains held. Corrected coherent gates and a
new exact-source full replay remain required.
Previous fully source-tested checkpoint `b596dd13f58b5ecc0c85464d02eab6631105ea9b`
(`codex/recovery-source-b596dd13f58b`) includes protected repair/recovery and review
guards: lint/typecheck/build and 20 focused tests / 359 assertions passed. Its full
isolated gate exited 0: all 377 files attempted, 1526 pass / 6 existing skips /
0 fail / 0 errors. Receipts are under
`/var/folders/vy/rt9z2qpd4w380flzsz307d200000gn/T/flaregit-isolated-tests-an1m65`.
Not pushed/deployed; this does not close hosted acceptance.
The corrected frozen base `f8a92d3a7c34edd8c0d41a90f46f175d31a13be9` passed all
373 files (1504 pass / 6 skips / 0 fail); later source is not covered by that pass.
Private C02 trial checkpoint `91ffa98d09f71acf79c993e7363e86ee49d90186`
(`codex/competition-source-91ffa98d09f7`): C02 fixes plus C07 API/UI/baseline;
1,438 pass / 6 opt-in skips / 0 fail, followed by 11 affected UI tests after the
final busy-close adjustment; lint/typecheck/build passed. Not pushed or deployed.
Earlier local checkpoint `56094783` remains recoverable.
Historical next action (superseded by the completed October 5 boundary receipt): finish the remaining C02 cross-task, synthetic-credential and native acceptance-inventory cases within verified
included allowances, maintaining the owner's $0 incremental-spending limit.
Local native probes stopped after documented SDK failures; they are not a passing
boundary proof. Current-source Linux CI still needs the repaired source pushed. Corrected private hosted canary spending
approval was refreshed for `b596dd13f58b`, superseding the unanswered `91ffa98d`
request and failed `0c37f864` source. Those requests were superseded by the owner's
$0 testing instruction and the subsequently verified included account allowance.
The official local
sidecar was downloaded without account credentials. Actual local Container API was reached, but subsequent nonroot probes caused
supervisor restart or failed exit 128 / missing container; no trusted interceptor
events were observed. The lane stopped after two further failures. Exact owned Wrangler processes,
containers and port 8944 were closed; original images and unrelated resources
were preserved. Failure logs are retained under
`/private/tmp/flaregit-c02-local-native-proof` and adjacent result/dev logs. Zero observer hits establish no denial proof. Those local attempts made no provider changes.

### C02 network proof preparation — local only

The fixed four-transport probe and durable owned-receiver nonce ledger are source
implemented. The receiver stores immutable registrations and first observations
with exact scope, endpoint, channel and nonce matching; SQLite restart and rollback
are covered. Combined local checks passed 12 tests / 58 assertions; lint,
typecheck and build passed on the working source. No receiver deployment or new
hosted network batch has run, and this is not a hosted egress result.

Next wiring: register an instance-scoped native HTTP/HTTPS interceptor through
Worker entrypoint props, authenticate receiver registration, and supply the
Cloudflare interception CA while retaining TLS certificate verification. Raw
socket cases cover HTTP/1.1 on ports 80/443 only, not arbitrary TCP protocols.
Receiver controls and native shutdown must be positively observed independently;
timeout, DNS failure and stdout never count as denial evidence.

C02 network preparation now also includes the authenticated receiver HTTP boundary,
instance-scoped native interceptor matcher, and durable one-shot native runtime.
The runtime consumes dispatch before execution, ignores stdout, installs deny hooks
before startup with internet disabled, and requires actual command settlement plus
positive shutdown. Unknown dispatches remain held and cannot replay. The native
Worker entrypoint reads registered props rather than headers, and the receiver
Worker uses a separate SQLite namespace from webhook receipts. HTTPS and raw TLS
use the fixed runtime interception CA plus public roots with verification enabled.
Combined network checks passed 29 tests / 169 parent assertions across seven files,
including actual local Workerd HTTP receipt handling and unchanged signed webhook
records. Lint, typecheck, web build and standalone canary bundling passed. The
Worker test first failed with Miniflare dispatchFetch authentication/header behavior;
its retained failures were resolved by direct local HTTP sockets with the exact
owned Host, rather than weakening endpoint ownership. These changes remain local
source; the network namespace is not yet configured or activated in the hosted canary. The completed first batch remains unchanged.

### C02 fixed network batch controller — inactive

The controller now derives and durably captures a single exact native instance,
probe identity, fixed commands and independent control/probe nonces. One
internet-disabled VM executes native controls through exact scoped forwarding;
independent receiver receipts admit transports before both hooks are replaced by
deny handlers. The same 120-second deadline covers both phases. Server credentials
remain in Workers and never enter native command input/environment. The receiver
service binding preserves the actual owned origin/path and separate durable ledger.

Actual local Workerd caught unsupported `redirect:error` in Worker fetch. Server
calls now use `manual` and reject redirects before accepting receipts. Cleanup
seals pending registration, so a delayed registration cannot dispatch afterward.
Local controller cases cover disabled/unconfigured operation, lost native ACK,
source/image withdrawal, and cleanup during pending registration; native RPC
returns in those cases are explicit test doubles, not hosted VM evidence.

Combined C02 checks passed 47 tests / 264 parent assertions across 13 files. Lint,
typecheck, build and Wrangler dry-run are separate gates; the dry-run uploaded
nothing and built/updated no container. Network execution defaults to disabled;
no new hosted batch or container has run. Next: freeze this source, run the full
local isolated suite, then check included capacity immediately before activating
only the isolated network test. Existing hosted security-fixture evidence and
production app state remain unchanged.

Frozen network-controller source `4edcdd145d0ad90f2745ac622fb2d638f4f84709`
passed the 47 focused checks and inactive dry-run. Its full isolated suite finished
395/395 files with 1,611 pass, 4 fail, 6 skip and 1 error. The authority fixture
returned exact-session absence while expecting a close call. The working-source
fixture now models active sessions, persists closure, and requires lookup/close/
lookup; its focused Workerd test, lint and typecheck pass. Three unborn-repository
lifecycle cases exceeded the default five-second limit and one late assertion
became an error. One unchanged-file reproduction passed all 12 cases / 181
assertions, with the affected cases completing in 0.9–1.5 seconds; no timeout or
product changes were made. The failed full run stays recorded in the private
hash-verified packet; that narrow rerun does not make it green. A corrected frozen
snapshot must pass the complete suite before hosted activation. No hosted
configuration has been applied.

Corrected source `8d855af5c65290cc3c621260ba3e376811311faf` is frozen.
Its full isolated suite passed 395/395 files: 1,615 pass, zero fail/errors and
six existing skips. The corrected authority and unchanged lifecycle cases passed. Exact archived source also
passed 25 local Linux/Bun 1.4.2 network-component tests / 178 assertions on immutable
image `sha256:03c172a5125eb1a417e442b4368accac6c7651de3c0e0d58265955af6fd8ad40`,
with network disabled and no dependency changes. This is compatibility evidence,
not hosted egress proof. The prepared network request remains undispatched and
both execution flags remain disabled. Included capacity must be refreshed before
hosted activation, now that the local date is October 5.

The receiver now uses a dedicated C02 operator credential, separate from legacy
webhook control. Actual local Worker tests verify that the credentials cannot
cross-authorize and a missing C02 credential fails closed. Four scoped tests
passed across receiver/controller/delivery files; lint and typecheck passed.
This receiver-only authentication delta is not included in the `8d855af` full
suite result. Canary runtime source remains frozen at that passing version;
receiver source/version is recorded independently before the hosted trial.

### C02 remaining boundary preparation — source only

Fixed A/B native programs, a two-role one-shot runtime, exact native callback
wrappers, trusted marker/refusal ledgers and evidence derivation are implemented
locally. A remains alive while B attempts known owned filesystem and supervisor
operations; the final inspection must address A's original instance. Synthetic
credential presence in trusted A is a positive control, with B receiving none.
Actual startup argument digests and separate inspector command identities are
required; attacker stdout never supplies inspection or acceptance authority.

The forged-inventory helper invokes production
`TrustedBrowserReceipts.verifyAndRecord` with an independently frozen expectation.
Its exact inventory guard refusal and absent durable receipt are required;
a supervisor publication marker alone is explicitly insufficient. Matching
untrusted inventory still grants no authority, but is not mislabeled as a
mismatched-inventory guard result.

Local checks passed 23 tests / 147 parent assertions across six files, including
actual local Workerd namespace/loopback checks without starting a VM. Lint,
typecheck and build passed during preparation. No boundary job, new container or
hosted marker probe has executed. Root still must wire the bounded controller,
refresh included allowance for at most two simultaneous VMs / 120 seconds each,
and collect actual hosted receipts. The completed earlier network batch remains
withdrawn and unchanged. These local results do not inherit the `8d855af` full
suite result or prove the remaining C02 gates.

### C02 boundary controller wiring — inactive

The bounded controller now registers original A/B native identities, keeps A alive
through B's probe, invokes the production inventory receipt guard, records trusted
post-attack inspections, and closes only those two known resources. Startup labels
bind request/task/launch identity and image; each command verifies the live original
instance before dispatch. Default boundary execution remains disabled.

Actual local Workerd testing reproduced a recovery race: a late A result could
replace `held` with `a_ready` and launch B after cleanup. The controller now fences
authority after each awaited result before persisting progress. The unchanged
negative test confirms zero B executions after recovery, no replay after lost ACK,
and refusal after source/image withdrawal. Failure stage is retained without raw
marker or credential output.

Wired checks passed 27 tests / 156 parent assertions across eight boundary files;
legacy canary tests also passed. Lint/typecheck/build and inactive Wrangler dry-run
passed. The dry-run uploaded nothing and provisioned no container. The new source
has not inherited `8d855af`'s full-suite pass; it must be frozen and verified before
the next hosted two-VM trial. No boundary VM or marker probe has run yet.

Frozen boundary controller `572b14ec0b4b0518c9f74f82ce2975969676947a`
passed 403/403 local files: 1,643 pass, zero fail/errors, six existing skips.
That result is retained separately from hosted readiness. Current official native
API documentation states `exec()` does not inherit startup environment except
PATH. The old positive control assumed inheritance and therefore must not run as
hosted proof merely because local API doubles passed.

Corrected fixed programs now inspect bounded `/proc/1/environ`, require exact
container-init provenance, and pass only the expected credential digest to setup.
They never reinject the credential into exec to manufacture presence. Updated
local checks passed 29 tests / 182 parent assertions; lint/typecheck/build passed.
A local Linux/Bun 1.4.2 functional run kept the original A container alive while B
ran in a separate container. Actual A PID1 environment was a positive control;
all exec environments were cleared to CI/PATH, B markers/credential were absent,
and A's digests/modes remained unchanged. Both owned Docker containers were
removed. This is compatibility evidence, not Cloudflare isolation or egress proof.

The Mac is currently locked, preventing fresh signed-in allowance observation.
The owner was asked to unlock it; independent source verification continues.
No boundary VM or marker probe has run on Cloudflare, and all private execution
flags remain disabled. The corrected programs need their own frozen checkpoint
and hosted receipts rather than inheriting `572b14e`'s local full-suite result.

Corrected init-environment source `bcf276096626ff9351437fbcee7e0a43d85cff34`
passed its complete local suite: 403/403 files, 1,645 pass, zero fail/errors and
six existing skips. Exact source and terminal receipts remain separate from the
pending hosted boundary trial; the current Mac lock still prevents fresh allowance
observation. No corrected boundary job has been dispatched.

### C00/C03 release identity preparation — not deployed

Core authenticated `GET /api/runtime` now reports only validated Worker UUID and
source SHA, with explicit null/unidentified state when either binding is missing.
Tags, timestamps and unrelated bindings are never exposed. Active stored read/full/
repository-pinned tokens can read the metadata; account deletion remains denied.
Wrangler now supplies Worker version metadata; source SHA remains an explicit
operator binding, never a fabricated default.

The acceptance CLI persists its first identified release pin. Later phases and API
requests carry paired expected Worker/source headers; the Worker refuses stale or
partial pins before admitting operations. Legacy unpinned receipts retain status
inspection but cannot silently become exact-release proof. This is request-level
fencing, not proof of background-workflow publication/recovery or the full C03 race
matrix. Review-required candidates still need a human exact-candidate decision.

Local release/helper/HTTP/acceptance checks passed 21 tests / 77 parent assertions;
lint/typecheck/build passed. Actual local Workerd checks include failed pinned DELETE
with unchanged active account, authentication, token scopes and no-store responses.
No runtime metadata endpoint or core app release has been deployed. C03 still needs
a private bounded orchestrator using the existing publication protocol and defined
before/after-ref-update pause points; local fixture controls must not become public
endpoints. Source tested/deployed/hosted evidence remain distinct.

### C03 private publication driver preparation — source only

Private checkpoint and driver ledgers now preserve exact project/incarnation/
candidate/ref/commit/tree and Worker/source identity, invocation UUID and request
UUID. Trusted callbacks mark before/after ref-update checkpoints; they never stand
in for Git readback. A durable command intent precedes publisher invocation,
duplicate continuation cannot invoke a second publisher, unknown ACK requires
independent history observation, and cancellation is restricted to undispatched
registration. Production authorization/CAS remain required by the injected real
publisher; no public fault-injection endpoint or workflow rewrite was added.

Eight local tests / 38 assertions passed. Real local Git tests exercise zero writes
before a pause, exact resumed publication, actual fresh clone/readback using
production `publicationInHistory`, lost ACK with preserved committed history,
withdrawn authorization and concurrent duplicate continuation. Lint/typecheck/build
passed. No real customer repository, accepted history, provider or hosted C03 run
was changed. The hosted matrix still requires owned authorized contributions,
human review/policy decisions and exact deployed-source reconciliation after C02.

The hosted C02 allowance refresh remains pending a manual Mac unlock. Existing
completed network evidence stays withdrawn/preserved; no new hosted execution was
substituted while independent C03 source preparation progressed.

### C03 bounded callbacks and native clone release fence — local

Private driver callbacks now have finite authorization/publication/readback bounds.
A timed-out publication retains its original command identity as unknown; late
responses cannot overwrite independent `readback-landed` state. Authorization
expiry cannot invoke the publisher, and readback timeout never means absence.
The retained background callback may settle independently without a retry.

The acceptance clone had omitted release pins from native Git. It now passes
origin-scoped authorization plus both expected release headers through process
configuration, keeps credentials out of argv/URLs, and disables HTTP redirects.
A foreign remote or malformed credential fails closed. Native Git's configured
multi-header values were checked independently; API pin checks alone no longer
stand in for clone request identity.

Combined driver/checkpoint/clone-pin checks passed 19 tests / 104 assertions;
lint/typecheck/build passed. Real local Git tests cover delayed ACK/readback and
concurrent continuation. These are not hosted publication-matrix receipts.

### C03 local publisher race verification — hosted gate remains open

`tests/c03-concurrent-publication-native.test.ts` invokes the existing production
`publishAcceptedCandidate` against a real bare Git repository. Two publishers
reach PREPARED on the same base; one lands, the other loses CAS, both candidate
refs and commit objects survive, and a fresh clone contains the winner. The
deterministic overlapping invocation passed 1 test / 12 assertions, lint and
typecheck. This does not prove the hosted Workflow publisher or runtime agent
concurrency; the private adapter for that publication path is still in progress.

An independent local rerun of runtime identity HTTP and clone pin checks passed
12 tests / 57 parent assertions, lint, typecheck and build. Seven relevant files
matched source `b1b1485336ed3ff843be6428eb270d00b36a62a8` throughout verification;
logs are `/private/tmp/flaregit-c03-continuation-*`. This is focused verification,
not a new full-suite receipt or deployment. C03 remains IMPLEMENTED, not DONE.

### C03 production publication adapter and interruption fixes — local snapshot

Private adapter checks trusted server release identity before write authorization
and production `casPush`, retaining the existing final dispatch guard and CAS.
Read-only recovery uses the original frozen journal and production Git ancestry
readback even after owner write authority or the deployment changes. Five local
tests / 30 assertions passed, with lint/typecheck. Provider and owner-ledger
boundaries in this harness are synthetic; no hosted authority proof is claimed.

The driver now persists authorization intent before awaiting approval and holds
failed or timed-out authorization explicitly. Duplicate continuation cannot
authorize twice, and late approval cannot publish. An independently confirmed
landing also survives a later negative readback response. Driver/checkpoint
checks passed 15 tests / 82 assertions.

Combined immutable local source is
`d71cc0dbbab9c9eb28de8b05ac23a2e0b02cfdf7` in the separate
`c03-exact-verification` worktree. Lint/typecheck/build and the full isolated suite
passed: 1679 tests, zero failures, six existing skips, zero errors across 411
files; original process 8999 exited 0. The worktree remained clean. Private
evidence packet `FlareGit-Evidence/d71cc0dbbab9` preserves nine verified hashes,
source archive, static logs, complete suite receipts and file inventory. The
suite receipt directory is `flaregit-isolated-tests-GSxAr7`. The C02 checkout stays at
`bcf276096626ff9351437fbcee7e0a43d85cff34`. Newer controller proofs below cover
supersession and acceptance-policy drift locally; hosted evidence remains open.
No C03 DONE claim.

Task-generation supersession preparation subsequently stopped after two failed
local cycles. Real task creation exposed an inconsistent requirement snapshot in
the existing verification fixture (`Primary branch ledger requires explicit
publication reconciliation`). Failed receipts and unfinished fixture sources
were retained outside the suite. Next strategy is consistent requirements before
task creation; no ledger reset or authority bypass is allowed. This fixture
limitation does not establish a production supersession failure or pass.

### C03 controller authority cases — newer than the frozen full suite

Dedicated Workerd tests invoke actual `cancelTask`, `configureAcceptancePolicy`
and `authorizeCandidatePublication` after prepared authorization. Both cases
start authorized, then reject a new publication and preserve accepted state.
Two tests passed with lint/typecheck. Execution ports remain synthetic; these
are local controller proofs, not hosted receipts. Cancelled contribution is
proved; task-generation supersession was subsequently proved locally below. Files
`tests/c03-publication-authority-controller.test.ts` and its dedicated support
fixture were excluded from the completed `d71cc0d` full suite.

Follow-up source `3acc347e2e9c3a1a21df27f49fd78e66858403f3` freezes only those two
test files and tracker changes on `d71cc0d`; production code is unchanged. Both
controller cases, lint, typecheck and build passed on that clean snapshot. Its
private evidence packet `FlareGit-Evidence/3acc347e2e9c` preserves six verified
hashes and links the parent full-suite receipt separately. No full-suite rerun
or inherited hosted proof is claimed for the child.

C06 source tracing confirmed existing issue-to-task, anchored comment,
request-changes, acceptance and issue-resolution wiring. Its remaining gate is
the defined rendered multi-user journey, including stale-review invalidation,
desktop/390px keyboard use, persistence and private-data isolation. No new
module was added merely to replace already functioning wiring.

### C03 task-generation supersession — actual local controller flow

The revised fixture creates an original task with its selected accepted target
in the creation request and keeps requirements consistent from initialization.
Actual controller methods verify the candidate, establish maintainer-policy
eligibility, and activate task generation 1 before publication preparation.
The old candidate then fails publication authorization and preparation; accepted
history remains at the original commit. This proves generation supersession,
separately from cancellation. Focused test, lint, typecheck and build passed.
Provider execution ports remain synthetic, so hosted C03 remains open.

Completed files are `tests/c03-task-supersession-controller.test.ts` and
`tests/support/c03-task-supersession-worker.ts`. Earlier failed fixture attempts
remain preserved outside the test suite. These files are newer than `3acc347`.

Follow-up source `23919dcfdb8dc26f50c15d5ef8d3b4d0fea05042` freezes the two
supersession files plus README and tracker updates on `3acc347`. All three local
controller cases, lint, typecheck and build passed; original processes exited
0 and the verification checkout remained clean. Private packet
`FlareGit-Evidence/23919dcfdb8d` preserves seven verified hashes. Parent `d71cc0d`
full-suite and `3acc347` CLI reproduction evidence remain separately qualified.
Production code and the staged C02 canary were not changed.

### C10 local reproduction and setup corrections — not a release

An independent extraction of source `3acc347e2e9c3a1a21df27f49fd78e66858403f3`
contains Apache-2.0 LICENSE and matches the cached package/lockfile hashes. Lint,
typecheck, web build, CLI compilation and source CLI help passed without install,
network, model calls or a full-suite repeat. This verifies cached local
reproduction, not a fresh dependency download or hosted provisioning.

The compiled macOS CLI initially exited 137 with an invalid ad-hoc signature.
The failed receipt was preserved. Standard local ad-hoc signing of only the
extracted binary then passed signature verification and compiled CLI help;
Gatekeeper and quarantine were unchanged. This is not distribution signing or
notarization. README now documents local signing, the isolated test runner and
required server verification/release bindings. Hosted setup remains explicitly
incomplete until configured and verified. SUBMISSION was not edited and no demo
was produced. Receipt: `/private/tmp/flaregit-c10-3acc-local-reproduction.json`.

The exact archive inventory has no flagged environment files, OAuth client
secrets, Wrangler state or personal temp/log artifacts. Four credential-shaped
hits were classified as synthetic fixtures without printing their values.
This static result does not grant publication, eligibility or IP clearance.

### C11 official requirements refreshed — no entry submitted

On October 5, the [official rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf)
and [human submission form](https://www.cloudflare.com/git-competition/submit/)
still require Workers and Artifacts, concurrent agents, approved open-source
licensing with LICENSE, reproducible instructions and a 5–10 minute video.
Deadline remains October 14, 2026 at 11:59 p.m. PDT. The form accepts MP4,
WebM or MOV up to 2 GiB. Demo creation remains deferred at the owner's request.

Eligibility requires an adult legal resident of the US or Canada and excludes
specified sponsor-related, sanctioned and government/public-enterprise entrants;
owner eligibility and third-party material permissions remain unconfirmed.
Rules section 9 treats submissions as non-confidential and grants sponsor
promotional rights while project IP remains with the entrant. No agreement was
accepted or entry submitted. No categorical exclusion of bring-your-own tools
was found; this is a reading of the rules, not permission for third-party assets
or services. October 16 is finalist selection; final judging is at Connect.

### C08 existing receipt coverage — current-release proof remains open

Saved owned-receiver reports show duplicate receipts increasing from one to five
while logical actions remain one. They reference previously accepted commit
`868aba34103e1f7a425807835c93906f427b3c37`, with a recoverable deployment ref.
They do not fully join producer Worker/source identity, transport failure/retry
HTTP responses and raw native recovery commands. Receiver deployment identity
is not producer identity; `deploymentExecuted: false` is not deployment proof.
No new delivery or replay was dispatched during this reconciliation.

The saved selected-branch public import proves 145 matching commits and a
non-shallow Git graph with native object/tree/parent checks. Its source head is
`4c6792e8c751844e148716bf24e525a1eb96c03b`; scope is the selected branch, not full
GitHub metadata or all refs. The producer release is absent from the receipt.
These historical receipts cannot close current-release C08. Full migration
coverage stays in F15; explicit export consent remains required.

### C02 hosted boundary trial completed and withdrawn — October 5

Fresh signed-in billing and plan readings established included headroom for one
bounded trial. Exactly one request `8729c924-ff43-48d0-9f0e-9a4aca8ce544` ran on
source `bcf276096626ff9351437fbcee7e0a43d85cff34`, execution Worker
`6e3be7ea-52b6-4950-9d9b-a02bda3f67ca`, and existing immutable image
`e517cc2cbf43c3cbf9fd9673582ee5826c1b00ca89fd143951b4d2e753a45640`.
Its exclusive attempt marker preceded dispatch; no retry or new identity was
used. Separate task A/B native instances ran five commands, all settled exit 0.

Trusted inspection preserved A's markers and synthetic credential; B lacked
both. Native-scoped operations refused foreign-task, supervisor and credential
requests. Actual `TrustedBrowserReceipts.verifyAndRecord` rejected fabricated
attacker inventory, with no verified receipt and unchanged synthetic publication
state. Independent derivation proved all five cases. Both exact native instances
were confirmed absent after shutdown.

Execution was withdrawn as Worker `e269808d-572b-44f2-8612-8f3c661c9cd2`; all
three flags are false and authenticated readback preserves the completed batch.
The dashboard showed zero live instances and $0 billable usage afterward;
lagging metrics are not a final invoice promise. The private bcf packet has 24
verified hashes, owner-only permissions, and exact job/versioned receipts.

These are owned synthetic security canaries, not production Git or agent
collaboration evidence. Earlier build/DOM and network cases retain their own
source/Worker versions; this trial does not re-label those receipts or prove the
current competition core deployment. No production app, repository, model call
or new container image changed.

### C02 prior disabled staging state — superseded by the completed trial

Read-only API fallback on October 5 did not close the spending gate. Existing
Wrangler authorization reads Containers/Workers/DO analytics, but billing usage
and account subscriptions return 403. Container aggregates have no October 5
row; absence is not zero current usage. Included allowance and current billing
headroom remain unverified. Private trial dispatch remains disabled until a
fresh authorized billing observation establishes headroom; no permission
expansion or UI lock bypass was attempted. Sanitized receipts are
`/private/tmp/flaregit-read-allowance-result.json` and
`/private/tmp/flaregit-read-worker-do-usage-result.json`.

Full-local-verified source `bcf276096626ff9351437fbcee7e0a43d85cff34` is deployed
only to private canary `flaregit-c02-private-canary` as Worker
`bb141a2e-fe5b-4fbd-8280-9ea110cb439a`. Its dedicated `c02-boundary` application
is registered with a two-instance maximum and the existing pinned image; no image
was built or pulled. All three execution flags remain false. Authenticated
readback shows no boundary batch, a negative start request returns 409 and leaves
that ledger empty, and the earlier network/DOM batches remain complete. Provider
instance listing returned no instances; that listing absence is not substituted
for native shutdown evidence. No boundary command has run. Fresh allowance
observation/manual Mac unlock remains required before activation; production
FlareGit and accepted Git history remain unchanged.

### C02 hosted network batch — positive scoped proof

Fixed request `e8287875-a7b8-4af8-9fb6-f6725ace116e` executed canary source
`8d855af5c65290cc3c621260ba3e376811311faf`, Worker
`7ea30eb2-6d20-41a6-814a-7cb6887f7d6a`, existing pinned image
`sha256:e517cc2cbf43c3cbf9fd9673582ee5826c1b00ca89fd143951b4d2e753a45640`,
and one registered native instance. Receiver source
`8b3f1870a5460af94d4f94230aafd118a4f192c9`, Worker
`c6e0dc91-7f2f-4e60-a598-afb5288eb3f8`, uses a dedicated network credential;
legacy webhook credential names and namespace remain preserved.

Four independently persisted receiver control receipts establish HTTP, HTTPS,
raw TCP/HTTP1.1 and raw TLS/HTTP1.1 on ports 80/443. The same exact native scope
then produced four registered-interceptor denial receipts. There are no receiver
probe receipts. Commands settled and native shutdown was positively confirmed.
All receipts match the registered scope and the 120-second window. This does not
prove arbitrary TCP protocols or complete the remaining cross-task, synthetic-
credential and native acceptance-inventory cases; `fullC02Coverage:false` and `acceptanceEvidence:false` remain explicit.

Execution was withdrawn after completion as Worker
`9eb925e7-4f7c-4808-9039-be1e22a366a9`. Readback after withdrawal preserves the
completed network batch, its original execution version, and the earlier completed
DOM security fixture. Refreshed provider inventory shows `c02-network` Ready with
zero live instances. Observed existing Paid allowance had ample headroom; displayed
billable usage remains $0, with metric lag and final invoice explicitly unconfirmed.
No plan changes, production app release, source push or Git-history acceptance
occurred. Exact receipts and hashes are retained privately in
`FlareGit-Evidence/8d855af5c652`.

C02's authoritative pass criterion permits owned synthetic Cloudflare canaries.
Fresh concurrent runtime agents remain required by the competition/C09 release
checks; they are not an additional C02 boundary prerequisite. Remaining C02 cases
are now explicitly scoped to cross-task/private-supervisor markers, synthetic
credential disclosure and unauthorized-operation refusal, and forged native stdout/
acceptance inventory. These cases must preserve exact native command/shutdown
receipts and independent trusted-state readback; no other user's data is probed.

### C02 hosted security-fixture receipt

One fixed authenticated Cloudflare batch `3480027c-e83e-4227-8818-72f15b25e0e6`
executed source `b396722b88b56c807dfc7456d8fbf060e6a0fa1e`, Worker
`320f511c-8e55-4456-883b-8e388dce61b3`, and pinned image
`sha256:e517cc2cbf43c3cbf9fd9673582ee5826c1b00ca89fd143951b4d2e753a45640`.
The actual isolated build produced immutable output; real Chrome observed
`Blocked` and refused the fixture's forged `Approved` result. Native shutdown
was confirmed. Browser cleanup initially remained unconfirmed because exact
session lookup threw after closure. That failed state is retained.

Supported native history subsequently returned the exact recorded session's
positive ordered start/end timestamps and normal closure. Cleanup correction
`60a8b6b7890dff84e46ef353ebd99c5a724d640c`, deployed only to the disabled private
canary as Worker `bc07ad18-c649-44f8-bbab-6bdd2a5582d6`, persisted the attributed
closure and completed the original batch without another acquisition or replay.
Its focused checks passed 48 tests / 276 assertions, with two local-browser
opt-ins skipped; lint/typecheck/build passed. Its full source suite is not yet
verified and must not inherit b396722's full-suite result.

The account's existing Workers Paid allowances were checked before execution;
post-trial dashboard showed $0 container usage charges and zero live container
instances. This is observed included usage, not a blanket future-cost promise.
The private evidence packet retains original incomplete and final receipts with
verified hashes. `fullC02Coverage:false`, `networkCoverage:not-exercised` and
`acceptanceEvidence:false` remain explicit: no Git production, genuine-agent,
network-denial or complete C02 claim follows from this security fixture.

No tickets are DONE. Source-tested, deployed, and hosted-verified are separate.
No deployment, public release, billing activation, spending increase, identity
migration, destructive action, or legal acceptance is authorized by this tracker.

## Local slices added October 8 (source-tested; no hosted proof)

- F02: `lfs-object-store.ts` (hash/size verified, per-repository quota, no partial storage).
- F04: `base-branch-change.ts` (retarget marks reviews stale, feeds the merge gate).
- F05: `issue-milestones.ts`, `issue-bulk.ts` (capped at 100), `issue-relations.ts` (cycles refused), `issue-templates.ts`.
- F07/F08: `polls.ts`, `snippets.ts`, `follows.ts`, `contribution-visibility.ts`.
- F10/F13/F14: `workflow-parser.ts`, `dependency-advisories.ts`, `webhook-signature.ts` (5-minute replay window), `oauth-scopes.ts` (exact redirect, PKCE S256).

## Engines added October 8 (source-tested; no hosted proof)

- F10: `ci-engine.ts`: runs a parsed workflow by topological waves; failed jobs skip dependents; `cancel` stops scheduling but does not interrupt running jobs (no timeout yet).
- F07: `wiki.ts`: revisions are append-only, saves require the expected revision, line diffs (LCS), revert appends a copy.
- F03: `blame.ts`: line-level blame and file history over an in-memory commit list, plus permalinks.
- F15: `import-bundle.ts`: verifies every digest before any write; conflicts reported as kind:id; store failures report partial writes.

## Modules added October 8, second batch (source-tested; no hosted proof)

- F14: `oauth-server.ts`: app registration, PKCE S256 codes, single-use codes, refresh rotation with family revocation, hashed secrets. Refresh tokens have no expiry yet.
- F12: `package-registry.ts`: publish with immutable versions, digest verification on fetch, private visibility, deprecation, exact/caret/x-range resolution.
- F09: `org-invitations.ts`: email-matched single-use invitations with 7-day expiry, no privilege escalation, teams. Team membership does not yet change permissions.
- F11: `deployments.ts`: one live deployment per environment, rollback, digest-verified serving. Not yet wired to the server.

## Server wiring added October 8 (tested under workerd; not deployed)

- OAuth and package registry are served at `/api/oauth/*` and `/api/registry/*` from a Durable Object (`AuthorityController`, SQLite-backed, declared in `wrangler.jsonc`). Browser sessions only for writes; API tokens cannot register apps, authorize, publish or deprecate.
- Introspection is not exposed over HTTP. Team and org membership are not yet read for private package visibility.
- Not yet done: a restart test in workerd (Miniflare here only supports in-memory persistence; restart behavior is covered by SQLite-backed tests), deployment of the new Durable Object class, and the duplicate-module decision for deployments and org invitations.

## Third batch of local slices, October 8 (source-tested; not wired into routes)

- F06: `project-views.ts`: iterations, views, status automation, bulk status change, deterministic export. Fixed: text fields could not be written.
- F15: `redirects.ts`: renames with loop refusal and depth limit, 90-day reuse window, tombstones. Importing redirects does not yet carry tombstones.
- F16: `agent-environment.ts`: fixed tool list, exact-host egress, no secrets, run ledger with timeouts. Commands can reach the network without a declared host; only runtime enforcement closes that.
- F17: `client-capabilities.ts`: one permission model for web, CLI and API, with per-surface request budgets. Role mapping awaits owner sign-off.

## Active ticket ledger

| Ticket | Status | Primary owner | Next acceptance action |
| --- | --- | --- | --- |
| C00 — freeze the current truth | IMPLEMENTED | root | Private frozen checkpoints, exact module/assets/bindings and scoped deployments verified. Current local checkpoint3ab; branch-read deployment pending. Public/CI/final competition reconciliation remains open. |
| C01 — settle identity and infrastructure exceptions | IMPLEMENTED | root | Scoped provider exceptions approved; identity and optional-service failure journeys remain to verify. Payments stay disabled. |
| C02 — replace assumed sandbox trust with demonstrated boundaries | IMPLEMENTED | root | Hosted build/DOM, four HTTP-framed egress denials, and five boundary cases passed with native cleanup. All ten fixed cases passed on frozen8dd; original-plan and inactive-resource readback passed on disabled15eb observer. Exact per-job versions preserved; competition/core release reconciliation remains open. |
| C03 — prove exact publication and recovery on the deployed snapshot | IMPLEMENTED | root | Exact owner-approved b32da71 is ACCEPTED in pc807, journal jrnl_a737aa27, with successful native publication and fresh Git clone/fsck proof. Accepted history preserved through subsequent deployments. Competing publishers, stale-base/policy/supersession/interrupt/cancel matrix remains open. |
| C04 — restore the automatic-integration promise without removing reviews | IMPLEMENTED | root | Protected browser/text repair and interruption recovery are wired and source-tested. Activation and hosted acceptance remain gated by C02/C03. |
| C05 — close the ordinary developer's first project journey | IMPLEMENTED | root | Real README/native publication and manual workspaces verified. Ordinary empty request73fb returned201, private p874 persisted across reload/authority withdrawal; all native instances inactive. Capacity and responsive UI verified. VM-free branch inventory/credential cleanup hosted verifiedcf59 on empty and committed repos without native compute. Two-account lifecycle, first human push/workspace and isolated previews remain open. |
| C06 — finish the core collaboration slice already present | IMPLEMENTED | root; UI slice delegated | Issue/comment IDs persisted after reload; unsaved draft recovered/discarded without creation. Changes honesty display passed on a611/951a. Auth/inspection honesty slices passed on b380/bd3; Alpha trusted checkpoint/Ready passed on 5fa/09eda after retained failures; beta unrequested. Both Ready checkpoints verified; beta diff readable despite GitRecovery403; local line-anchor review draft recovered/cleared without CommentPOST. Exact b32 contribution is accepted and durable (C03 receipt); the complete C06 multi-user issue/anchored request-changes/checkpoint invalidation/acceptance journey remains pending. |
| C07 — connect tags and releases end to end | LOCAL_VERIFIED | root | HTTP, native local Git and rendered dashboard checks passed, including committed baseline and interrupted request recovery. Current-release hosted journey and dependencies remain open. |
| C08 — make external delivery and migration coverage truthful | IMPLEMENTED | root | Existing owned signed receiver evidence retained; historical submodule omission bug reproduced and repaired. Exact release hosted signed retry/replay and migration coverage journeys remain open. Export requires consent. |
| C09 — run a fixed release acceptance batch | NOT_STARTED | root; runner hardening verified | Acceptance runner now refuses unrelated accepted history and binds saved integration/tasks/review/evidence. These tests are not live matrix trials; full fixed acceptance batch remains pending. |
| C10 — prepare a reproducible release and compliant evidence package | NOT_STARTED | unassigned until dependencies close | Freeze release/setup/materials and genuine video after C09. |
| C11 — freeze competition build; owner submits | NOT_STARTED | unassigned until dependencies close | Owner confirms eligibility/rights/terms and submits manually. |

### C08 current local verification

Frozen `b596dd13f58b` passed 49 focused tests / 380 assertions across ten
delivery, replay, external-check, migration and native Git mirror files, plus
three workerd HTTP/controller tests for connections, conversation migration and
webhook dispatch. Worktree unchanged; no provider calls or cloud spending.
Logs: `/private/tmp/flaregit-b596-c08-local.log` and
`/private/tmp/flaregit-b596-c08-http.log`. This is local verification only.
Saved hosted receiver and migration receipts must still be associated with their
exact deployed source, accepted commit and declared migration omissions before
C08 can close. Full migration remains in F15.
Saved receiver reconciliation confirms one stable event and payload for accepted
commit `868aba34103e1f7a425807835c93906f427b3c37`: first acknowledgement,
automatic retry and explicit replay record 1/2/3 receipts respectively with one
logical action; the later report has five receipts and still one action.
The earlier first/automatic-observation reports are empty and prove no delivery
at their observation times. These receipts record no producer Worker/source
version or HTTP 503/204 transport results, and explicitly record no deployment
execution. They therefore cannot establish current `34a1e7a` or `b596dd13`
hosted verification. Remaining join: producer release, transport responses and
native accepted-state receipt; preserve sanitized evidence durably for C10.

### C05 frozen token-control verification — `3ae57f1`, local only

Source `3ae57f1be053286f07416eb8b162b5f12100726b` freezes the explicit 17-file
C05 delta on `23919dc`, including strict token input, expiry metadata, Account
controls, shadcn primitives and the five additive Radix dependencies. The exact
417-file isolated suite completed with 1692 pass, zero failures/errors and six
existing skips; lint/typecheck/build also exited zero. The private `3ae57f1be053`
packet retains authoritative inventory/results/summary plus the exact source
archive. Older private `239` hosted receipts remain unchanged.

The `src/core/verification` diff is empty, which qualifies source compatibility
with the pinned native toolchain; it is not new runtime or image execution proof.
Private rollout was authorized after these checks but is not yet recorded here
as hosted verified. C05 remains IMPLEMENTED. Next: normal expired-token state
inspection, verify no active equivalent token, and supported renewal/copy under
the already approved repository-write/1800-second scope; hosted clones are open.

### C05 token controls — source only, separate from private staging

The ordinary Account token form now uses shadcn/ui fields, repository Select and
explicit scope/expiry controls. Defaults are repository-read access for seven
days; broader scope and no expiry require explicit selection. Unknown mint
responses retain the attempted state rather than silently retrying, and secret
history storage was removed. The backend rejects invalid explicit input before
minting, while omitted legacy defaults remain compatible.

Current Account source SHA-256 is
`09d4e887be485dcbc0856fc0d7c63a51775aca0d6d52bb0290a7d8fd8f3794ce`.
Nine focused tests (85 assertions), lint, typecheck and build passed locally.
Five Radix dependencies were added; existing direct dependency versions stayed
unchanged. Bounded file hashes and static logs are retained separately in
`FlareGit-Evidence/c05-token-controls-09d4e887`; this is not a new frozen release
or a full-suite/hosted result. Public deployment and authenticated rendered UI
remain pending. Private staging remains on frozen core `23919dc`, Worker
`ab9e8ee7`, with scoped token approval and actual hosted clones still pending.
C05 remains IMPLEMENTED; no token was minted by this source verification.

### C06 Ready funding and issue lifecycle — newer source, not yet hosted

The authorized Ready funding repair now classifies provider get/info/read-token
and exact head advertisement as one READ group of eight operations. Task-ready
credential cleanup uses an independent READ group (get/revoke), allowing cleanup
after authority withdrawal; other credential-purpose cleanup remains CORE.
Admission caps are unchanged. Native controller cases cover exhausted core with
remaining read capacity, zero-read refusal before issuance, and pending cleanup
when read capacity is exhausted. Focused checks passed three tests/nine parent
assertions plus five core-budget tests/43 assertions; lint/typecheck/build passed.
These are newer source changes outside `a611`, and hosted Ready is unexecuted.

Issue session-lifecycle additions separately passed seven tests/25 assertions
for actual API release/rebind/principal-switch behavior, with lint/typecheck
passing. That test-only delta is also outside `a611`; the actual root browser
cross-update draft reload/discard receipt remains separate. Next coherent source
freeze may include these tests with the Ready/auth updates. No test-only deploy,
new native allocation or accepted-history mutation is implied.

### C05 active preview boundary repair

Source inspection at `b596dd13f58b` found reachable legacy contributor builds in
`preview-generation-build.ts`, `build.ts`, and the Workflow compatibility preview
stage. These execute `build-preview.ts` inside the Integrator instead of the
separate isolated runtime. Existing generation tests stop before a successful
build and do not prove that boundary. Repair owners: hosted_recovery_plan for
builder/callers; c02_browser_verifier for accepted-preview execution authority;
root for shared controller/Workflow wiring. The existing integration-only grant
must not be weakened or supplied fabricated candidates. Preserve exact accepted
commit, generation recovery, storage reservations and positive cleanup with a
real preview-specific durable authority. This repair is in progress, not verified.
All three server call sites now avoid the legacy build script: Workflow uses the
exact independently browser-verified artifact; ordinary and generation builds
call the shared isolated builder. Frozen-output publication and browser binding
passed five focused tests / 117 assertions. Thirteen affected Workflow tests /
324 assertions passed, including protected merge/squash repair, source-race
refusal, VM-loss retry, optional follow-up failure and publication lost-ACK
recovery (`/private/tmp/flaregit-preview-workflow-focused.log`). New controller
interfaces, native source closure and completed-output recovery are still being
implemented; the combined typecheck is not yet passing. No hosted claim.
The evolving preview slice subsequently passed 29 tests / 279 assertions across
isolated builder, immutable publication, real-Git source reader, generation
recovery and build dispatch ownership (`/private/tmp/flaregit-preview-components-combined.log`).
These include lost-output reply recovery without another run, unknown dispatch
holds, concurrent losing callers, credential cleanup uncertainty and permission
withdrawal. Production controller wiring and bounded source persistence remain
in progress; this is not a coherent frozen-source or hosted completion receipt.
The actual workerd controller's no-attempt recovery case, durable authority
negatives and Sandbox output recovery passed six tests / 17 parent assertions
(`flaregit-preview-controller-focused.log`). Native lifecycle/provider ports are
explicitly synthetic. Source cache now uses bounded chunks and a 64MiB repository
capacity hold; uncertain writes retain capacity. Completed-cache retirement and
the controller happy path are still being verified. Owner retry/replacement
routes reconcile the exact saved isolated attempt and return 409 for unresolved
execution or an absent accepted commit, preserving history and reservations.
Local controller verification now includes successful build/grant/seal/owner
release, identical saved-output retry and owner withdrawal, plus real controller
funding denial before any source lease or credential intent. External runtime
and provider ports remain synthetic. The source cache's three tests / 32
assertions passed after correcting native Git fixture byte ownership; failed
fixture runs remain retained. Raw-source copy tests passed nine tests / 124
assertions. Final coherent typecheck is being completed after fixture DTO fixes;
no release SHA or hosted completion is inferred from these evolving receipts.

### C07 active implementation receipts

Owner: root; HTTP owner `review_scenario_server`, UI owner `review_scenario_ui`.
Local delta after checkpoint `56094783` adds scoped exact-ID tag/release reads,
existing-ledger HTTP routes, and explicit committed baseline tag provenance.
A baseline is the immutable recorded initial commit/tree on the ready primary
accepted branch, with source identifier `baseline` and root version zero. It is never
an invented review journal or arbitrary requested SHA. Native Git rejects a
mismatched source before push and preserves the current branch when tagging the
historical baseline. Release source validation distinguishes baseline zero from
positive reviewed acceptance versions.

Focused native controller/Git checks passed; release-record suite plus controller
passed 6 tests / 27 parent assertions. Signed HTTP/native Git fixture passed lost
ACK recovery, member/read-token reads, outsider/writer denial, stale revision and
mismatched source refusal, with unchanged accepted branch. HTTP baseline updates and dashboard wiring are source-tested. The coherent
full suite passed 1,438 tests / 6 opt-in skips / zero failures across 357 files
(16,080 assertions), plus lint/typecheck/build. Final busy-close accessibility
adjustment passed lint/typecheck/build and 11 affected UI tests / 51 assertions.
Rendered component checks passed at 1280×900 and 390×844, light/dark, including
separate metadata after native failure, member control denial, long content,
escaped markup, keyboard focus, and original tag/note identities across reload.
These are synthetic UI fixtures, not hosted customer journeys. Logs:
`/private/tmp/flaregit-c07-scoped-record-read.log`,
`/private/tmp/flaregit-c07-baseline-source-tests.log`,
`/private/tmp/flaregit-c07-baseline-native.log`,
`/private/tmp/flaregit-c07-coherent-full-tests.log`,
`/private/tmp/flaregit-c07-final-ui-tests.log`; screenshot evidence uses
`/private/tmp/flaregit-c07-release-*`, `notes-recovery-*`, `busy-*` files.
These use owned local Git and synthetic provider ports, not Cloudflare receipts.
No tag/release was published to a live customer repository. C07 is not DONE.

### C04 active source work — inactive until C02/C03 verification

Owner: root; policy ledger, controller, Workflow, API and dispatch planner have
separate file owners. The policy foundation defaults to review-required with no
invented owner authorization. Explicit opt-in is limited to the protected adapter;
imports remain review-required. Immutable policy events record actor/version and
stable CAS identities. Automatic candidate authority is distinct from human review
and requires exact trusted native/source/build/browser receipts, current context,
nonempty approved requirements, complete coverage, confirmed cleanup and no pending
mandatory human reviews. Historical receipts remain readable after withdrawal but
cannot authorize a new dispatch. The focused SQLite module gate passed 6 tests /
54 assertions and typecheck. Controller and Workflow integration are in progress;
there is no hosted auto-accept claim. Controller, Workflow and signed-owner API
wiring now have focused checks; policy UI passed synthetic rendered permission,
recovery and replay checks at 1280/390 in light/dark. Root ready-cohort scheduling
uses actual controller inputs, stable checkpoints and requirement digests, daily/
global admission and one-shot SDK creation; Workflow transport ports in its tests
are synthetic. A whole-workflow seal was found to prevent later publisher startup,
so verification now has a distinct immutable native/credential closure receipt.
Only the exact publisher and separately authorized accepted rebase may follow;
verification cannot reopen. Root phase/dispatch/API slice passed 19 tests / 129
assertions plus lint/typecheck. The actual publisher-stage positive gate is being
updated to consume this receipt. The actual-controller/local-Git publisher gate now
consumes the phase receipt and passes, including owner rejection and the original
accepted-history readback. This remains local evidence, not a Cloudflare receipt.
The coherent C04 suite recorded 1468 passing, 6 skipped, 5 failing tests and one
error (`/private/tmp/flaregit-c04-coherent-full-tests.log`). The post-publication
fixture omissions and four-push rebase setup contention were corrected; focused
reruns passed without weakening assertions or deadlines. A new coherent full run
is still required. The real controller now records trusted primitive browser
failures for repair inputs. Five focused tests passed with lint/typecheck; a
synthetic transport close cannot substitute for an acquired Global browser lease
and positive shutdown observation. Repair dispatch and hosted dependencies remain
open; this does not grant candidate acceptance authority.

### Visual quality correction — active local work

The owner rejected the first logo and the current interface quality. Separate
owners are refining the landing page and workspace overview; the overview now
uses current actionable repository metadata rather than historical waiting inbox
events. Historical conversations and notifications remain intact. The new bounded
attention read has fresh account/member/token fences and state-bound pagination;
its five helper/signed-HTTP tests pass, including revoked tokens, membership loss,
legacy initialized reads and preservation of unread history. Exact task/decision
navigation passed two rendered-markup tests (18 assertions). Root inspected the
actual landing and full App/Home shell at desktop and 390px in light/dark, plus
independent work-read failure and partial-data states. The local Home harness is
explicitly synthetic UI QA, not a production/concurrency receipt. No horizontal
overflow was observed; extreme repository metadata needs a phone layout refinement.
The coherent full suite is running under session 54369 with output at
`/private/tmp/flaregit-coherent-visual-c04-tests.log`; it has reproduced two native
fixture timeouts (saved-rebase racing-head 5 seconds; 1103-commit import 30 seconds).
No green result is claimed. The import fixture already uses fast-import; its
synthetic destination reader still spawns one Git process per commit. The next
fixture correction will preserve the real pinned graph and all assertions while
reading its metadata in one native Git traversal. That test-only correction now
passes the complete 1103-commit/frontier case in 2.03 seconds with all 14 assertions
and the 30-second deadline retained (`/private/tmp/flaregit-longgraph-final.log`);
lint/typecheck pass. Rebase's two independent full-fixture scenarios are being
split into separately required cases with unchanged 5-second deadlines. The same
full run also exposed first-root controller fixture timeouts and secondary errors
after killed Git processes; focused diagnosis is required before treating those
as product regressions. That pre-correction run is now terminal: 1468 pass,
6 skipped, 16 failures, 3 errors across 1490 tests / 370 files in 915 seconds.
Later native/workerd cases also hit their unchanged deadlines; some secondary
errors followed cancelled fixtures. One equivalent full-gate strategy now isolates
each complete test file in a fresh Bun process without omitting cases or changing
deadlines. The original `bun test` gate remains failed. The corrected rebase file
passes all 8 cases / 192 assertions. Current post-correction lint, typecheck and
web build pass; repair dispatch/Workflow wiring remains in progress. No hosted
proof or completed ticket is inferred. Local disk pressure was observed at 100%
with approximately 640 MiB available; only an unused disposable CLI cache was
removed, and the initial age-filtered Docker cleanup reclaimed zero bytes. After
the owner requested space cleanup again, the correct Desktop build cache was
identified and disposable entries cleared with official Buildx pruning. The
completed final pass reported 13.81 GB of cache reclaimed; host free space rose
from under 400 MiB to 11 GiB. Images, containers, volumes, project data and recovery
receipts were retained. Administrator-owned package/browser caches were left in
place. Disk pressure is no longer the immediate local verification blocker.
The editable Blender master remains outside the repository. The identity is not
owner-approved or deployed. No competition ticket is DONE from this visual work.

The refined original mark is now integrated locally through a shared brand
component and an optical SVG favicon. Root inspected the branded landing at
desktop and 390px, including dark mode and page bounds. The favicon's standard
Bun asset import was corrected after a real build failure; the subsequent build
passed and emitted a hashed SVG. Screenshot: `/private/tmp/flaregit-branded-landing.jpg`.
This is local rendered evidence, not a deployed result or owner quality sign-off.

Local WIP source is durably preserved at
`5ee676ad4392efc755ac79d41d98a1df570bd10a`, branch
`codex/source-snapshot-5ee676ad4392`. Main remains `bcd29bf`; no push or deployment
occurred. User edits to SUBMISSION and the untracked AGENTS file were excluded.
This checkpoint is not a release candidate: interruption recovery, protected text
conflict repair, the equivalent full suite and required hosted gates remain open.

The complete isolated run for `5ee676ad4392` attempted all 373 discovered files:
1495 passed, 9 failed, 6 existing skips, no aggregate errors. All nine failures
were in the lifecycle fixture that omitted recorded candidate state; that fixture
was corrected in the current checkout and all 12 cases / 170 assertions pass.
The immutable run remains failed. Receipts:
`/var/folders/vy/rt9z2qpd4w380flzsz307d200000gn/T/flaregit-isolated-tests-5pQ91R`.
The corrected frozen commit `f8a92d3a7c34edd8c0d41a90f46f175d31a13be9`
changes only that lifecycle fixture and the runner's failure label. Its complete
isolated gate exited 0: all 373 files attempted, 1504 passing, 6 existing skips,
zero failures or errors. Receipts:
`/var/folders/vy/rt9z2qpd4w380flzsz307d200000gn/T/flaregit-isolated-tests-3ZV5jF`.
Newer historical recovery and native conflict RPC changes are outside this passing
snapshot and still require their own coherent source gate. Main and deployment
remain unchanged; this is source verification, not a hosted acceptance batch.
The original verification worktree's detached commits were preserved at
`codex/preserve-verification-output-5e71f3f` before the frozen gate used it.

Current protected Workflow merge/squash cases use real Git and a durable model
ledger with explicitly synthetic external model/build/browser ports. Lost model
acknowledgement recovers the same recorded patch, and the repaired SHA gets a
separate immutable revision pin and independent verification. Nine focused cases
/ 125 assertions pass. Historical step retry after the candidate advances is now
wired through readonly original-record recovery before resource allocation.
Root's current focused slice passed 8 tests / 157 assertions across real Workflow/
Git, conflict capture and actual controller checks; external ports remain
explicitly synthetic. Prepared/uncertain outcomes stay held rather than silently
dispatching another model request. The fixed
native conflict inspector is implemented and has five tests / 32 assertions;
paired stages 2/3 with matching modes are required. Delete/modify conflicts remain
for an explicit contributor decision. Its controller/Workflow integration remains
open; no additional C04 hosted evidence is inferred.

The current repair/review slice is preserved at
`9489735b6a8f598cc7744ac96e5807ad12ab624d` (`codex/repair-source-9489735b6a8f`).
Before freezing it, lint/typecheck/build and 11 focused tests / 229 assertions
passed. Merge text repair's deterministic commit bytes were corrected to match
Git's trailing-newline normalization. Root rendered the repaired Collapsible:
closed patch content is absent, Enter expands it, and unknown repairs disable
acceptance while retaining rejection/diff access. Mobile bounds matched viewport;
the harness remains explicitly synthetic UI QA.
The common server gate checks completed model receipts, exact pins/native proof,
round continuity and the final candidate SHA before any new acceptance. History
and reconciliation of already-confirmed Git updates stay separate.
Full isolated gate for this exact snapshot is running under session 1651, log
`/private/tmp/flaregit-948973-isolated-suite.log`. Later unverified conflict-head
input preservation and text step-retry work is outside this frozen snapshot.
That run is now terminal (exit 1): all 377 files attempted, 1518 pass, 4 fail,
6 existing skips, 1 aggregate error. The failures were unchanged five-second
deadlines in three native Git files; the error followed a cancelled child case.
Exact snapshot reruns, without source or deadline changes, passed all 11 cases:
first-root 5 in 7.31 seconds total, native integrity 4 in 2.55 seconds, unborn
integrity 2 in 2.15 seconds. Logs use `/private/tmp/flaregit-948-*-rerun.log`.
No product failure was reproduced in those reruns, but the complete run remains
failed; a stitched or hosted pass is not inferred.
The full-gate checkout remains clean and exactly at `9489735b6a8f`; later main
checkout edits have not entered its inventory. Conflict-head admission now has
9 native/source tests / 88 assertions requiring the exact recorded candidate,
attempt UUID, HEAD and repository scope. Historical receipt reads after an outer
Workflow failure are being checked separately from inspection permission; a
failed candidate must not grant new execution, nor erase its recovery evidence.
Text step retry is now implemented and source-tested using a private, unverified
HEAD input pin plus the stored index/worktree digests. Merge/squash retry after
actual failed status recreates the same commit with the same model UUID and one
model call; reconstructed-source drift is refused before verification/publication.
The coherent current slice passed lint/typecheck/build and 20 focused tests /
359 assertions (`/private/tmp/flaregit-text-recovery-final-focused.log`).
It is preserved at `b596dd13f58b5ecc0c85464d02eab6631105ea9b`, branch
`codex/recovery-source-b596dd13f58b`. Full isolated run under session
60459 completed with exit 0: 1526 pass, 6 existing skips, zero failures/errors,
all 377 files attempted; log `/private/tmp/flaregit-b596dd-isolated-suite.log`.
The checkout remained clean at the exact snapshot. This newer snapshot
is not covered by the earlier frozen full-gate pass; hosted C02/C03 proof remains
open and no ticket is DONE.
Private-trial preparation for this exact commit is complete locally: Wrangler
dry-run with `--containers-rollout none` compiled and exited without upload;
execution remains disabled, no route/preview was enabled, and image/source vars
remain empty. Local amd64 image `flaregit-c02-b596dd-local` built as
`sha256:20ea041ee788b581b1e8f1b9d0263fa7592feff77d7de7be5479e23c3e9eaa69`.
A read-only, network-disabled local audit reported platform source false, trusted
checks false, credential-named environment variables false, React available true.
Logs: `/private/tmp/flaregit-b596-c02-dry-run.log`, image-build log and image-audit
JSON. These are local preparation/hygiene receipts, not Cloudflare boundary proof.
No registry push, Worker upload or hosted execution occurred; spending approval
remains required.
Free local execution verification subsequently rebuilt `Dockerfile.untrusted`
from the clean exact `b596dd13f58b` checkout as `flaregit-untrusted-c02-local`,
image ID `sha256:e517cc2cbf43c3cbf9fd9673582ee5826c1b00ca89fd143951b4d2e753a45640`.
The opt-in offline Docker test passed: 1 test, 10 assertions, zero failures.
It executes the actual React/TSX build, ignores a forged package build script,
binds output to the source manifest, and checks absence of platform source,
trusted checks and credential-named environment variables. Container API and
egress-policy calls are synthetic; this does not prove Cloudflare isolation.
Receipts: `/private/tmp/flaregit-c02-local-rebuild.log`,
`/private/tmp/flaregit-b596-local-docker-test.log` and
`/private/tmp/flaregit-c02-local-docker-proof.json`. No cloud spending occurred.
Independent reproducibility preparation corrected README's obsolete clone branch
to published `main`, distinguishes unpublished checkpoints, documents the complete
isolated source gate, and labels the newer boundary as inactive/unproven until C02
hosted checks. This is documentation-only preparation; no demo, submission,
deployment, billing activation, or C10 completion is claimed.

### Official competition rules/form recheck — 4 October 2026

Read-only recheck of [official rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf)
and [entry form](https://www.cloudflare.com/git-competition/submit/): Workers and
Artifacts must be used and multiple agents must work concurrently. The rules do
not state an exclusive Cloudflare-only provider requirement. Approved Clerk/
source-CI exceptions must still be described accurately. Required source license
and genuine 5–10 minute video remain unchanged; form accepts MP4/WebM/MOV up to
2 GiB. Deadline is 14 October 2026, 11:59 p.m. PDT. Eligibility, material rights,
and legal agreement remain owner confirmations. No form fields, uploads, terms
checkboxes, or submission actions were performed. Demo remains deferred by owner.

## Later release ledger — deferred scheduling, not completion

| Ticket | Status | Owner | Scheduling |
| --- | --- | --- | --- |
| F01 — repository lifecycle (R1; after C05) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F02 — Git transport, repository size and object integrity (R1; after C03) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F03 — code experience and search (R1; after C06) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F04 — pull-request and branch-policy parity (R1; after C04/C06) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F05 — issues and triage (R1; after C06) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F06 — project planning (R1; after F05) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F07 — discussions, documentation and snippets (R1; after F05) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F08 — people, discovery and notifications (R1; after F05/F07) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F09 — organizations and access (R1; after C01/C05) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F10 — CI engine and runner compatibility (R2; after C02/C08/F09) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F11 — releases, static sites and deployments (R2; after C07/F10) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F12 — packages and registries (R2; after F09/F10) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F13 — code and supply-chain security features (R2; after F09/F10/F12) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F14 — APIs, apps and ecosystem interoperability (R1 core; R2 expansion; after C08/F09) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F15 — complete migration and exit (R1; after F01–F09/C08; extend for R2 objects) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F16 — developer environments and agent interoperability (R2; after C02/F10/F14) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F17 — clients and accessibility (R3; after F03–F09/F14) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F18 — commercial and community operations (R3; after usage/authorization foundations) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F19 — operations, enterprise and service trust (R3; start relevant safeguards in C) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |
| F20 — finite parity certification and stop (R3; after all included tickets) | PARTIAL (local source slices only; no hosted proof) | unassigned | After its defined dependencies; existing partial foundations retained. |

## C00 evidence reconciliation

| Layer | Exact evidence | Current qualification |
| --- | --- | --- |
| Audited and committed source | `c564f730b5c962cf699133e4a0bb4ce7435c243f`; CI `37215340488` verification/native-boundary jobs passed | Source and CI verified, not current hosted proof. |
| Local committed-source replay | 1,274 pass, 1 platform skip, zero failures across 322 files; lint/typecheck/build passed | Existing passing gate; do not reopen without an affected diff or reproduced regression. |
| Current committed delta | `bcd29bf9a97ffc35584ce6d878f9cb88758d3ac5`: invitation return, isolated source/build/browser verification, restricted agent relay, frozen policy and cleanup guards | Local lint/typecheck/build passed; 1,427 pass / 6 opt-in skips / zero failures. Pushed to main; CI 37231011519 failed two Linux-only fixture path errors. Portable repair is in the uncommitted working tree and passes locally (see C00 reconciliation). Not deployed or hosted verified. |
| Current Worker deployment | Fresh provider inspection: deployment `9174d7b7-4aff-4145-9fb7-fe21c6c5b114`, 100% version `ac98c981-da52-4cb7-84b0-c593c899e43a`, uploaded 2026-10-04 14:26:50 UTC; saved operator record identifies source `34a1e7a2c67c006243766462deda9578735328df` | Version directly observed; source association comes from the saved release record. It differs from committed main and the uncommitted invitation-return delta. |
| Native runtime | Provider metadata checked: Integrator `a03f6b21-d265-4b78-a117-07e98cf74684` and Agent `a0388b17-59b3-4a6a-98cd-54f1fa766423`, version 55; exact image `sha256:d32bbfb56e65f0264a053ddb186c572331dc3cafad41409816cd2be71e2bfad2`; limits 3/4 | Executed core/verifier/Docker inputs unchanged from image source `1b6a3f09`. Compatibility and local UID defenses do not close C02's Cloudflare sandbox/egress gate. |
| Owned hosted Git receipts | Existing ordinary README initialization, empty-fork recovery, concurrent ticket contributions, exact human acceptance and native readback | Receipt/version reconciliation in progress; no current-source completion claim. No customer popularity or scale claim. |
| Signed receiver / migration | Owned receiver reported duplicate signed deliveries with one action; selected-branch/conversation migration evidence exists | Match receipts and deployed source under C08. No application deployment or full migration claim. |

C00 affected files: this tracker, README, submission/demo documentation and release
metadata. The owner's existing `docs/SUBMISSION.md` draft is preserved; do not
stage or overwrite it while reconciling evidence. Existing approval of Google API
policy does not approve competition terms, identity replacement, or payments.

### C00 reconciliation — October 7, 2026

- CI `37231011519` on `bcd29bf` failed two Linux-only fixtures: `tests/c02-canary-cleanup.test.ts`
  and `tests/untrusted-execution-sandbox-http.test.ts` wrote to a hardcoded macOS `/private/tmp`.
  The working tree now uses `tmpdir()` in both; both files pass locally (2 pass / 0 fail).
- `tests/workflow-lifecycle.test.ts` `preview-failure` failed on the working tree (`HEAD` passes
  12/12). Cause: the fixture had no root `index.html`, so the static-preview capability check
  rejected the candidate before the isolated build. Fix: the base commit now carries
  `index.html`; the contributor task scope (`src/feature.ts`) is unchanged and no assertion was
  weakened. Lifecycle file: 20 pass / 0 fail.
- Full local suite on the working tree: 1888 pass / 6 skip / 0 fail across 470 files. `bun run lint`,
  `bun run typecheck` and `bun run build` exit 0.
- Live `flaregit` Worker re-observed read-only: 100% version `ac98c981-da52-4cb7-84b0-c593c899e43a`
  (source `34a1e7a`, uploaded 2026-10-04 14:26:50 UTC). Committed `main` `bcd29bf` is not deployed.
- Uncommitted delta: 149 tracked files (+5,556 / −926) and 235 untracked files. `.playwright-mcp/`
  is untracked and must stay out of source commits; its contents were not inspected.
- Committed and pushed to `main` as `aa9d529` (fast-forward from `bcd29bf`), approved by the owner.
  Not deployed or published. Its CI result was pending at push time and is not yet recorded here.

### Known flake quarantine — October 7, 2026

- Test: `tests/verification-closure-http.test.ts` ("signed owner exact verification recovery …").
- Symptom: `TypeError: The socket connection was closed unexpectedly … code: "ECONNRESET"` on Miniflare's
  internal platform-proxy request, after four earlier assertions pass. The app returns the correct 400 before the reset.
- Runtime: Bun 1.4.2 (the version CI installs). Bun 1.4.2 is the latest release; no downgrade is permitted.
- Reproduction: intermittent in isolation and in the full suite (CI attempts 1–3 on `18155a8` failed the same test).
  Not caused by product code: a minimal body-reading Worker passed 40 alternating requests; undici 8.11.2 and
  Miniflare 5.20261006.0-alpha did not fix it; consuming response bodies did not fix it.
- Quarantine: the blocking `verify` job skips this one test on Bun 1.4.2 only (`knownFlakeQuarantined`).
  The `known-flake-quarantine` job runs it with `FLAREGIT_KNOWN_FLAKE_RUN=1` and is `continue-on-error`, so the
  result stays visible without blocking merges or deploys. Every assertion is unchanged.
- Reinstatement: remove the quarantine gate and the quarantine job once a Bun or Miniflare release passes
  the job reliably. Draft upstream report: `scratchpad/bun-issue-draft.md` (not yet filed).

### Production deploy — `f67dfb1` (October 7–8, 2026)

- Source: `f67dfb17ff03dfacb7f84716678f30ab42a615c4` (commits `bcd0fee` quarantine and `f67dfb1` web-build fix on top of `18155a8`).
- CI on `f67dfb1` (run `37709137161`): `verify` success, `native-boundary` success, `known-flake-quarantine` success.
- Deployed with `wrangler deploy --var FLAREGIT_SOURCE_VERSION:f67dfb1…`. Live `flaregit` version `aaf1354e-89a6-4d84-bbf8-b7d3584bc81b` at 100%.
- Smoke: `https://flaregit.com/` 200; `/privacy.html` and `/terms.html` 307 (redirect, not a failure).
- Not claimed: C02, C03, C05–C11 and F01–F20 remain open. This deploy is not hosted proof for those tickets.

### C01 owner decision

Approved in this chat: retain Clerk for customer identity, keep Polar checkout
disabled, use GitHub for source/developer CI, and allow optional GitHub mirroring
only after explicit repository export consent. Workers and Artifacts remain the
core runtime. This grants no increased spending, provider migration, payment
activation, public release, or automatic export.

Scoped endpoint inventory: Clerk issuer/JWKS serves identity; Workers AI and
Cloudflare AI Gateway serve model execution; Cloudflare DNS serves domain checks.
Polar endpoints serve disabled checkout/billing management. GitHub serves source,
developer CI, and optional migration/mirroring. Customer-selected webhooks/check
receivers are optional integrations. Preview CSP permits Google font endpoints;
C02 must account for them in the immutable-output/network policy. No TypeSafe/Jev
production endpoint was found in the scoped runtime inventory; development tools
are not customer runtime dependencies. Full C01 journey acceptance remains open.
Frozen `b596dd13f58b` passed 41 focused local permission/session tests / 128
assertions across nine files. A subsequently added combined Worker test forces
billing RPC failure while authorized private reads and owner review succeed;
anonymous/outsider reads and member approval remain denied. Its focused test,
lint and typecheck passed before the preview migration began. Files:
`tests/billing-outage-permissions-http.test.ts` and its unique support Worker.
Local JWKS and synthetic Git provider ports do not establish hosted Clerk login.

### C00 receipt qualification

| Saved receipt | Version binding | What it proves |
| --- | --- | --- |
| `flaregit-hosted-empty-creation-proof.json` | Creation source `1b6a3f09`, Worker `09389824-fcfb-411b-9460-ec9ca76e1d1e`; recovery source `34a1e7a`, Worker `ac98c981-da52-4cb7-84b0-c593c899e43a` | Original provider fork/task survives reload; no accepted commit or credential disclosure. |
| `flaregit-hosted-readme-b057d6c.json` | Source `b057d6c0`, Worker `12f3d451-02fd-408d-a80b-676a4999f868` | Owned initialization contains exact README root `b0dac1058bae75239708358812742ea5b3201069`; not a contribution merge/deployment. |
| `flaregit-hosted-human-workspace-9d3480b.json` | Source `9d3480be`, Worker `c9dfdc9c-aede-47a2-9ad4-fb7911523154` | Human-tool workspace purpose persists; no agent or accepted-history change. |
| `flaregit-canary-accepted-native-receipt.json` | Worker version not recorded in this receipt | Fresh owned native clone/fsck matches accepted `868aba34103e1f7a425807835c93906f427b3c37`; Git-state evidence only, not current-release or application-deployment proof. |

These operator-private receipts reside under `/private/tmp/`; they must be copied
into the approved C10 evidence package with secrets excluded before relying on
them as durable submission artifacts. Unversioned reports are not counted as
HOSTED_VERIFIED for the current candidate.

### C02 local implementation evidence

The progress entries below preserve chronological receipts. Statements about
then-unwired modules refer to their recorded checkpoint, not current main.
Current `bcd29bf` contains source/controller/workflow wiring; post-push recovery,
exact approved-requirement mapping and portable CI repairs are a newer local
delta undergoing a combined gate. No entry establishes current hosted C02 proof.

Owned files: `src/server/execution-egress.ts`, `static-build-artifact.ts`, and their
focused tests. Nine local tests / 49 assertions, lint, typecheck and build pass. The
handler defaults to deny, permits only exact Git service queries, and rechecks
authority after credential callbacks before forwarding. Worker callbacks alone
add credentials; manifests reject zero Git identities and bind
bounded bytes to attempt/project/incarnation/commit/tree/policy/source digest.
These modules are not wired. They do not prove Cloudflare TCP/egress isolation,
build provenance, browser verification, or publisher separation. Supported
Container interception with Internet disabled, separate jobs, trusted browser
case receipts, cleanup and actual Cloudflare canaries remain required.

### C02 separate execution progress

`untrusted-execution.ts` now has mandatory authorization, immutable preparation,
one-shot dispatch, Internet-disabled startup, HTTP/HTTPS deny interception, fixed
offline builds, bounded bytes/time, and sealed cleanup. Local tests use synthetic
Container APIs; actual workerd verifies durable state but is not a Cloudflare VM
isolation proof. Output remains explicitly non-acceptance evidence.

`Dockerfile.untrusted` was built locally as `flaregit-untrusted-c02-local` for
linux/amd64. It contains Bun 1.3.4 and frozen production dependencies, not platform
source, protected checks or publisher code. A network-disabled, read-only local
container confirmed Bun and React dependencies and absence of platform source.
No image was uploaded and no hosted resource was changed. The actual local
offline React build passed: one Docker test / 10 assertions. Its first failure
was missing interactive stdin in the synthetic Docker adapter; one targeted
repair preserved all assertions. Receipt: `/private/tmp/flaregit-c02-local-docker-proof.json`,
explicitly `cloudflareVerified:false` and `acceptanceEvidence:false`, with source
and output digests and image hygiene checks. The combined local runtime,
manifest, egress and workerd slice passes 15 tests / 93 assertions.

The marked isolated-browser workflow now connects durable source capture,
one-shot builds, external verification and publication receipt checks in source.
Actual Cloudflare isolation/egress canaries and approved hosted resource use
remain open. Local Docker evidence does not close these gates.

### C02 trusted verification progress

`external-browser-verifier.ts` independently binds the trusted case inventory,
rechecks source/output manifests, serves immutable same-origin bytes, compares
primitive browser observations in the Worker, and requires exact positive lease
cleanup. Ten synthetic transport tests / 54 assertions pass, including tampering,
forged page success, denied traffic, withdrawal and pending-allocation cleanup.
These are not actual-browser or hosted receipts.

The official Cloudflare Puppeteer SDK is pinned as a development/build dependency
(`@cloudflare/puppeteer` 1.4.0). No Browser Run binding or session was created.
The real transport adapter, actual isolation/interception canaries, trusted
publisher integration and resource authorization remain open.

### C02 concrete adapter progress

`cloudflare-browser-transport.ts` uses the pinned Cloudflare SDK, fresh browser
contexts, pre-navigation interception, isolated CDP observations, restricted
permissions/downloads/workers/WebSockets, and bounded cleanup. A rejected launch
with no returned browser remains unconfirmed because a provider session may have
been acquired. Twenty synthetic verifier/adapter tests / 93 assertions pass.
No Browser Run session was created. The production adapter now captures the
exact session ID through SDK acquire before connect and requires native
closeSession/getSession confirmation; SDK disconnect alone cannot prove cleanup.
HTTP/HTTPS guardrails allow only the lease's exact virtual hostname. Root verified
25 synthetic tests / 112 assertions and clean lint/typecheck for this change;
additional pending native-cleanup cases remain in the owner's focused gate.
Opaque acquisition without an ID stays unconfirmed. No account-wide session
inventory or cleanup is performed.

The combined root-run C02 slice passed 53 tests / 255 assertions across nine
files. Raw Git source capture separately passed three real local Git cases:
binary bytes, dirty-checkout independence, object substitution, revocation and
symlink refusal. Its native reader now has a scoped command permit, fixed Git
object arguments, a credential-free child environment, replacement-object
disablement and a byte cap. Source capture is not yet wired into the production
verification workflow. Browser fixture inventories and publisher receipt
binding remain under implementation; coverage gaps must close before release.

The exact platform Git-object reader passed a real local Docker proof using the
existing verifier image, a read-only repository mount and disabled networking:
binary bytes, commit/tree reads, ignored replacement refs, byte bounds and
filter refusal (one test / seven assertions). Receipt:
`/private/tmp/flaregit-c02-local-git-object-proof.json`, explicitly
`cloudflareVerified:false`. The isolated-build orchestrator and raw source
collector root gate passed 11 tests / 140 assertions, including forbidden dotenv
reads, gitlinks, hanging reads and lost prepare/run acknowledgements. It bounds
work and cleanup separately, consumes one durable dispatch, and returns builds
with `acceptanceEvidence:false`. These modules remain unwired to public traffic.

The separate durable browser-receipt module now invokes the external verifier
itself, validates the independently required inventory and immutable byte
identities, and rechecks authority before storage and on reads. It does not
accept a caller's success receipt or change candidate/history status. Root's
combined receipt/verifier/adapter gate passed 35 tests / 154 assertions with a
synthetic browser adapter. Controller/publisher wiring is now source-tested;
production configuration, deployment and hosted verification remain open.

Controller integration now requires the exact sandbox's durable completed-output
receipt before storing build identities, plus fresh candidate authority and
recomputed byte hashes. Missing bindings and changed manifests/scopes fail closed.
The Global browser admission RPCs now use the same spending ledger, an explicit
operator envelope and native exact-session cleanup; their configuration remains
unset and public traffic unchanged. A scoped root gate passed nine tests / 37
assertions, including actual workerd refusal/recovery and bounded receipt reads.
Current fixture inventories cover their approved requirements; DOM/template
build and receipt tests passed 12 tests / 73 assertions. Actual local Chromium
coverage and Global browser admission HTTP tests have passed locally. The
retained opt-in Chromium tests checked seven isolation assertions and nine
actual template cases / 29 assertions with confirmed cleanup. This is local
browser evidence, not Cloudflare proof.

The frozen-policy publication gate now requires the stored browser receipt and
its exact output digest; write readback recovery remains independent. Root's
publication/policy/browser-budget gate passed 27 tests / 190 assertions, and the
extended native publication/recovery gate passed five tests / 37 assertions.
Durable build-attempt IDs prevent an interruption from silently creating another
job. Source-tested agent Git egress restricts transfers to one assigned fork and
branch CAS, with Worker-owned credentials; sandbox/CA/workflow wiring and actual
agent network canaries remain open. Legacy application execution and requirement
coverage outside the supported trusted inventories still need reconciliation;
this is not a claim that the deployed app is isolated or feature-complete.

The source-to-browser vertical slice is now invoked by the marked integration
workflow, with canonical RPC identities, real committed-object capture, durable
source binding, one-shot funding/dispatch, independently checked browser output,
and static stage failures. Durable evidence copies use the same output digest as
the controller and publication journal. Root's affected slice passed 31 tests /
230 assertions; lint, typecheck and build passed. Git, SQLite and workerd are real
in the local checks; execution/browser ports in that slice remain synthetic.
The actual retained local Chromium proof is recorded separately above.

A dedicated inactive canary Worker/configuration now compiles and dry-runs
offline. It has no public routes, no operator secret, execution disabled, and
one-container/one-browser limits. Its first fixed build/DOM-forgery stage uses a
143,008-microdollar admission reservation, explicitly not an invoice ceiling.
Native HTTP/HTTPS/raw-socket/redirect/credential canaries remain required beyond
that stage. No canary deployment, image upload or hosted session has occurred.

Local source checkpoint: `0c37f864236461b111cd8ffc9dab475aa5ab326f`, branch
`codex/c02-source-0c37f8642364`; main remains `c564f730`. Its lint, typecheck and
build pass. The full suite ended with 1,407 pass / 6 skip / 4 fail. Failures were
concurrent in-process fixture builds (EBADF), two recovery fixtures built for
Node rather than Workers (createRequire startup), and a preview fixture sharing
two Miniflare instances in one child process (timeout). Focused repairs preserve
assertions/deadlines and now pass. The failed log is preserved at
`/private/tmp/flaregit-c02-0c37f864-tests.log`. No hosted action may proceed on
the strength of an unfinished or failed gate.

Corrected local checkpoint: `55b36c02f98ce33e964b9847f94a4b92f090990c`, branch
`codex/c02-source-55b36c02f98c`. Its complete isolated-clone gate passed
1,417 tests / 6 intentional skips / 0 failures (16,000 assertions), plus lint,
typecheck and build. Clone: `/private/tmp/flaregit-c02-55b36c02-gate`; log
`/private/tmp/flaregit-c02-55b36c02-tests.log`. The browser SDK now loads only when
browser acquisition/connection is requested, preserving ordinary Git/recovery
startup independently. This checkpoint remains local and undeployed.
New restricted-agent RPC/startup work is outside that frozen checkpoint and must
pass its own checks before inclusion. Hosted canary approval remains pending;
the earlier failed checkpoint is not eligible for deployment.

Follow-up source work after `bcd29bf` (uncommitted): Linux CI exposed two
fixture paths hard-coded to macOS `/private/tmp`; both now use the owned child
OS temp directory and pass the same focused workerd assertions. Interrupted
agent startup now has cleanup coverage. Browser policy coverage now receives
approved frozen requirement IDs before execution: exact approved pricing cases
are mapped, internal integer-cent representation is unsupported, and receipt DOM
rows remain partial evidence for the calculation API. The affected policy/helper
suite passes 9 tests / 111 assertions. Own-push acknowledgement now has exact request/commit native readback and
permission/reuse negatives in focused workerd fixtures. The coherent full-suite
gate passed 1,430 tests / 6 intentional opt-in skips / zero failures across 355
files (16,052 assertions), plus lint/typecheck/build; log
`/private/tmp/flaregit-c02-followup-full-tests.log`. No hosted or release completion
claim is made.

The new agent path now connects Workflow selection, scoped loopback egress,
controller authorization/funding, server-only credential issuance, and sandbox
configuration. READY requires installed HTTP/HTTPS interception, disabled
Internet, pinned image inspection and valid unexpired X.509 CA validation;
running VMs cannot bypass the command guard. Cleanup uses original ownership
after operator settings or membership change. Root's affected agent/controller/
authority/sandbox gate passed 43 tests / 233 assertions; lint and typecheck pass.
Container/Root transport ports in the sandbox fixture are synthetic. Actual
Cloudflare TLS, raw-network denial and genuine concurrent-agent journeys remain
required before C02 can close. The updated local agent image includes OpenSSL;
its offline hygiene receipt remains explicitly unuploaded and non-hosted.

The restricted agent execution seam passed all 35 agent tests (including saved
proposal and lost-push recovery); Root's combined agent/canary/CBA gate passed
42 tests / 233 assertions. Canary cleanup separately passed a qualified
provider-fake workerd test. The local minimal agent image is non-root and contains
Bun, Git, public CAs and frozen dependencies without platform source or secrets;
its receipt is `/private/tmp/flaregit-c02-local-agent-hygiene.json`, explicitly
not uploaded or Cloudflare-verified. Actual restricted agent RPC/CA/relay wiring
and all hosted gates remain open.

`untrusted-execution-sandbox.ts` provides the separate Durable Object bridge but
is not exported or configured in production. It requires namespace identity,
immutable source/image context and a bounded, exact-digest receipt from a trusted
authority/budget service. Authority responses are limited to 1 KiB with a 10-second
stream/fetch deadline. Actual workerd preparation/refusal tests use synthetic
authority and no container binding; combined bridge/browser checks pass 21 tests
/ 94 assertions. Configuration, publication receipt binding and actual
Cloudflare canaries remain open.

The private execution authority now uses the repository controller's current
owner, account, candidate, accepted base, policy, task checkpoints and operator
configuration, with a second account check after asynchronous hashing. Funding
comes from the actual Global ledger; caller assertions cannot authorize a job.
The affected controller/authority, grant and workerd bridge gate passes 10 tests
/ 36 assertions; lint and typecheck pass. Git identity in the controller fixture
is explicitly synthetic. The authority is not exported or configured in
production; trusted source-byte production and hosted execution remain open.

The controller also exposes atomic dispatch claim and exact-context sealing.
Sealing remains available after authority withdrawal so cleanup cannot depend on
continued permission to execute. Duplicate dispatch is denied by the durable
grant ledger. These RPCs are not wired to a production workflow yet.

The next hosted gate must use a separately approved private canary Worker,
dedicated execution container and exact Browser Run sessions, without changing
the public application's traffic. Freeze and identify the source and image
digests first. Test denied external HTTP/HTTPS, redirects, alternate ports and
raw sockets, credential absence, forged output/check results, authority
withdrawal, interruption, duplicate dispatch and exact-session cleanup. Record
the provider versions, native receipts, byte digests and actual spending; never
promote local adapter results into hosted proof. Resource configuration and a
bounded spending proposal must be reviewable before requesting owner approval.

## 1. Product and fixed boundaries

**FlareGit: Work in parallel. Integration happens automatically.**

People and coding agents contribute through ordinary Git. The platform preserves their goals and changes, combines compatible work, repairs textual and behavioral/interface conflicts, verifies an exact candidate, and publishes according to an explicit repository acceptance policy. Contradictory requirements produce one understandable product decision. Uncertainty preserves the accepted application rather than silently discarding a requirement.

Keep a real forge: repositories, code navigation, changes/pull requests, conversations, issues, people, reviews, automation, and the wider feature inventory below. Do not turn it into an agent transcript dashboard. Agents are contributors, not a substitute for the social and review functions of a forge.

Cloudflare is the intended hosted infrastructure. Workers and Artifacts remain fundamental. Keep useful neutral open-source libraries. Do not rewrite the functioning Bun build setup into Vite, change Tailwind versions, replace the state architecture, or redesign working screens simply to match an earlier suggestion.

Do not introduce a competing hosted service without explicit owner approval. Existing exceptions need a recorded decision; they are not automatically approved because they are already in the code. Never replace a managed identity service with improvised password handling to satisfy a branding requirement.

No hidden production test data, fake progress, fabricated agents, unsupported guarantees, silent feature removal, weakened acceptance checks, or blind force pushes. No publishing, billing activation, purchases, legal acceptance, or automated competition entry without the appropriate owner action.

## 2. What the audit actually found

All source references below use the reviewed SHA. Prefix a path with `https://github.com/Joe-Simo/flaregit/blob/c564f730b5c962cf699133e4a0bb4ce7435c243f/` to inspect it.

| Finding | Evidence and consequence |
|---|---|
| A roadmap already exists, but is a broad completion checklist. | `docs/ROADMAP.md` mixes reliability, collaboration, integrations, billing, and entry work. Convert it to the bounded tickets below rather than asking the agent to keep finding work. |
| Latest CI is green; an older failure summary remains in documentation. | The reviewed CI run succeeded. `docs/ROADMAP.md` still records an earlier three-failure checkpoint. Reconcile status once; do not repeatedly fix obsolete failures. |
| Source, deployment, and hosted evidence are not aligned. | `docs/SUBMISSION.md` pins an older SHA; `README.md` references a branch/PR already merged. PR #2 reports later hosted exercises but is an implementation report, not independently replayed evidence. |
| Core Git and durable integration are substantial implementations. | `src/server/workflow.ts`, `git-gateway-handler.ts`, `git-http-gateway.ts`, `durable-object.ts`, and `docs/ARCHITECTURE.md` implement composition, candidate refs, evidence checks, review, journaled publication, and recovery. Preserve this work. |
| Every verified candidate currently waits for a human. | `src/server/workflow.ts` unconditionally calls `awaitReview` and waits for a review event. Automatic composition is not the same as policy-authorized automatic landing. Add an explicit safe mode; do not remove review support. |
| Verification needs a provider-specific trust-boundary correction. | `src/core/verification/execution.ts` uses a separate UID and `setpriv --no-new-privs`; `docs/ARCHITECTURE.md` says candidate code and behavioral checks share a child process. Docker canaries do not establish the Cloudflare deployment boundary. No exploit was attempted in this audit. |
| Open sandbox egress is actual code, not merely a hypothetical risk. | `src/server/integrator.ts` starts containers with `enableInternet: true`; agent sandboxes inherit that implementation. Credential/network containment must be resolved before broader untrusted execution. |
| Tags/releases are partial, not a finished feature. | `release-records.ts` has a metadata ledger; `TagsReleasesPanel.tsx` has UI; searches found their declarations/tests rather than application wiring. Existing roadmap explicitly lists API/DTO/navigation/hosted gaps. Trace and close the entire path. |
| Search is currently metadata search. | `src/server/metadata-search.ts` explicitly excludes Git contents and scans a bounded set of repositories. Do not call this code-search parity. |
| Migration coverage is incomplete. | README describes selected-branch ancestry inspection. `git-migration-inventory.ts` excludes LFS bytes and submodule repositories. A successful import does not establish complete project migration. |
| Customer authentication is not Cloudflare-only. | `package.json`, `wrangler.jsonc`, `access.ts`, and `worker.ts` use Clerk. Polar billing also exists, with paid checkout disabled. The Clerk publishable key is public by design, not a secret-leak finding. |
| New-repository preview setup is an onboarding gap. | `wrangler.jsonc` contains two repository preview origins; architecture documentation requires operator provisioning. A new user's repository must not silently need an undocumented operator edit. |
| Hosted results are unevenly documented. | PR #2 reports owned live concurrent work, repair, acceptance, and readback; submission documentation still lists some as pending. Reconcile against saved receipts and the actual deployed SHA before concluding success or failure. |
| There is significant feature breadth, but not demonstrated total parity. | README and server source contain repository browsing, changes, issues/comments, membership/invites, profiles, notifications, webhooks, external-check callbacks, recovery, and status functionality. Each still needs a user-journey acceptance record. |

PR evidence: `https://github.com/Joe-Simo/flaregit/pull/2`.

### Provider facts that constrain implementation

Cloudflare documents the sandbox—not a Linux UID—as the trust boundary, and recommends keeping credentials outside it and controlling outbound access. Do not treat local Unix permission checks as a substitute. Use separate jobs for untrusted execution and trusted evaluation, with a trusted publisher outside both. Source: `https://developers.cloudflare.com/sandbox/concepts/security/`.

Artifacts documents smart-HTTP Git, a 1 GB repository limit, and a 32 MB blob limit. SSH and larger-repository parity require a separate proven plan; standard HTTP support does not prove them. Sources: `https://developers.cloudflare.com/artifacts/api/git-protocol/` and `https://developers.cloudflare.com/artifacts/platform/limits/`.

## 3. Theo evidence: use the actual video, not an invented exclusion list

Reviewed the original page and accessible caption transcript for video `R7ex-Gt8dtw`; not independently audio-verified word for word. He values community and free private repositories, and criticizes unreliable operations, disappearing accepted work, poor navigation, security failures, and unaccountable responses. This video establishes no blanket feature-category removal list. The later migration letter is another author's text being read aloud; the CI endorsement is a sponsor segment.

Original: `https://www.youtube.com/watch?v=R7ex-Gt8dtw`.
Caption source: `https://rosetta.to/u/t3dotgg/i-give-up`.

Product decisions in this plan are our recommendations, not claims that Theo personally requested their precise implementation. Do not market an endorsement. Any future Theo-based exclusion must record the exact source passage, speaker, timestamp, and owner approval. In the meantime, keep all feature families in the parity register.

## 4. Releases and the definition of completion

### C — competition release

Close C00–C11. This release proves a coherent real forge workflow plus genuine concurrent agents, protected behavioral verification, honest conflict handling, and evidence-backed publication. It is not called full GitHub parity.

### R1 — everyday collaboration replacement

Close F01–F09, F14–F15, and applicable operations gates, in addition to C. This covers the day-to-day repository, review, issue, planning, community, access, and migration experience. Any missing SSH/LFS/large-repository support remains an explicit blocker to the corresponding parity claim.

### R2 — automation and software-delivery replacement

Close F10–F13 and F16. Cover executable CI, releases/deployments, packages, security workflows, and development/agent environments. A command runner is not automatically compatible with the Actions ecosystem.

### R3 — wider ecosystem and full declared parity

Close F17–F20 and any remaining rows, including client experiences, commercial/community operations, enterprise requirements, and all compatibility exceptions. Only then use a full-parity claim for the frozen catalog. Do not imply identical proprietary implementation, certification, API compatibility, capacity, or support contracts without proof.

The catalog is frozen to this roadmap's feature families and the linked official GitHub documentation as reviewed on 4 October 2026. A newly released GitHub feature does not automatically expand the current release. During C00, resolve any genuine omissions once and assign an explicit ticket. Afterwards, scope changes require owner approval; no perpetual rediscovery backlog.

### Status and evidence vocabulary

Use `NOT_STARTED`, `IMPLEMENTED`, `LOCAL_VERIFIED`, `HOSTED_VERIFIED`, `DONE`, and `BLOCKED`. Record deferred scheduling separately; deferred never means done.

Every ticket records: ID, release, dependencies, one responsible owner, exact source SHA, affected files, implementation status, acceptance scenarios, commands/results, deployed version where relevant, evidence location, and the next concrete action.

A ticket is DONE when its specified user journey works through the real UI/API/native tool path, data survives reload/restart, permissions and negative cases pass, and evidence matches the candidate release. Pure internal library tickets may close with local evidence, but their associated product feature remains open until the integration journey passes.

A checkbox in documentation, file existence, a mocked API response, a model's self-report, and a screen render are not product completion evidence.

## 5. Full feature register — nothing silently excluded

`P` means a starting implementation or partial coverage was found. `U` means not established in this audit, not proof that no line of code exists. `B` identifies a compatibility/permission decision. None of these labels means DONE.

| ID | Capability family retained in scope | Starting status | Finishing ticket |
|---|---|---|---|
| G01 | Public/private repositories, create/import, fork/template, archive/restore, rename/transfer/delete | P | F01 |
| G02 | Standard Git, branches/tags, SSH, LFS, submodules, signatures and integrity | P/B | F02 |
| G03 | File tree, rendered/raw content, history, blame, compare, line links, browser editing/uploads | P | F03 |
| G04 | Code, repository, issue, PR, and people search with permissions and filters | P; metadata search exists | F03 |
| G05 | Pull requests/changes, draft state, inline threads, suggestions, requested reviews, CODEOWNERS, stacks | P | F04 |
| G06 | Branch rules, required checks/reviews, merge methods, queues, optional auto-accept, revert | P | C04/F04 |
| G07 | Issues, labels, assignees, milestones, templates/forms, relationships/subissues, bulk triage | P | F05 |
| G08 | Projects: board/table/timeline, fields, views, automation, progress/insights | U | F06 |
| G09 | Discussions, categories, answers, polls, moderation, conversion to issues | U | F07 |
| G10 | Wikis and shareable versioned snippets | U | F07 |
| G11 | Profiles, people, contributions, follows, stars/watch, topics and discovery | P | F08 |
| G12 | Notifications, mentions, subscriptions, preferences, email delivery | P | F08 |
| G13 | Organizations, teams, roles, outside collaborators, invitations and ownership | P for repo membership; wider org model U | F09 |
| G14 | Account security/recovery, keys/tokens, application authorization, audit, enterprise identity | P/B | C01/F09/F19 |
| G15 | CI workflow execution, jobs, matrices, conditions, reuse, logs, caches/artifacts, secrets, cancellation | P for command execution and external checks; broad engine U | F10 |
| G16 | Linux/macOS/Windows and self-hosted runner compatibility | B | F10 |
| G17 | Tags/releases, attachments, immutable versions, generated notes, provenance | P; not fully wired | C07/F11 |
| G18 | Static sites, custom domains, deployment environments, approvals, exact-version delivery | P | C05/F11 |
| G19 | Public/private package and OCI registries with real client interoperability | U | F12 |
| G20 | Secret/code/dependency scanning, advisories, update proposals, SBOM/provenance | U for equivalent user workflows | F13 |
| G21 | Stable REST/GraphQL surface, apps/OAuth, webhooks/checks, marketplace-style discovery | P for APIs/webhooks/check callbacks | C08/F14 |
| G22 | Full repository/project import/export, histories, discussions/reviews/assets, backup/restore | P | C08/F15 |
| G23 | Cloud development workspaces, editor attachment, scoped AI assistance, external-agent interoperability | P for managed agents/ordinary Git; broader workspace U | F16 |
| G24 | CLI, desktop, mobile/tablet experiences and accessibility | P for CLI/web; native clients U | F17 |
| G25 | Usage/billing, sponsorship/community programs, education/nonprofit/support operations | P for disabled billing; broader operations U/B | F18 |
| G26 | Reliability, honest status, abuse response, security response, enterprise governance/self-hosting | P/U/B | C02/C09/F19 |

Primary feature inventory sources: `https://docs.github.com/en`, `https://github.com/features`, and the domain-specific documentation cited in F01–F19. This is a capability register, not an assertion that every current GitHub endpoint has been enumerated or that equivalent code already exists.

## 6. Competition-critical tickets — execute in this order

Timeboxes are planning limits, not evidence that an item is easy. When a ticket exceeds its limit, split around a specific remaining acceptance case or mark an external dependency. Do not silently enlarge the ticket.

### C00 — freeze the current truth

**Dependencies:** none. **Budget:** half a day. **Starting files:** `docs/ROADMAP.md`, `README.md`, `docs/SUBMISSION.md`, `docs/DEMO.md`, `package.json`, `.github/workflows/ci.yml`.

Reconcile source, merged branches, CI, deployed Worker, image digest, and saved hosted receipts. Preserve valid completed work. Assign the above feature families and remaining current-batch tasks to IDs. State clearly which gates are source-only, locally checked, hosted-reported, or directly reproducible.

**Pass:** one execution tracker names the active ticket and next ticket; obsolete README branch instructions and stale failure summaries no longer mislead; every claimed hosted result has a version and receipt. Do not spend a day reformatting all documentation.

### C01 — settle identity and infrastructure exceptions

**Dependencies:** C00. **Budget:** half a day for decision and test plan, implementation separately bounded. **Starting files:** `access.ts`, `worker.ts`, `wrangler.jsonc`, `package.json`, Polar integration.

Inventory Clerk, Polar, GitHub Actions, GitHub mirroring, and all external endpoints by purpose: production runtime, optional customer integration, source distribution, or developer CI. Ask once for any required exception. No exception is inferred from pre-existing code.

Keep payments disabled for the competition. For authentication, either obtain an explicit scoped exception or implement a supported Cloudflare-compatible identity plan with tested account recovery and permissions. Do not assume Access is a drop-in consumer account system or implement ad hoc passwords. Migrate existing account IDs/ownership deliberately if identity changes. Do not use an identity migration to delete user data.

**Pass:** the deployed architecture and its public description match approved reality; fresh login, logout, session expiry, member removal, and denied access pass. A billing provider failure cannot prevent repository reads or reviews. Unresolved approval is BLOCKED, not a fake Cloudflare-only claim.

### C02 local source gate — October 8, 2026 (source-tested only)

- HEAD `c1390b9`: `bun run lint` and `bun run typecheck` exit 0.
- All 24 `tests/c02-*.test.ts` and `tests/untrusted-execution*.test.ts` files run one at a time: 84 pass, 0 fail,
  with `FLAREGIT_UNTRUSTED_LOCAL_PROOF_IMAGE=flaregit-untrusted-c02-local` (the local `linux/amd64` image built from
  `Dockerfile.untrusted` on this commit, 104,598,007 bytes).
- Status: source-tested and local-image-tested only. No hosted Cloudflare receipt, no synthetic canary run, and no
  cloud allocation was produced. C02's hosted pass criteria remain open and need an approved spend ceiling.

### C11 official rules recheck — October 8, 2026 (no entry, no terms accepted)

- Official Rules PDF (local copy, read directly): contest period Oct 1, 2026 9:00 AM EDT to Oct 14, 2026 11:59 PM PDT.
- Eligibility: legal resident of the US or Canada, 18+, not on sanctions lists and not a Sponsor employee or family member.
- Entry: a 5–10 minute demo video, the source repository, run instructions, and acceptance of the Official Rules.
- Submission criteria: must use Cloudflare's developer platform including Workers and Artifacts, with multiple agents
  working on changes concurrently; source licensed under MIT, Apache 2.0, or BSD 2/3-clause, with a LICENSE file.
- Finalists (three) present live at Cloudflare Connect (San Francisco, Oct 21, 2026); winners must attend in person.
  Travel and hotel for finalists may be sponsor-provided, but finalists pay some expenses. This is a spending
  consideration; do not commit to it without the owner's decision.
- The rules grant Cloudflare broad rights to the demo video and presentation materials, and require access to the
  complete source code to administer judging. The owner must review this before accepting.
- Entry form (per Cloudflare's submit page): team and attendee details, project name, vision, Cloudflare use,
  demo video (MP4/WebM/MOV, up to 2 GiB), open-source repository URL, run instructions, and two confirmation boxes.
- Owner-only: the entry form and the terms acceptance. No entry was submitted and no terms were accepted.

### C10 local reproducibility — October 8, 2026 (source-tested only)

- Clean clone of `17d7550` (reset from `origin/main` into a scratch checkout, no local edits) inside
  `oven/bun:1.4.2` Linux (`git` 2.47.3, `util-linux`, `procps`), running as the non-root `bun` user.
- `bun run lint` and `bun run typecheck` exit 0; `bun run build` exit 0.
- `bun test`: 1887 pass, 7 skip (6 existing platform skips plus the Bun 1.4.2 quarantine), 0 fail, 470 files.
- Status: local reproducibility only. Hosted C09 batch, C10 evidence package, and C11 owner submission remain open.

### C03 local source gate — October 8, 2026 (source-tested only)

- All 9 `tests/c03-*.test.ts` files run one at a time on local Bun 1.3.4: 32 pass, 0 fail.
- Status: source-tested only. The hosted publication matrix (stale base, interrupts, competing publishers, cancel)
  remains open and needs an approved spend ceiling.

### C02 — replace assumed sandbox trust with demonstrated boundaries

**Dependencies:** C00. **Budget:** two days; highest technical priority. **Starting files:** `integrator.ts`, `src/core/verification/execution.ts`, `workflow.ts`, build/verification modules, Dockerfile, Wrangler configuration.

Separate untrusted source execution from the trusted acceptance harness and publisher. Keep credential use behind narrowly authorized Worker operations. Disable general outbound Internet; permit only necessary operations, methods, paths, and destinations through the supported mechanism. Package acquisition is a distinct constrained phase, not permanent arbitrary egress.

For the competition adapter, build an immutable static output and test it through a trusted external browser harness. Do not import candidate modules or run candidate-selected verifier scripts in the trusted host. Existing repository tests remain supplementary unless admitted through the trusted policy. Preserve valid UID/no-new-privs defense in depth where useful; it is not the trust boundary.

**Pass:** actual Cloudflare jobs with synthetic canaries demonstrate no cross-task/private-supervisor access, no acceptance-harness tampering, no credential disclosure, denied non-allowlisted egress, bounded execution, and verified cleanup. The expected check inventory comes from trusted policy; a fabricated stdout success cannot publish. Do not probe other users' repositories.

### C03 — prove exact publication and recovery on the deployed snapshot

**Dependencies:** C02. **Budget:** one day. **Starting files:** `workflow.ts`, `durable-object.ts`, target bindings, native-runtime ledger and Git-pin modules.

Keep the existing PREPARED/publication/readback protocol. Close specific remaining failures; do not rewrite it. Verify current accepted target, source heads, candidate SHA/tree, requirement/policy versions, verified build digest, and publication authorization. No post-verification rebase/amend/squash/rebuild may reuse evidence. A different merge method must produce and verify its own exact output.

**Pass:** race two publishers; advance the base during verification; supersede a task; change policy; deliver duplicate/late callbacks; interrupt before and after the ref update; cancel an attempt. Each case either lands the exact authorized result once or preserves an explicit unresolved state. A fresh clone matches the accepted SHA. Accepted history remains present if mirror, preview, notifications, or model provider fails.

### C04 — restore the automatic-integration promise without removing reviews

**Dependencies:** C02, C03. **Budget:** one day. **Starting files:** `workflow.ts`, review/policy ledgers, task requirements and decision UI.

Add an explicit repository policy with `review-required` and `verified-auto-accept` modes. Keep review-required for ordinary uncontrolled imports. Auto-accept is available only for the supported protected adapter and approved requirements. Persist who authorized the policy and its version. Never bypass a required review by reclassifying a bot callback.

Run both original feature requirements plus combined interaction checks. Contradictory inputs retain the previous accepted version and produce one specific behavioral question. The answer versions the requirement; repair and verification follow. Fixing uncertainty is not permission to weaken tests.

**Pass:** compatible work lands without a per-candidate approval in the opted-in mode; the same work waits in review-required mode; contradictory requirements cannot auto-land; changing the mode invalidates affected pending authority. Existing legitimate human review and audit history still work.

### C05 — close the ordinary developer's first project journey

**Dependencies:** C01, C03. **Budget:** one day. **Starting areas:** creation/import, Git gateway, membership, preview registry/broker, repository UI.

Use two real authorized test accounts. Create an empty private repo and a README-initialized repo; import a small compatible public repo; create a human workspace; clone, commit, push, fetch accepted work, and reload. Invite a second user, accept once and retry, remove the user, and verify denial with an old session/token.

Provision preview origins through one bounded, authorized onboarding operation with visible progress/failure, or a documented pre-provisioned pool allocated exclusively and never recycled across tenants. Do not share app credentials or allow a contributor to choose a privileged origin. A preview is immutable per accepted build; browsing and review remain usable when preview preparation fails.

**Pass:** a fresh user finishes without an undocumented operator edit; private data stays private; retries do not create duplicate repos/invites; both initialization paths and ordinary Git work; newly created supported repos obtain isolated previews. Limits are shown before avoidable failures.

### C06 — finish the core collaboration slice already present

**Dependencies:** C05. **Budget:** one day. **Starting areas:** repository browsing, changes/reviews, issues/comments, profiles/notifications, virtualized diff.

Trace create/read/update/permission flows through real API and storage. A user creates an issue, another contributes, a reviewer leaves an anchored comment and requests changes, a new checkpoint invalidates applicable review, the update is accepted under policy, and users can find the complete conversation. A private contribution must not leak into public profiles or discovery.

Do not add all advanced planning systems during this ticket. Those remain explicit R1 tickets. Preserve a repository-first interface, intelligible concurrent activity, accepted state, and accessible review controls.

**Pass:** this journey works from the rendered browser at desktop and 390px width and through relevant API/CLI routes, with keyboard access, reload persistence, useful empty/error states, and no inert controls. Broken diff anchors or revoked access must fail explicitly, not show unrelated content.

### C07 — connect tags and releases end to end

**Dependencies:** C03, C06. **Budget:** one day. **Starting files:** `src/server/release-records.ts`, tag-operation/controller modules, `src/web/tags-releases.ts`, `TagsReleasesPanel.tsx`, Worker routes and navigation.

Complete the controller-to-HTTP DTO-to-client-to-panel path. Do not duplicate the existing isolated modules. Expose actual persisted tags/releases only when the corresponding operation is usable. Preserve create-only tag publication where intended; unexpected existing tags require an explicit decision.

**Pass:** create a tag from an exact accepted commit; confirm it with native Git from another clone; create, edit, publish, reload, and find a release. Retry the same request after an intentionally lost response without duplication. Reject unauthorized edits, stale revisions, and mismatched tag receipts. Attachments/prerelease automation remain F11 unless finished and proven here.

### C08 — make external delivery and migration coverage truthful

**Dependencies:** C03, C05. **Budget:** one day. **Starting files:** webhook outbox, connections/reporting, mirror runner/ledger, GitHub migration reader/inventory, import-history workflow.

Use an owned receiver to validate signatures, duplicates, delays, and replay. A receiver should make one logical action for one stable event ID. Expose accepted, delivery-pending, delivery-failed, and delivered independently. Publication must not disappear because a receiver is unavailable.

Reconcile migration receipts to the actual imported scope: selected refs, objects, metadata, attachments, and explicit omissions. Do not claim full migration until F15. Test one-way mirroring only with explicit export consent and an owned target; lack of that approval must not block unrelated work.

**Pass:** a signed callback cannot approve the wrong candidate/policy; retry is idempotent; a clean receiver processes one event once; missing migration coverage is visible. Native Git-integrity checks are not labeled application-test success.

### C09 — run a fixed release acceptance batch

**Dependencies:** C02–C08. **Budget:** one day. **Starting areas:** existing focused tests, hosted acceptance runner, status probes, cost ledgers and UI.

Run a predefined matrix: independent edits, text conflict, clean-merge behavioral failure, interface/units mismatch, contradiction, stale base, competing publication, interrupted response, revoked access, protected-check tampering, and denied egress. Retain failed runs. Distinguish deterministic replay from fresh agents.

Use a small second repository so success does not depend on hardcoded ticket-booking names. Prove a critical read/review path survives AI/CI/preview/mirror failure. Exercise a scoped backup restoration into a new test repository and compare actual refs and metadata.

Suggested release target: at least 18 of 20 compatible live trials complete within the declared repair budget, zero incorrect acceptance in the specified safety suite, and three consecutive full demos under ten minutes. These are targets, not existing measurements. Investigate failures without deleting cases or lowering requirements.

Measure readiness-to-accept p50/p95, user code edits, product decisions, requirements preserved, regressions, tokens and cost. For UI, set one reproducible dataset and device/network profile; record authenticated navigation and large-diff performance before and after. Avoid claiming global uptime from a small test.

**Pass:** agreed cases pass or the release remains blocked with a precise defect. A fixed final replay batch passes after repairs. No generic endless second audit follows a completed gate.

### C10 — prepare a reproducible release and compliant evidence package

**Dependencies:** C09. **Budget:** one day. **Starting files:** existing README, architecture, demo, submission, LICENSE and NOTICE materials.

Pin one release SHA, toolchain, container image, deployment ID, and source/setup instructions. Check the public clone logged out and execute the documented setup in a clean environment. Document exact supported adapters, limits, credentials, cleanup, and approved infrastructure exceptions. Audit logos, badges, fonts, dependencies, and copied assets for permission; generated artwork is not automatic rights clearance. Do not publish a mark implying Cloudflare ownership.

Prepare a truthful video run: concurrent agents, actual text conflict, clean merge that breaks behavior, protected repair preserving both features, exact accepted result, and a concise contradiction decision. Use live operations or clearly identified recorded runs; no fake progress or prewritten patches described as live generation. A text script is not a finished video.

**Pass:** source/setup/evidence are consistent, required video exists and has been reviewed, there is no sensitive content in footage/logs, and draft entry fields match the actual build. Human recording/eligibility approval remains explicitly visible if pending. Never automate final submission.

### C11 — freeze competition build; owner submits

**Dependencies:** C10. **Budget:** contingency window.

Do not insert optional feature work into the release branch. Recheck the organizer's current rules/form, final file readability, source URL, and running instructions. The owner confirms eligibility, rights, and terms and submits manually. Record the submission receipt only after an actual confirmed submission. Future parity work uses a subsequent release branch.

**Pass:** competition-ready is distinguished from submitted; C cannot be declared submitted by a coding agent. No broader full-parity claim is implied.

## 7. Full replacement tickets after the competition-critical path

Each ticket below is a finite workstream. Split it into approximately one-day vertical slices with the listed acceptance journeys; do not make one giant implementation prompt per category. Dependencies are functional, so independent UI work can proceed without competing writes to the same controller. Do not mark a workstream complete while one of its included capabilities remains pending.

### F01 — repository lifecycle (R1; after C05)

**Progress (source-tested only, October 8):** archive and unarchive are implemented end to end: pure rules in
`src/core/repository-lifecycle.ts`; optional `lifecycle` field in the project document; Durable Object methods
`repositoryLifecycle` and `repositoryLifecycleTransition`; route `/api/p/:id/lifecycle` (GET for members, POST
archive/unarchive for owners only); and a central read-only guard on archived repositories for every non-GET
project route except the lifecycle route and repository deletion. Evidence: `tests/repository-lifecycle.test.ts`
(5 pass) and `tests/repository-lifecycle-http.test.ts` (1 pass; 48 assertions in child mode covering visibility and
topics: owner-only, validated, and refused while archived). Topics validation lives in `src/core/repository-topics.ts`
(`tests/repository-topics.test.ts`, 3 pass). Lint and typecheck pass.

**Blocked for the no-spend scope (October 8):**
- Default branch: changing it needs canonical Git ref writes through Artifacts (billed) and rebinding the
  accepted-branch scope that accepted history depends on.
- Rename: changes the canonical repository name that Artifacts and the accepted, preview and storage scopes are
  keyed on (`canonicalRepoName` identity checks); it is a hosted Git identity change.
- Forks: creating an independent fork creates a new canonical Artifacts repository (billed).
- Ownership transfer: moves who controls the project's spend and account responsibility. That is a billing
  decision the owner must make before any code changes it.
- Deletion with recovery: keeping data recoverable extends storage retention, which bills. Needs the owner's
  retention decision.
- Template creation: creating a repository from a template creates a new hosted Artifacts repository (billed, like
  forks), so it is blocked until the owner decides on that spend.

Each stays blocked until the owner approves the spend or makes the billing decision.

Non-project writes are now guarded by `archivedWriteRefusal` (`src/server/archive-guard.ts`, 3 unit tests pass): connection
event callbacks, public participation, public discussion changes, and invitation joins return 409 while archived. Route-level
HTTP tests for those four families now exist: `tests/archived-nonproject-http.test.ts` (1 pass; 10 assertions in child
mode; authenticated member requests get 409 with the read-only message, and a public read is not refused). Still open for F01: rename, forks, ownership transfer, and deletion
with recovery, which are blocked as listed above.

Cover repository visibility, README/license/gitignore initialization, template creation, independent forks, fork relationships, default branch changes, topics, archive/unarchive, rename, ownership transfer, deletion and recovery. Preserve source identity and permission boundaries during every transition. Imported data stays attributed and source repos are never mutated by an import.

Acceptance: migrate an owned test repository through rename, transfer, archive, restore, and fork contribution; verify links/refs/data and old credential denial. A fork is not merely a hidden task workspace with no user lifecycle. Owner deletion must not orphan unbounded billable resources.

Reference inventory: `https://docs.github.com/en/repositories`.

### F02 — Git transport, repository size and object integrity (R1; after C03)

**Progress (source-tested only, October 8):** the Git LFS protocol core is in `src/core/git-lfs.ts`: batch validation
(download/upload, basic transfer only, at most 100 objects, exact SHA-256 OID format, non-negative integer size, a
size limit checked before any upload) and content-derived verification (an object is accepted only when its actual
bytes match the declared size and SHA-256 OID). Evidence: `tests/git-lfs.test.ts` (5 pass); lint and typecheck pass.

Existing local coverage re-run on October 8: exact advertised-ref parsing (`tests/exact-git-ref.test.ts`, 5 pass) and
tag Git behavior (`tests/tag-git.test.ts`, 7 pass). Gitlink and submodule handling is covered by existing tests
(for example `tests/git-migration-inventory.test.ts`). Commit signature parsing is in `src/core/commit-signature.ts` (`tests/commit-signature.test.ts`, 5 pass): it detects
unsigned, gpg, ssh, x509 and unknown blocks, refuses two signature headers, and rebuilds the exact signed payload byte for
byte. Cryptographic verification for SSH signatures is in `src/core/ssh-signature.ts` (`tests/ssh-signature.test.ts`, 6 pass):
it verifies ssh-ed25519 SSHSIG signatures made by `ssh-keygen -Y sign -n git` against a trusted authorized key, and refuses
other namespaces, untrusted keys, other key types, tampered bytes and non-SSH input. Test fixtures were generated locally with
`ssh-keygen` and checked with `ssh-keygen -Y check-novalidate`. The trusted-key registry is in `src/core/trusted-keys.ts`
(`tests/trusted-keys.test.ts`, 5 pass): it accepts only ssh-ed25519 authorized-key lines, validates the blob, de-duplicates,
caps each user at 20 keys, refuses removal of unknown keys, and feeds the SSH verifier. The registry is stored on the
account in the Durable Object (`trusted_signing_keys`) and exposed at `/api/signing-keys` (GET, POST, DELETE) for a
signed-in human session only; `tests/signing-keys-http.test.ts` (1 pass; 15 assertions in child mode) covers listing, idempotent
add, refusal of other key types and extra fields, unknown removal, wrong methods and anonymous access. GPG verification is in
`src/core/gpg-signature.ts` (`tests/gpg-signature.test.ts`, 4 pass), using the `openpgp` library (6.3.2, pure JavaScript,
Workers-compatible) against a key and signature produced by GnuPG 2.5 and checked with `gpg --verify`. It accepts only a
signature that verifies against a trusted key, and reports that key's uppercase fingerprint. Trusted GPG public keys are stored
on the account (`trusted_gpg_keys` in the account Durable Object) and exposed at `/api/signing-keys/gpg` (GET, POST, DELETE) for
signed-in human sessions only. Validation (`src/core/trusted-gpg-keys.ts`) refuses private keys, malformed input and extra fields,
and is idempotent by fingerprint; `tests/gpg-keys-http.test.ts` (1 pass; 13 assertions in child mode) covers it.

**Blocked for F02 (October 8):**
- X.509 (CMS/PKCS#7) verification: a trust-root policy is required before any X.509 signature can be accepted. The
  owner must name the certificate authorities to trust, or decide to reject X.509 commits. No code is accepted
  without that decision.
- Commit-view wiring: the commit views (`CandidateReview`, `DiffViewer`, `CandidateJournal`) need verification status from
  the server, and the server reads commit objects through Artifacts. Validating that on a real repository is a hosted
  Artifacts operation, which needs the owner's confirmation before it runs.

**Still open for F02, not closable without spend:** the R2-backed LFS object store and its HTTP endpoints (billed R2
storage), stock Git and Git LFS client acceptance against the deployed Worker (hosted), and the artifact-backed
transport. Blocked until the owner approves that spend. Local work still open: branch/tag/signature behavior,
submodule identity checks, and the non-project guard list from F01.

Complete normal Git branch/tag behavior, signatures and verification status, clone/fetch/push/pull, submodule references, and an interoperable Git LFS batch/object service on R2 where needed. Check actual object hashes, not pointer files alone. Evaluate an ordinary SSH Git path separately; a custom tunneling client is not transparent SSH parity. Cloudflare's documented Wrangler SSH access is account-authenticated and does not expose public container ports; do not confuse it with a public Git SSH service.

Acceptance: stock Git and Git LFS clients exercise private/public operations; signed/tagged history survives transfer; blobs, refs and relevant submodule identities survive export/import; unauthorized and non-fast-forward writes follow policy. Test limits before accepting uploads. If Artifacts capacity prevents a promised repository tier, obtain a supported provider change or leave the tier blocked—never secretly split/rewrite Git history.

References: `https://docs.github.com/en/repositories`, `https://developers.cloudflare.com/artifacts/api/git-protocol/`, `https://developers.cloudflare.com/artifacts/platform/limits/`, and `https://developers.cloudflare.com/changelog/product/containers/`.

### F03 — code experience and search (R1; after C06)

**Progress (source-tested only, October 8):** permission-filtered code search is in `src/core/code-search.ts`
(`tests/code-search.test.ts`, 5 pass). It searches only files the actor may read (owner-only files are never searched for
members or outsiders), matches literally and case-insensitively with line numbers, pages with a cursor (50 per page), and caps
at 1,000 matches. Every response says whether it is `complete`; a capped or unfinished search reports a `reason` instead of
silently truncating. Queries are limited to 200 characters, and empty queries and bad cursors are refused.

**Still open for F03 (local):** branch- and tag-aware browsing, Markdown, raw and binary views, path and history navigation,
blame, compare, commit and line permalinks, rename tracking, and the cache keys that include version and access scope.
These need the commit-object reader, which is blocked on owner confirmation for hosted Artifacts reads (see F02). Browser
edits and uploads write to Git and are blocked on the same Artifacts decision.

Finish branch/tag-aware browsing, Markdown/raw/binary views, path/history navigation, blame, compare, commit/line permalinks, browser edits/uploads, and permission-filtered code search. Keep query syntax, paging, supported file types and indexing freshness explicit. Reuse the working virtualized diff; do not rebuild it for aesthetics.

Acceptance: a user follows an issue to a line at an old commit, sees accurate blame/history, searches a symbol, proposes an edit, and returns after a rename. Deleted/private material is removed from unauthorized search projections. Searches must not silently truncate and report complete results. Cache keys include relevant version and access scope.

References: `https://github.com/features` and `https://docs.github.com/en/search-github`.

### F04 — pull-request and branch-policy parity (R1; after C04/C06)

**Progress (source-tested only, October 8):** the platform merge gate is in `src/core/merge-gate.ts`
(`tests/merge-gate.test.ts`, 5 pass). Only the latest review per reviewer counts, and only on the current head commit, so stale
approvals stop counting when the head changes. Self-approval and duplicate approvals from one reviewer do not count. Any
outstanding "request changes" blocks the merge. Required approval counts are enforced, and CODEOWNERS rules use the most
specific path prefix; an owner's approval is needed for each changed path under that rule, and an author cannot satisfy their own
code-owner rule. The gate reports every blocker. Lint and typecheck pass.

**Merge-method policy (source-tested, October 8):** `src/core/merge-method-policy.ts` (`tests/merge-method-policy.test.ts`,
4 pass) resolves merge, squash or rebase against the repository policy. An omitted method uses the default; a disabled method
is refused even when requested explicitly; a policy with no enabled method, or a disabled default, is refused.

**Review drafts and threads (source-tested, October 8):** `src/core/review-threads.ts` (`tests/review-threads.test.ts`, 4 pass).
Drafts stay private to their author until published, and publishing affects only that author's drafts. Threads are anchored to a
repository-relative path and a line of at least 1 (no traversal or absolute paths). Comments are limited to 65,536 characters.
Only a participant who has published can resolve a thread, and a resolved thread cannot be resolved again.

**Queue, revert and requests (source-tested, October 8):** `src/core/merge-queue.ts` (`tests/merge-queue.test.ts`, 2 pass) merges the
queue head only on the current base with passing checks and otherwise requeues it; a revert is a new change naming its target and
reason. `src/core/review-requests.ts` (1 pass) refuses self-requests and non-readers and deduplicates.

**Stacks, suggestions and forks (source-tested, October 8):** `src/core/change-stacks.ts` (`tests/change-stacks.test.ts`, 3 pass). A
stacked change merges only after every ancestor; missing parents and cycles are refused. A suggestion replaces exactly one existing
line and fails when the line is outside the file. Maintainer pushes to a fork need the fork owner's opt-in.

**Still open for F04 (local):** base-branch changes. Hosted proof remains blocked on owner confirmation. Hosted merge into Artifacts-backed branches needs owner confirmation.

Complete drafts, review requests, required approvals, CODEOWNERS, multiline/inline threads, suggested edits, resolution, stale approvals, base changes, fork permissions, stacked changes, merge queues, merge/squash/rebase policies, and explicit revert. Retain original contributor attribution and verifiable repair intent. Platform policy—not an agent—controls gate satisfaction.

Acceptance: two accounts and one agent perform a fork-based review cycle, a stack, an approval-invalidating change, a required-check failure, and each allowed merge method. The exact produced commit is verified for its method. Concurrent base changes never discard accepted history. Review-required and safe auto modes remain clear and independently tested.

References: `https://docs.github.com/en/pull-requests` and `https://docs.github.com/en/repositories`.

### F05 — issues and triage (R1; after C06)

**Progress (source-tested only, October 8):** `src/core/issue-triage.ts` (`tests/issue-triage.test.ts`, 4 pass). Labels are
trimmed, deduplicated and limited to 50 characters. Only repository members can be assigned. An accepted change closes an issue
once; a second closure keeps the original record, and reopening clears the closing change without fabricating history. A
transferred issue keeps a tombstone with its destination and refuses further changes. Lint and typecheck pass.

**Still open for F05 (local):** milestones, templates/forms, attachments, duplicates, relationships/sub-issues, saved filters,
bulk actions, moderation, and deletion tombstones with redirects.

Complete labels, assignees, milestones, templates/forms, attachment handling, linking/closing through accepted work, duplicate/transfer workflows, relationships/subissues, saved filtering, bulk actions, and moderation. Preserve discussion context when tasks are assigned to agents.

Acceptance: a maintainer triages a set of issues, converts one into a task, merges its fix, and sees the correct issue close once; reopen/revert does not fabricate history. Deleted and transferred resources retain appropriate redirects or tombstones. All actions respect role and privacy boundaries.

Reference: `https://docs.github.com/en/issues`.

### F06 — project planning (R1; after F05)

**Progress (source-tested only, October 8):** `src/core/project-planning.ts` (`tests/project-planning.test.ts`, 3 pass). Items reference
issues by number and only accessible issues can be added, once. Stale edits are rejected by item version, fields are typed, and
progress counts come from stored items. Open: views, iterations, automation, bulk editing, export.

Implement project boards, tables, timeline/roadmap views, custom fields, saved filters/sorts, iterations, item status automation, bulk editing, and useful progress charts. Projects must reference issues/changes rather than duplicate them into unrelated state.

Acceptance: the same issue moves between views, is updated by an accepted change, remains accessible only to authorized members, and exports with its custom fields. Conflicting edits are detected or deterministically reconciled. Charts use real stored data.

Reference: `https://docs.github.com/en/issues`.

### F07 — discussions, documentation and snippets (R1; after F05)

**Progress (source-tested only, October 8):** `src/core/discussions.ts` (`tests/discussions.test.ts`, 3 pass). Moderation (lock,
pin) is maintainer-only and audited; locked discussions refuse replies; only the asker or a maintainer marks an answer, only in
questions. Open: polls, subscriptions, issue conversion, wikis, snippets.

Implement discussion categories, question/answer marking, polls, threading, subscriptions, pin/lock/moderation, and issue conversion; versioned wikis with Git access; shareable revisioned snippets with explicit visibility. Do not call issue comments a full discussion system.

Acceptance: a question becomes an issue without losing attribution/links; wiki edits and history survive ordinary Git operations; private snippets cannot leak through discovery, feeds or raw URLs; moderation is audited and appeal/support routes are real.

References: `https://docs.github.com/en/discussions` and `https://github.com/features`.

### F08 — people, discovery and notifications (R1; after F05/F07)

**Progress (source-tested only, October 8):** `src/core/notification-privacy.ts` (`tests/notification-privacy.test.ts`, 3 pass).
Recipients without read access never get a title; muted threads and unsubscribed users get no ordinary events; mentions reach
unsubscribed readers but not muted ones. Open: profiles, follows, stars, discovery, email preferences, diagnostics.

Complete profiles, contribution visibility controls, follows, stars/watch subscriptions, repository discovery/topics, notifications, mentions, mute/unsubscribe, read/unread state, email preferences, and delivery diagnostics. Use existing profile/community/inbox modules where they work. Prevent name/namespace impersonation through a defined reporting and review process.

Acceptance: a real user finds another maintainer, subscribes, receives exactly the intended events, mutes a thread, and controls private-contribution visibility. An inaccessible issue title cannot leak through an email or notification. Synthetic acceptance accounts are never displayed as real popularity.

References: `https://docs.github.com/en/account-and-profile` and `https://docs.github.com/en/subscriptions-and-notifications`.

### F09 — organizations and access (R1; after C01/C05)

**Progress (source-tested only, October 8):** `src/core/org-access.ts` (`tests/org-access.test.ts`, 3 pass). Effective role is the
highest of direct and team grants; org owners are admin; the last owner cannot be removed. Open: invitations, teams UI, audit log, SSO.

Build true organization ownership, teams/nesting, inherited roles, outside collaborators, multiple owners, invitations, access reviews, scoped application/token controls, and audit trails. Reserve enterprise SSO/managed-user expansion for F19; implement those paths only through maintained standards-based implementations and approved providers. R1 must already provide secure session/account recovery and key/token revocation.

Acceptance: transfer a repo into an organization, grant/revoke team access, remove an employee, and verify every read, clone, preview, notification, search and app token respects the change. Invitations cannot downgrade an owner or be consumed twice. Business account continuity must survive one owner leaving.

References: `https://docs.github.com/en/organizations` and `https://docs.github.com/en/authentication`.

### F10 — CI engine and runner compatibility (R2; after C02/C08/F09)

**Progress (source-tested only, October 8):** `src/core/ci-gate.ts` (`tests/ci-gate.test.ts`, 2 pass). A required check passes only with
a successful latest run on the exact commit; missing checks block. Open: the engine, runners, workflows (hosted/Containers blocked).

Implement triggers, job dependencies, matrices, conditions, reusable workflows, logs, artifacts/caches, timeouts, cancellation/retry, secret scopes, environment approval, workload identity, resource quotas and billable usage. Publish a precise workflow dialect/compatibility matrix. Test imported workflows through actual execution; an Actions YAML parser alone is not compatibility.

Use Cloudflare-hosted Linux execution where supported. macOS/Windows jobs need an explicitly approved runner architecture, such as user-owned runners with tightly scoped expiring jobs. They are not silently counted as Cloudflare-hosted capabilities. Cloudflare documents Linux VM container execution. Do not introduce a hosted competitor to pass a demo or pretend Linux containers are macOS machines.

Acceptance: build/test a real matrix, invalidate a cache, cancel a running process, reject a fork trying to read privileged secrets, and recover after worker failure without double-running an irreversible step. Browsing and reviews continue during CI outages. Finish declared dialect exceptions before claiming that compatibility tier complete.

References: `https://docs.github.com/en/actions`, `https://github.com/features`, and `https://developers.cloudflare.com/containers/api/container-class/`.

### F11 — releases, static sites and deployments (R2; after C07/F10)

**Progress (source-tested only, October 8):** `src/core/release-rules.ts` (2 tests): semantic tags, one release per tag, unique assets, SHA-256 digests. Open: static sites, deployments.

Extend release support to assets, draft/prerelease state, changelog/provenance, immutable downloads, and permission-safe publication. Provide static-site publishing, custom domain validation, deployment environments, approval, statuses and rollback. Distinguish source accepted, artifact built, deployment requested, and deployment observed.

Acceptance: publish an actual asset, validate its digest, install/download it through the documented client flow, deploy the exact approved artifact, fail/retry a delivery, and roll back deliberately. No acceptance or re-delivery silently repeats a production migration. Environment secrets never reach untrusted previews.

References: `https://docs.github.com/en/pages` and `https://docs.github.com/en/repositories`.

### F12 — packages and registries (R2; after F09/F10)

**Progress (source-tested only, October 8):** `src/core/package-visibility.ts` (2 tests): private packages hidden from outsiders; published versions immutable. Open: registries, protocols.

Provide actual package protocol implementations for the registries included in the frozen catalog, not generic file-upload pages: OCI/container images and the required language-package formats. Implement public/private access, version immutability, digest/provenance, retention, deletion/restoration policy, repository linkage and namespace protection. Pin supported protocol versions.

Acceptance: stock ecosystem clients publish, install/pull and verify actual package contents, scoped tokens cannot cross namespaces, and conflicting versions cannot overwrite a published artifact. Permission changes take effect on every download path. No fake registry listing without working client commands.

Reference: `https://docs.github.com/en/packages`.

### F13 — code and supply-chain security features (R2; after F09/F10/F12)

**Progress (source-tested only, October 8):** `src/core/security-alerts.ts` (2 tests): secret-pattern scan reports kind and line only, never the value. Open: dependency graph, advisories, code scanning.

Integrate maintained scanners and suitable advisory data for secret, source-code and dependency findings; support SARIF ingestion, vulnerability reporting/advisories, alert triage, dependency update proposals, license policy and SBOM/provenance. Check licenses and hosted-use terms before integrating tools. Do not simply label any scanner “CodeQL equivalent.”

Acceptance: known benign synthetic fixtures trigger the expected findings, corrected revisions resolve them without erasing history, new vulnerable dependencies are blocked where policy requires, and private reports remain private. No automatic exploit execution against third parties. Coverage limits and false-positive handling are visible.

Reference: `https://docs.github.com/en/code-security`.

### F14 — APIs, apps and ecosystem interoperability (R1 core; R2 expansion; after C08/F09)

**Progress (source-tested only, October 8):** `src/core/token-scopes.ts` (`tests/token-scopes.test.ts`, 2 pass). Least-privilege scopes;
write implies read of the same resource only; unknown scopes are refused. Open: apps, webhooks expansion, OAuth.

Publish stable versioned contracts, pagination, rate limits, resource IDs, webhook events and replay rules. Complete app installation/consent, scoped authentication, revocation, check/report APIs, and a trustworthy integration discovery surface. Expose REST and GraphQL equivalents where included; disclose exact incompatibilities rather than claiming drop-in GitHub API support.

Acceptance: an external test client reads and updates issues, requests checks for an exact candidate, handles pagination/limits/retries, and is immediately denied after revocation. A real app completes install/use/uninstall. A vendor name in metadata is not a connected account or certified integration.

References: `https://docs.github.com/en/rest`, `https://docs.github.com/en/graphql`, `https://docs.github.com/en/apps`, `https://docs.github.com/en/webhooks`.

### F15 — complete migration and exit (R1; after F01–F09/C08; extend for R2 objects)

**Progress (source-tested only, October 8):** `src/core/export-bundle.ts` (`tests/export-bundle.test.ts`, 2 pass). SHA-256 manifest per
object; private objects excluded without access; tampered or missing content reported. Open: import, Git data, redirects.

Inventory and transfer all in-scope heads/tags/reachable objects and LFS bytes; map issues, PRs, inline reviews, discussions, reactions, attachments, releases, wiki and project metadata. Support authorized private sources, resumable jobs, deletions, idempotent restart, and provenance. Imported authors retain attribution without impersonating local accounts. Produce a coverage and discrepancy report.

Acceptance: migrate a purpose-built repository containing every supported object, compare counts/identities/content hashes, intentionally interrupt and resume, and export/restore into a clean destination. A source-only archive does not establish conversational migration. Provider restrictions and missing objects must remain explicit blockers or approved exceptions.

Reference: `https://docs.github.com/en/migrations`.

### F16 — developer environments and agent interoperability (R2; after C02/F10/F14)

**Progress (source-tested only, October 8):** `src/core/agent-permissions.ts` (1 test): an agent calls only granted tools inside its own repository. Open: environments, protocol interoperability.

Extend existing managed agents and Git workspaces to resumable development environments, editor attachment, scoped terminals, dependency/bootstrap policies, snapshot/cleanup, and safe AI assistance. Keep provider/agent identity verifiable and distinguish local customer-owned agents from built-in runtime agents. Preserve prompts, requirements, patches and evidence without exposing private transcripts publicly.

Acceptance: a human and two agents modify a normal second repository concurrently, reconnect after an interruption, retain their work, and integrate through the same policy engine. A coding workspace cannot become the trusted publisher. Persistent environments have explicit quotas and deletion/recovery semantics.

References: `https://docs.github.com/en/codespaces`, `https://docs.github.com/en/copilot`.

### F17 — clients and accessibility (R3; after F03–F09/F14)

**Progress (source-tested only, October 8):** `src/core/accessible-names.ts` (1 test): interactive elements without a name are reported. Open: clients, full audit.

Finish the CLI's supported workflows and credentials on macOS/Windows/Linux. Provide the agreed desktop and mobile/tablet client experiences, including review, notifications and authentication. Record whether these are native clients or responsive web; do not call a mobile webpage native app parity. Preserve normal editor/Git compatibility.

Acceptance: complete create/clone/contribute/review/accept/inspect on each declared client, with keyboard, screen-reader and reduced-motion checks. No client stores account-wide infrastructure secrets. Offline/draft behavior and conflict recovery are explicit.

Reference inventory: `https://docs.github.com/en`.

### F18 — commercial and community operations (R3; after usage/authorization foundations)

**Progress (source-tested only, October 8):** `src/core/usage-limits.ts` (2 tests): usage accumulates, overage is flagged, invalid amounts refused. Open: billing, sponsorship (owner decisions).

Complete measured pricing, entitlements, usage accuracy, checkout/webhook recovery, refunds/cancellation, receipts and support before enabling payments. Preserve free basic private repositories with truthful quotas; do not promise unlimited loss-making hosted agent work. Sponsorship, education/nonprofit programs, and community support have operational, legal and payment obligations; code alone cannot manufacture these services.

Acceptance: an approved test purchase and cancellation reconcile entitlement exactly once; billing failure does not seize accepted work; user export remains available. Any sponsorship payout flow is validated by an authorized operator and processor, never fabricated. Record unapproved provider dependencies as blocked.

References: `https://docs.github.com/en/billing`, `https://docs.github.com/en/sponsors`, `https://docs.github.com/en/education`.

### F19 — operations, enterprise and service trust (R3; start relevant safeguards in C)

**Progress (source-tested only, October 8):** `src/core/audit-log.ts` (1 test): hash-chained audit log locates the first edited or removed entry. Open: SSO, retention, status page.

Provide scoped backups and tested restores, monitoring of actual user journeys, declared service objectives, incident communications, abuse and security-response queues, retention/deletion controls, audit export, capacity management and a recovery runbook. Enterprise identity/governance/self-hosting or data-residency commitments require tested support, not badges. Never claim independent compliance certification without the real assessment.

Acceptance: exercise the agreed recovery objective, restore in an isolated environment, confirm no accepted state disappears during optional-service failure, revoke leaked test credentials, and resolve an abuse report with an audit trail. Monitor clone/review/accept/delivery separately; a health endpoint that always returns 200 is not platform uptime evidence.

References: `https://docs.github.com/en/organizations` and `https://docs.github.com/en/enterprise-cloud@latest`.

### F20 — finite parity certification and stop (R3; after all included tickets)

**Progress (source-tested only, October 8):** `src/core/parity-certification.ts` (1 test): a ticket counts only with evidence; the rest are listed gaps. The certification itself is not claimed.

Review the frozen feature register, not all future GitHub ideas. Each included row must link passing UI/API/native interoperability and permissions evidence. Every external dependency/exception must be approved, and every unresolved operational requirement stays open. Remove overbroad claims, not useful features, when a capability is genuinely unsupported.

Acceptance: a new user, team maintainer, and organization administrator can complete the declared migration-to-daily-work-to-release journeys without hidden operator workarounds. Publish an accurate compatibility/limitations statement. Mark the release complete and stop adding scope. New requests become another version.

## 8. Dates, task ownership, and interruption rules

### Competition schedule (proposed, not accomplished)

| Date | Primary target |
|---|---|
| Oct 4 | C00 snapshot; C01 decisions; start C02 |
| Oct 5 | C02 hosted isolation/network proof |
| Oct 6 | C03 exact publication/recovery |
| Oct 7 | C04 policy-driven automation; C05 developer onboarding |
| Oct 8 | C06 collaboration; close C07 tags/releases |
| Oct 9 | C08 delivery/migration proof |
| Oct 10 | C09 fixed evaluation and targeted repairs |
| Oct 11 | Finish release blockers and responsive/performance proof |
| Oct 12 | C10 freeze, clean setup, evidence and video |
| Oct 13 | Final recording/package review and contingency |
| Oct 14 | C11 manual submission buffer; aim before 6 p.m. Pacific |

If C02/C03 remain blocked after Oct 6, prioritize a truthful, constrained competition release rather than pretending full untrusted hosting is safe. Public untrusted execution remains disabled until its security gates pass. A revised scope must still pass its applicable trust-boundary and exact-publication gates; no security gate is waived. Never replace genuine concurrent code changes or the core conflict-verification mechanism with animation.

Full parity is not responsibly date-estimated from test counts or elapsed agent hours. After C00, estimate the next workstream from its acceptance slices; track actual throughput and revise later release dates. Do not promise the entire register by October 14. R1/R2/R3 remain required work, not disappearing backlog.

### Execution discipline

One primary integrator owns the active release and large shared controller/router files. A second lane may work on independent UI or an unrelated module; an independent verifier may review read-only. Reserve file ownership before parallel edits. Avoid multiple agents simultaneously modifying `durable-object.ts`, `worker.ts`, or `workflow.ts`.

For each ticket: reproduce the missing journey once, patch the smallest coherent area, run focused tests plus `bun run lint`, `bun run typecheck`, relevant build checks, then capture the required real evidence. Do not rewrite working infrastructure without a demonstrated defect.

After two unsuccessful repair cycles, document the exact failing assertion, attempted fixes, and missing dependency. Change strategy once or mark BLOCKED and move to an independent ticket. Do not retry the same command indefinitely, poll an unavailable service for days, or manufacture green results. A timebox triggers replanning, not deletion of acceptance criteria.

A passing gate stays closed unless a later diff affects it or new evidence reproduces a regression. Run one full release verification batch, targeted repair batches as needed, and one final confirmation. Do not invent more audits every time the existing checks pass.

Keep a single compact handoff entry:

`Active release | active ticket | source SHA | deployment SHA | passed evidence | exact blocker | next action`.

When context compacts, read that entry and the active ticket, not the entire conversation or every past failure. Report progress as completed ticket IDs and remaining gates, never an unsupported percentage.

## 9. Budget and permissions

No fresh spending authority is granted by this document. Reuse existing authorized resources and limits; ask once for exact incremental costs when necessary. Reserve model/container/storage budget before dispatch and reconcile actual usage. Preserve Git/read/review capacity independently from optional agents and previews. Do not turn off cost guards to get a successful demonstration.

Keep paid checkout off until F18. Monetization is not a dependency for the competition release. Do not make enabling a merchant account the reason a functional Git product never reaches a release candidate.

Provider credentials remain server-side; secrets must not appear in chat, repository files, browser bundles, URLs, screenshots or demonstration footage. Public provider publishable keys are not secrets. Inspect and preserve unrelated account resources; cleanup is project-scoped.

## 10. Competition release gate

Before C11, re-read the official rules and current form. Workers, Artifacts, concurrent agents, an accepted source license, runnable source and a real 5–10-minute video are mandatory. Deadline: 14 October 2026, 11:59 p.m. PDT. Owner-only final entry; no automated submission. Confirm eligibility, material rights, branding, content restrictions and travel obligations. This is a checklist, not legal clearance.

Official page, rules PDF and live form rechecked during the `2154626` source
verification run. The deadline remains October 14, 2026 at 11:59 p.m. PDT.
The form requires team/contact/location, first attendee, project vision,
Cloudflare use, source URL, running instructions and a video upload; second
attendee is optional. Video formats: MP4/WebM/MOV, maximum 2GiB. Eligibility
requires US/Canada legal residency and age 18+ at the contest start, with the
listed exclusions; owner confirmation remains outstanding. Entry must be manual.
No form fields were submitted or terms accepted. Sources:
[rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf)
and [entry form](https://www.cloudflare.com/git-competition/submit/).

Official sources:
- `https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf`
- `https://blog.cloudflare.com/next-git-platform-on-cloudflare/`
- `https://www.cloudflare.com/git-competition/`
- `https://www.cloudflare.com/git-competition/submit/`

Retain Apache-2.0 unless the owner deliberately chooses another permitted license; a gratuitous change to MIT is unnecessary. Keep all release claims verifiable and describe competitors neutrally. Obtain actual owner confirmation and submission receipt; never mark these steps done on their behalf.

## 11. Immediate next action

Start C00 and identify the exact source/deployment delta. Then begin C02 while C01's owner decisions are resolved. Finish existing vertical slices before opening new feature families. Complete and freeze C, then advance through R1, R2 and R3 without reopening C for unrelated improvements. Report blockers precisely, and stop when the applicable release gates are satisfied rather than generating more work.
