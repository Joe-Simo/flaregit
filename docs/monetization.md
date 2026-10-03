# Preliminary monetization economics

Verified October 2, 2026. This is a proposal and an arithmetic model, not deployed pricing, measured customer usage, or a profitability claim. No billing changes are authorized by this document. Latest operating-target and implemented-guard updates appear below; the initial $4 scenarios are historical comparison assumptions, not the current $3 Team proposal.

The configured Polar product's actual subscription price remains unverified. The public `/pricing` reader is restricted to the server-configured product and publishes only validated fixed subscription amount/currency/interval/tax behavior. A private Polar catalog product may be the configured checkout target; this does not authorize publishing its names, organization, metadata or credentials. A successful projection establishes that configured subscription price, not per-seat pricing, feature parity or sustainable margins. The first reported live read returned an unavailable state, so the $4 figure below remains a hypothesis. HTTP classifications reveal only access denied, not found, rate limited, rejected request or unavailable; they never reveal provider response bodies. [Polar Get Product scopes/schema](https://polar.sh/docs/api-reference/products/get), [API versioning](https://polar.sh/docs/api-reference/2026-04/versioning)

Live projection check on October 3, 2026 (release `c5ebdb0`): `/plan-price` returned `provider_access_denied`, so no configured subscription amount was verified. It reported daily admission counters of Free 10 / Pro 200 and a 10-owned-repository prototype limit. These are admission limits, not guaranteed funded executions or a paid entitlement. The checked-in production configuration still sets `PAID_CHECKOUT_ENABLED=false`; this check changed no billing settings or product catalog data.

## Product and pricing proposal

Keep core Git collaboration, basic private repositories, contribution history, review, and bring-your-own tools/agents/AI/CI free. Outside contributors and bots must not create billable seats. Provider subscriptions remain the customer's choice; a GitHub bridge is optional.

Explore a familiar **Free / Team** offering, with Team targeted at **$3 per human seat/month**, contingent on measured costs. This is proposed pricing, not an available paid SKU. The earlier $4 arithmetic below remains a comparison scenario. Paid value could include organization administration, retention controls, and operational reporting; it must not make private repositories or external providers premium-only. GitHub currently lists Free with unlimited public/private repositories and Team at $4/user/month, qualified on its pricing page as the first 12 months. This establishes a headline comparison, not equal features or lower total workload cost. Recheck the comparison before launch. [GitHub pricing](https://github.com/pricing)

Managed AI, CI/container execution, and storage beyond a clearly published allowance should be separately metered, opt-in, prepaid services. Display estimated costs and reserve credits before dispatch. Charge actual reconciled usage; release unused reservations. Insufficient managed-compute credits must not prevent repository browsing, review, export, or bring-your-own execution. Do not sell unlimited compute inside a $4 seat.

## Verified vendor inputs

All allowances below belong to the Cloudflare billing account; they are not a new allowance for each FlareGit customer. A shared account may have other workloads. Model steady-state marginal costs without relying on allowances or prize credits.

| Cost | Official published input |
| --- | --- |
| Artifacts | Workers Paid required; first 1 GB-month and 10,000 operations/month included, then $0.50/GB-month and $0.15/1,000 operations. Storage spans repositories; retained forks require measurement. [Pricing](https://developers.cloudflare.com/artifacts/platform/pricing/) |
| Artifacts billing date | Billing begins October 14, 2026. The present beta period does not establish a zero-cost business. [Changelog](https://developers.cloudflare.com/artifacts/platform/changelog/) |
| Workers Standard | $5/account/month minimum; 10 million requests and 30 million CPU-ms included, then $0.30/million requests and $0.02/million CPU-ms. [Pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Containers | `standard-2`: 6 GiB memory, 12 GB disk, 1 vCPU. Marginal rates: $0.0000025/GiB-second memory, $0.00000007/GB-second disk, $0.000020/active-vCPU-second. Provisioned memory/disk accrue while running; CPU uses active time. Regional egress and Worker/DO costs are additional. [Pricing](https://developers.cloudflare.com/containers/platform/pricing/) |
| Existing billing integration: Polar | Source uses Polar MoR. Current Starter is 5% + $0.50/transaction; Pro $20/month with 3.8% + $0.40/transaction, Growth $100/month with 3.6% + $0.35, Scale $400/month with 3.4% + $0.30. Eligible organizations predating May 27, 2026 keep Early Member 4% + $0.40 plus 0.5% subscriptions. Our merchant eligibility/plan is unverified; model Starter conservatively. [Polar pricing](https://polar.sh/resources/pricing) |

Include Durable Objects compute/SQL storage/reads/writes, Workflows steps/storage, Queues delivery/retries, R2 previews/evidence, logs, authentication, email, monitoring and recovery costs. They are absent from the simple headline seat comparison and must be reconciled against bills. Official references: [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [Workers/Queues/Workflows](https://developers.cloudflare.com/workers/platform/pricing/). Allowance eligibility and charging start dates vary by product.

## Arithmetic and workload sensitivity

The following are our calculations using the verified rates, not vendor estimates of FlareGit usage.

Artifacts monthly marginal cost, with billed GB-month `G` and operations `O`:

```text
Account charge = 0.50 × max(0, G − 1) + 0.15 × max(0, O − 10,000) / 1,000
Steady-state marginal allocation = 0.50 × G + 0.00015 × O
```

Storage must count canonical repositories, isolated forks and retained history using the provider's actual billed accounting. Do not assume Git deduplication or fork sharing eliminates charges. Record daily peak storage, outstanding forks, candidate refs, imported history and preview retention; garbage-collect only with a recoverable retention policy. One million additional Artifacts operations costs $150; excessive polling can dominate lightweight storage. Cache browsing results by immutable commit, paginate trees, and measure calls per task/checkpoint/review/landing rather than assuming one operation per action.

For one running `standard-2` container, let `t` be elapsed seconds and `u` active vCPU-seconds:

```text
C = t × (6 × 0.0000025 + 12 × 0.00000007) + u × 0.000020
```

| Illustrative workload, before shared allowances | Marginal container resource cost |
| --- | ---: |
| Ten minutes, one CPU active throughout | $0.021504 |
| One hour, one CPU active throughout | $0.129024 |
| One hour running with negligible CPU | $0.057024 |
| 24 hours running, one CPU active throughout | $3.096576 |

One hundred ten-minute runs therefore cost $2.1504 in these resources alone; repeating every run doubles that component. Model/API charges, cold starts, execution overhead, network, verification and retention are additional. Waiting for human review should release the container and preserve the committed candidate, rather than keep memory/disk running. Parallel agents change peak concurrency and quota requirements; they do not earn free compute. Prepaid rates need headroom for failed runs and reconciliation lag, without charging customers for platform-caused retries contrary to the published policy.

Polar also lists +1.5% international-card fees, payout costs ($2/month with active payouts plus 0.25% + $0.25/payout), regional currency-conversion charges, and $15 disputes. Fees apply to tax-inclusive transaction values. These can materially reduce small-invoice contribution; actual merchant terms must be verified before charging. Do not add a separate Stripe processing fee on top of Polar without evidence. [Polar fee details](https://polar.sh/resources/pricing)

The configured model is `@cf/openai/gpt-oss-120b`: $0.35/million input tokens and $0.75/million output tokens. A hypothetical 20,000-input/5,000-output invocation costs $0.01075 before shared allowances; combined with a ten-minute active container it is $0.032254, or $3.2254 for 100 runs. These are example token budgets, not measured successful-task costs. Reasoning/output billing, repeated context, repairs and retries require actual usage reconciliation. [Model rates](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/)

Workers AI bills via neurons, with a shared 10,000-neuron/day allowance and Paid usage beyond it. The model page lists a 128,000-token context window. Rate limits/capacity and token budgets constrain availability; credits do not guarantee capacity. Do not promise a jurisdiction solely from model identity: verify chosen service data-localization/support terms separately. Enforce per-call token, elapsed-time, concurrency and account-spend ceilings; release paid reservations on failed admission. [AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [limits](https://developers.cloudflare.com/workers-ai/platform/limits/)

Container egress is separately listed at $0.025/GB in North America/Europe (1 TB/month included), $0.05/GB in Oceania/Korea/Taiwan (500 GB included), and $0.04/GB elsewhere (500 GB included). Treat these as shared provider allowances, not free bandwidth per customer. Regional deployment, repo clone sizes and model/context transfer need a bill reconciliation before setting managed run prices. The calculator intentionally excludes egress until those measured inputs exist. [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/)

## Seat contribution and free-user subsidy

Illustrative monthly allocation **per paying human seat**, ignoring shared allowances. “Other operations” and support are assumptions; replace them with measured allocations. Support assumes $60/hour loaded labor, so 0.5 minutes costs $0.50. Payment assumes Polar Starter and one $4 monthly domestic, tax-exclusive invoice per seat: $0.70. Payouts, tax-inclusive fee uplift, international cards, refunds and disputes are excluded, so these are optimistic contribution estimates.

| Assumption | Light | Base | Heavy |
| --- | ---: | ---: | ---: |
| Artifacts GB-month allocated | 0.25 | 1 | 3 |
| Artifacts operations allocated | 500 | 3,000 | 10,000 |
| Storage + Artifacts operations | $0.20 | $0.95 | $3.00 |
| Other infrastructure allowance | $0.15 | $0.25 | $0.40 |
| Support allocation | $0.25 | $0.50 | $1.00 |
| Payment allocation | $0.70 | $0.70 | $0.70 |
| Total variable cost | $1.30 | $2.40 | $5.10 |
| Contribution at $4 | $2.70 | $1.60 | **−$1.10** |

These allocations cover collaboration, not separately prepaid managed compute. At the heavy assumption, a $4 plan loses money before fixed costs. Unlimited large-repository retention is not justified. Aggregate organization invoices reduce the fixed payment fee: five $4 seats on one $20 invoice incur $1.50 total, or $0.30/seat under the assumed Polar Starter terms. Annual prepayment changes timing and payment fees, but must not hide renewal terms or cancellation obligations.

Free accounts have real costs. A hypothetical lightweight active free user consuming 0.05 GB-month, 100 Artifacts operations and $0.06 of other infrastructure costs $0.10/month before support. Ten thousand such users cost $1,000/month. This is an assumption, not an observed cohort. A larger free allowance or abandoned retained forks raises the subsidy; inclusion of provider allowances at startup can mask it.

Set a funded free-tier operating budget, measure costs per active and inactive repository, and publish generous but bounded storage/operation allowances before launch. New managed work can pause when its budget is exhausted; accepted work and recoverable history must remain readable/exportable. Any retention change needs explicit notice and a migration path. Do not balance economics by removing essential private/BYOT capabilities or silently deleting repos.

Break-even, excluding separately funded managed-service profit:

```text
N_paid ≥ (F + N_free × C_free) / (P − C_paid)
```

`F` is monthly fixed staff, tooling and platform overhead; `C_paid` includes variable infrastructure, payment, support, refund and abuse allocations. If `P ≤ C_paid`, growth cannot produce break-even under that model.

For illustration only: `F=$3,000` (a small part-time operating budget, not a sustainable full team), `N_free=10,000`, `C_free=$0.10`, `P=$4`, and the base variable cost `$2.40` require **2,500 paying seats**, rounded up. Five-seat aggregate billing lowers that illustrative threshold to **2,000 seats**. Paid conversion, retention, invoice mix, acquisition costs and actual labor are unmeasured; do not present either figure as a forecast.

## Reproduce and change assumptions

Run `bun src/tooling/unit-economics.ts`. The TypeScript source exposes verified unit rates and every hypothetical workload/payment/support input; output includes assumptions and exclusions. To use other merchant terms or measured usage, copy the output's `assumptions` object into a JSON file and run `bun src/tooling/unit-economics.ts /absolute/path/assumptions.json`. No provider calls or billing changes occur.

For scoped operational evidence, run `bun src/tooling/provider-usage.ts` with an operator-only `CLOUDFLARE_API_TOKEN` already configured in the server environment. The collector reads only the FlareGit Worker, Artifacts namespace and two confirmed sandbox applications. It bounds the time window, response size, row count and request timeout; missing, denied or truncated data is never reported as zero. Output contains sanitized totals and a receipt hash, not credentials or provider messages.

A signed-in read on October 3 covered October 2 at 15:13:54 UTC through October 3 at 15:13:54 UTC. It observed 67 Artifacts events, 2,347 Worker requests, zero Worker errors, 9,596 subrequests and about 65.01 container CPU seconds across the two applications. Memory/disk byte-seconds and transmitted bytes were also returned. These are adaptive operational aggregates for the selected resources, not billable-operation counts, per-workflow attribution, invoice reconciliation, customer-cohort costs or evidence of profitable pricing. Artifacts stored bytes, Worker CPU, DO/Workflow/R2/model charges, shared allowances and payment/support costs remain outside this receipt. Checkout remains disabled.

Default output matches the tables: light/base/heavy contribution $2.70/$1.60/−$1.10; base break-even 2,500; ten-minute container $0.021504; model $0.01075; combined 100 runs $3.2254. Set `seatsPerInvoice` to 5 to reproduce the 2,000-seat base threshold. Set `paymentAdditionalPerSeat` for measured payouts/refunds/disputes rather than treating the zero placeholder as evidence.

## Go/no-go gates

1. Instrument billable Artifacts bytes/operations, container elapsed and CPU time, model units, retries, storage retention, payment fees, and support minutes per organization. Reconcile estimates to at least two complete billed months after Artifacts billing starts; separate free/paid/managed cohorts and medians from high-percentile tails.
2. Enable a ≤$4 seat only if observed contribution supports a proposed 60% target after variable costs and planned free subsidy. This target is an internal assumption. At $4 it leaves at most $1.60 for those allocations; even the base example does not meet it. If the gate fails, reduce measured unnecessary costs or revise optional paid value/allowances; do not claim sustainability.
3. Managed prepaid products need their own positive margin after processing, failures, customer credits and uncertainty. Reconcile usage reservations, duplicate/replayed usage events and refunds before real charges. Publish storage and execution prices separately from the seat comparison.
4. Demonstrate retention/export safety, budget enforcement and clear failure states before introducing quotas. Required external checks may gate acceptance; billing/provider failures must not block browsing or review. No per-bot seat charge and no exclusive agent/CI provider requirement.
5. Revalidate official rates and payment terms before launch. Confirm fixed staffing/support needs, abuse/fraud provision, regional costs and tax handling. Do not subsidize ongoing promises with temporary beta pricing or competition credits.

**Decision:** free core/private/BYOT is the intended product boundary. The latest Team target is $3/human seat/month, not yet approved for charging; earlier $4 scenarios remain comparison arithmetic. Measured costs and funded free-user subsidy determine whether it can launch sustainably.

## Current capability and price comparison

This table audits the current checkout, not a declaration that every path has passed hosted acceptance. GitHub's verified Free baseline includes unlimited public/private repositories; its Team headline is $4/user/month for the first 12 months. Scope the comparison to the concurrent collaboration experience rather than a full GitHub feature inventory. [GitHub pricing](https://github.com/pricing)

| Capability | Current FlareGit implementation/evidence | Remaining launch gap |
| --- | --- | --- |
| Free public/private repositories | Authenticated member access provides private repositories without a paid-plan gate. `worker.ts` limits creation to 10 owned repositories, including pending imports; joined repositories do not consume this limit. | Owner-confirmed public accepted-history browsing is implemented. The owned-repository prototype limit must be disclosed; storage is not unlimited. |
| People, issues and conversations | Account profiles, repository people/contribution summaries, issues, change/candidate comments and line comments exist in API/UI. | Public contributor discovery and broad community workflows are not established by private member routes; hosted completeness is not proved by source alone. |
| Actual concurrent contributions | Separate Artifacts forks and ordinary Git pushes; agent containers/workflows; frozen participating commits and shared context. Real-Git tests exercise concurrent landings/conflicts. | Hosted concurrency, interruption recovery and large-repository latency still require workload-specific receipts; no scale claim follows from those tests. |
| Human review and durable integration | Exact candidate commit/tree/policy evidence, human approval, CAS, durable journal and transactional webhook outbox. Local workerd/SQLite fault-injection tests cover rollback/retry and stale completion. | Local runtime evidence does not prove deployed crash recovery. Keep a committed-state hosted acceptance gate. |
| Merge queue, squash and rebase | Landing lease queues integrations; optional squash preserves contributor attribution; dependent changes rebase after acceptance. | This implements specific workflows, not the full GitHub queue/rebase feature set. Conflict/decision consequences remain human-reviewable. |
| CI and external tools | Imported custom repositories can use protected customer commands or required connected application CI. External-only mode retains native Git integrity and human acceptance while skipping customer commands, preview builds, and automatic AI repair. Frozen service reports and retries have local Git/workerd coverage. | Hosted provider delivery remains unverified. No named vendor adapter or compatibility is claimed. Demo repositories retain protected business checks. |
| Optional GitHub bridge | One-way mirror after acceptance, visible errors/retry; canonical workflow remains on Artifacts. | Bidirectional synchronization and broad migration compatibility are not established. Do not require GitHub availability for browsing/review. |
| Compute limits and pricing | Source fallback defaults: Free 3/day, Pro 100/day, global 300/day. Checked-in Wrangler configuration overrides Free to 10/day and Pro to 200/day; live overrides remain unverified. Polar integration exists. | These are admission counters, not measured per-run costs or prepaid consumption. A model-backed run can make several calls, spawn parallel work or include repair; task completion/usage cannot be inferred from the count. Existing Pro billing does not establish the proposed $4 price or margins. |
| Storage and retention | Canonical history, task forks, candidate refs and evidence are preserved; storage vendor rates are known. | No billed-byte customer allowance/enforcement or complete storage-cost allocation was identified. The 10-repo cap does not bound repository/fork bytes. Safe quota enforcement and retention notices are prerequisites to charging overages. |

Audit pointers: `src/server/worker.ts` (repository cap, protected routes, external-mode refusal), `src/server/polar.ts` (3/100 defaults), `src/server/projects.ts` (300 global default and admission), `src/server/workflow.ts` (queue/squash/rebase), `tests/platform.test.ts`, `tests/sqlite-publication.test.ts`, and `tests/external-checks.test.ts`. Source defaults can differ from deployed environment values; this audit did not read production billing configuration or merchant prices.

## Provisional minimum launch caps

These are design/cost assumptions for discussion, **not implemented limits, user entitlements or approved prices**. Basic private repos and BYOT remain free; do not bill bot seats or require managed AI/CI. Keep the existing 10-repository cap candidly labeled as a prototype cap until cost evidence supports a change.

| Proposed initial boundary | Assumption and economic implication |
| --- | --- |
| Free core | At least public and private collaboration with a published small-storage allowance; model 100 MB total billed Git storage/account and 500 Artifacts operations/month for this sensitivity only. At marginal rates plus an assumed $0.075 other-infrastructure allocation, cost is $0.20/account/month before support. This is more conservative than the earlier $0.10 lightweight scenario. Public visibility exists; byte accounting must be implemented before offering this entitlement. |
| Optional ≤$4 collaboration seat | Sensitivity: 250 MB allocated storage and 1,000 Artifacts operations/human seat, $0.15 other infrastructure, $0.25 support, and $0.70 assumed Polar Starter fee. Variable cost is $1.375, contribution $2.625 (65.625%) **before free-user subsidy**. The plan buys optional organization value, not access to private/BYOT capability. Larger safe retention/storage would be separately metered. |
| Free-user subsidy | Two assumed free accounts per paying seat add $0.40 and reduce contribution to $2.225 (55.625%); this fails the proposed 60% gate. Fund the gap through a declared operating budget or demonstrate lower measured costs; do not present caps alone as sustainability. |
| Managed AI/CI | Start with zero automatically included paid compute and a small explicit prepaid trial budget only if funded. Reserve actual estimated token/resource cost before work, set hard token/time/concurrency/spend ceilings, and reconcile usage afterward. The existing 3/100/300 run counters can remain abuse/admission controls but cannot replace consumption accounting. |
| Quota recovery | Warn before reaching an allowance. Budget exhaustion may refuse new managed execution or additional stored data only after an honest recoverable state is recorded. Preserve accepted history, browsing, review, export and independent provider execution; never silently prune forks or revert a merge to fit an allowance. |

These limits trade early operating exposure against usefulness. A 100 MB free allowance is materially narrower than a claim of unlimited GitHub-equivalent hosting. Validate normal target-repository sizes and workflows before selecting any number; if useful free/private collaboration does not fit, revise the funded subsidy rather than conceal the restriction. Hosted external-CI verification, public access verification and measured storage accounting are more important launch gaps than adding unrelated GitHub features.


## October 2 sustainability review: concrete launch offering

**Recommendation, pending cost evidence and funding approval:** offer Free Git/private/BYOT collaboration with explicit prototype capacity; keep managed AI and managed CI as separately funded opt-in consumption. Do not activate a speculative $3 Team price, promise unlimited resources, or advertise organization administration/retention controls that are not implemented. Existing purpose/context, review, issues, contribution history and external checks are the product; optional higher operational allowances can become paid value only after resource accounting exists. An organization invoice should aggregate human collaborators, with no charge for outside contributors or bots. Existing checkout does not prove that this business offering is ready.

The actual configured paid product still returns unavailable/access denied; the price and merchant plan are unknown. No subscription, vendor plan, or billing configuration was changed. The delegated operating target is now $25/month. Checked-in guards reserve at most $10/month globally ($5/account) for managed envelopes and $5/month globally ($2.50/account) for native Git operation envelopes. These are conservative reservation controls for covered components, not a $25 invoice guarantee. `PAID_CHECKOUT_ENABLED=false` disables new paid checkout while Team pricing/value remain unapproved.

### Implemented guards and remaining exposure

Daily counters still permit 10 Free / 200 Pro admissions and 300 globally. Dollar reservations now gate covered managed execution separately: the managed agent envelope reserves eight calls with 120,000 input bytes plus 4,096 framing tokens and 8,192 output tokens per call, and 1,200 active container seconds. The source envelope reserves $0.439629 per managed agent. This is a conservative bound for those components, not measured task cost; verify every expensive path is covered before treating it as financial protection. The $10 global monthly envelope admits at most 22 full such reservations, with 11 under the $5 account envelope, ignoring differently sized reservations. Interrupted or uncertain consumption must not be silently released as free usage.

Native Git transport reserves $0.0012 per operation against $5 global / $2.50 account monthly envelopes. These cap admitted operation envelopes, not the provider's actual billed operations, repository byte-months, bypass paths or pre-existing activity. Browsing/review remain available when transport capacity is refused. The 10-owned-repository limit does not bound retained bytes. Storage, Workers/DO/Queues/Workflows/R2, authentication, logs, email, payment fees and staff can push the invoice above the $25 operating target. No total invoice ceiling is claimed.

Storage admission now separately reserves the provider's 1 GB maximum for every named canonical repository, import and workspace before allocation. The checked-in prototype ceiling is 32 retained repository slots globally and per account; complete stable namespace inventory is required. Distinct same-day allocations retain daily liability after confirmed deletion. Unknown outcomes retain their names, and account/project allocation fences keep deletion pending while provider creation remains uncertain. This is a conservative capacity envelope, not observed bytes, a customer allowance or proof of provider billing semantics. At $0.50/GB-month it represents up to $16 gross monthly storage allocation before shared allowances. Combined with the $10 managed pool, $5 Git-operation envelope and $5 Workers baseline, these covered conservative allocations can reach approximately $36, already above the $25 operating target; the target is not enforced as a complete invoice ceiling.

Native previews, deployment verification, repository setup, mirror requests, import inspection and integration stages also reserve funded compute before VM allocation. A standard-2 1,200-second attempt reserves $0.043008 at the published resource rates, without inventing AI tokens. Unknown usage holds its reservation. Preview failures persist, repeated reads do not restart failed builds, and an owner explicitly retries the exact current accepted commit. Expired native claims permit a new attempt only after the saved VM is confirmed stopped. These are source and local test mechanisms; hosted provider-stop and invoice reconciliation are separate evidence gates.

Repository preview serving now uses a stateless child Worker and a service-bound asset broker. Under Workers Standard pricing, an incoming asset request incurs one request charge and the combined CPU time of both Workers; the service-binding hop adds no separate request charge. R2 reads, retained build storage, and any registry reads remain additional accounting items. This does not make preview serving free or place it inside the existing container-compute reservation. Measure requests and CPU by repository, reconcile them with actual invoices, and include them in the free-cohort subsidy before finalizing paid allowances. [Workers service-binding pricing](https://developers.cloudflare.com/workers/platform/pricing/#service-bindings)

Private accepted-Git recovery separately reserves eight 512 MiB cached-bundle slots globally and two per account. This bounds that cache to 4 GiB globally before multipart uncertainty and cleanup holds; unknown uploads keep their reservation, and completed unreceipted objects are reconciled rather than uploaded twice. At the published R2 Standard storage rate, 4 GiB is approximately $0.06/month gross before shared allowances; reads, writes, Worker/DO/Workflow requests and native preparation remain additional costs. A cached download allocates no VM and requires no Git-operation envelope. Preparation is explicitly owner-requested and funded. These prototype limits are not purchased backup allowances or a complete invoice cap.

Earlier counter-only sensitivity remains available through `calculateAdmissionExposure`: 20 calls with 20,000 input and 8,192 output tokens each plus ten active container minutes gives $0.284384/admission; 300/day for 30 days gives $2,559.456 before other services. **This illustrates why counters alone were unsafe; it is neither the newly guarded entitlement nor a usage forecast.** Seven continuously running standard-2 containers over 30 days would consume $287.40096 memory/disk or $650.28096 with active CPUs. Reservations must accompany actual lifetime/output bounds and coverage audits.

### Team target sensitivity and launch boundary

Keep Free public/private Git, ordinary contributors, issues, review and BYOT. Team should buy optional additional team capacity and operational controls only when implemented. Do not charge bot/outside-contributor seats or place required external providers behind Team. Managed AI/CI credits are separate opt-in consumption, with funded trial capacity rather than unlimited included execution.

At the proposed $3 Team target, assumed Polar Starter payment is $0.65 for one seat/month. Under the existing light/base/heavy workload assumptions, contribution is $1.75 / $0.65 / −$2.05. Base break-even with assumed $3,000 fixed costs plus 10,000 free users at $0.10 is 6,154 paying seats. Five seats on one invoice lowers per-seat payment to $0.25 and base break-even to 3,810 seats. These are assumptions, not observed conversion or salary costs. A 60% contribution target at $3 permits only $1.20 of total variable allocations, before the fixed-cost bill; the base scenario costs $2.35 and fails. Do not market the $3 hypothesis as sustainable until measured allocations and the funded free cohort support it.

GitHub currently lists Free at $0 with unlimited public/private repositories and 2,000 CI minutes/month; Team lists $4/user/month for the first 12 months with 3,000 CI minutes and additional review/rules features. FlareGit's $3 proposal is a narrower price target, not equivalent included compute or complete feature parity. [GitHub pricing](https://github.com/pricing)

### First provider aggregate, not profitability proof

Read-only scoped analytics captured October 2 at 20:45 UTC cover approximately the preceding 24 hours: FlareGit's namespace reported 416 action events (27 forks, 67 pulls, 169 reads, 40 pushes, 97 token create/revoke events, six creates, ten deletes). Its Worker reported 2,837 requests, 8,885 subrequests and three errors. The two confirmed sandbox applications together reported 202.70 CPU-seconds, approximately 28.991 trillion allocated memory byte-seconds, 54.000 trillion allocated disk byte-seconds, and 372,999 transmitted bytes. Adaptive data may be sampled. These are scoped operational aggregates, not an invoice, a customer cohort or cost per successful task.

The receipt exposes no Artifacts stored-byte/GB-month measurement, no model billing, no Worker CPU/DO/Queues/Workflows/R2 bill, no authentication/payment/support costs, and no attribution of shared allowances. Do not multiply one development-day workload into a customer forecast or treat event count as an exact billable-operation count. Original sanitized receipt: `/tmp/flaregit-provider-usage-1790973908806.json`; preserve aggregate evidence in this document without credentials or other project identifiers. Full invoice reconciliation remains required.

### Clef is an optional costed experiment

Official rates are Clef $0.24/million input tokens and Clef-flash $0.09/million; both list a 65,536-token context. A text-only 2,000-token decision therefore costs $0.00048 or $0.00018; 100,000 such decisions cost $48 or $18 respectively, excluding retries/platform overhead. These are input assumptions, not measured FlareGit savings. [Clef](https://developers.cloudflare.com/workers-ai/models/clef/), [Clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)

Evaluate bounded review routing or issue categorization against labeled human decisions, with confidence/abstention and cache-by-context digest. Do not call it on every poll, use it to approve merges/authorization, or claim it replaces Git conflict detection. It earns inclusion only if observed quality and avoided expensive calls exceed its own cost; deterministic routing remains available without it. No live Clef experiment or saving is claimed.

### Authentication and the omitted bill

Clerk currently includes 50,000 monthly retained users per application and 100 monthly retained organizations, with usage above included thresholds billed separately. That is authentication usage, not a new credit for each repository/customer, and does not make support/abuse/storage free. Our actual Clerk plan, add-ons, invoice and organization usage remain unverified; no new Clerk organization feature is implied. [Clerk pricing](https://clerk.com/pricing), [2026 plan change](https://clerk.com/changelog/2026-02-05-new-plans-more-value)

Keep DO/Queues/Workflows/R2/observability/email and auth within a measured `otherInfrastructure` allocation until invoices can be reconciled. This placeholder explicitly does not prove those costs are small. A $4 collaboration price with a 60% proposed contribution target has at most $1.60 for **all** variable costs and free-cohort subsidy. The base example consumes $2.40 before subsidy, so the present model fails that gate. Revenue growth alone cannot repair negative unit contribution. The next launch gate is complete coverage and reconciliation of the implemented guards, byte accounting and a funded free cohort, followed by actual billed evidence after Artifacts billing begins October 14—not a prettier pricing page.


### Retained preview and evidence admission — October 3

New preview manifests reserve at most 512 MiB globally and 128 MiB per owner; each manifest is at most 64 MiB with assets no larger than 16 MiB. Evidence copies have a separate 64 MiB global / 16 MiB owner pool and a 1 MiB per-copy limit. Unknown uploads keep their byte and writer reservations. Confirmed owner-requested cleanup records provider absence and retirement before releasing capacity. These controls do not adopt pre-existing R2 objects or cap request charges, SQL storage, other provider activity, or the complete invoice.

The two new pools total 576 MiB of funded retained data. At the previously cited $0.015/GB-month rate, their gross storage allocation is approximately $0.009/month before allowances and additional requests. This arithmetic is not a measured bill or customer forecast. It does not change the existing approximately $36 covered-envelope comparison or validate the $3 Team proposal.

Storage exhaustion is distinct from build failure. Owner retry becomes available only after a fresh read-only scope/headroom check; rebuilding must still reserve its complete immutable manifest. Unfinished upload receipts require reconciliation rather than another funded VM attempt. Older repositories without dispatch tracking remain explicitly pending legacy provider/writer reconciliation on deletion; no completed cleanup or zero retained bytes is claimed for them.

Import history inspection now saves bounded metadata chunks rather than repeating a full capture after interruption. Each actual destination-read group reserves the existing eight-operation Git envelope before provider calls; interrupted or uncertain reads retain that reservation. Source workspaces use funded native attempts, and confirmed resume gets a new attempt while retaining the same inspection and pinned head. The per-inspection serialized metadata envelope is 8 MiB with at most 25,000 commits per side and 32 inspections per repository. These are prototype admission limits, not a complete invoice ceiling, unlimited history support, or measured hosted billing evidence.

Repository browsing now reserves provider attempts in the same $5 global / $2.50 per-owner Git-operation ceiling. Inside that ceiling, $2 global / $1 per owner is reserved for browsing; optional transport and import inspection use the remaining category allowance. Existing holds remain charged, so legacy spending can still constrain available capacity. Immutable objects are reused within a request, with fresh authorization on hits; this is not a persistent private cache. Tree, blob, public-history and manual-readiness reads are admitted before provider calls. Work, response and deadline bounds return explicit incomplete/unavailable errors, rather than an empty successful diff. These controls do not cap all Worker/DO requests or prove a complete invoice limit.

Repository, review-check, activity, mirror and webhook panels now pause automatic refresh while the document is hidden, avoid overlapping reads, and back off after failures. Focus and manual refresh request current data; refresh after a mutation waits for a new read rather than reusing an earlier request. Active collaboration keeps its existing cadence, while passive repository tabs refresh less often. Controller tests verify request scheduling; rendered synthetic fixtures verify stale-response suppression and scoped UI updates. These are implementation/test observations, not measured hosted invoice savings.
