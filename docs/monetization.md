# Preliminary monetization economics

Verified October 2, 2026. This is a proposal and an arithmetic model, not deployed pricing, measured customer usage, or a profitability claim. No billing changes are authorized by this document.

The configured Polar product's actual subscription price remains unverified. The public `/pricing` reader is restricted to the server-configured product and publishes only validated fixed subscription amount/currency/interval/tax behavior. A private Polar catalog product may be the configured checkout target; this does not authorize publishing its names, organization, metadata or credentials. A successful projection establishes that configured subscription price, not per-seat pricing, feature parity or sustainable margins. The first reported live read returned an unavailable state, so the $4 figure below remains a hypothesis. HTTP classifications reveal only access denied, not found, rate limited, rejected request or unavailable; they never reveal provider response bodies. [Polar Get Product scopes/schema](https://polar.sh/docs/api-reference/products/get), [API versioning](https://polar.sh/docs/api-reference/2026-04/versioning)

## Product and pricing proposal

Keep core Git collaboration, basic private repositories, contribution history, review, and bring-your-own tools/agents/AI/CI free. Outside contributors and bots must not create billable seats. Provider subscriptions remain the customer's choice; a GitHub bridge is optional.

Explore an optional collaboration plan at **at most $4 per human seat/month**, contingent on measured costs. Paid value could include organization administration, retention controls, and operational reporting; it must not make private repositories or external providers premium-only. GitHub currently lists Free with unlimited public/private repositories and Team at $4/user/month, qualified on its pricing page as the first 12 months. This establishes a headline comparison, not equal features or lower total workload cost. Recheck the comparison before launch. [GitHub pricing](https://github.com/pricing)

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

Default output matches the tables: light/base/heavy contribution $2.70/$1.60/−$1.10; base break-even 2,500; ten-minute container $0.021504; model $0.01075; combined 100 runs $3.2254. Set `seatsPerInvoice` to 5 to reproduce the 2,000-seat base threshold. Set `paymentAdditionalPerSeat` for measured payouts/refunds/disputes rather than treating the zero placeholder as evidence.

## Go/no-go gates

1. Instrument billable Artifacts bytes/operations, container elapsed and CPU time, model units, retries, storage retention, payment fees, and support minutes per organization. Reconcile estimates to at least two complete billed months after Artifacts billing starts; separate free/paid/managed cohorts and medians from high-percentile tails.
2. Enable a ≤$4 seat only if observed contribution supports a proposed 60% target after variable costs and planned free subsidy. This target is an internal assumption. At $4 it leaves at most $1.60 for those allocations; even the base example does not meet it. If the gate fails, reduce measured unnecessary costs or revise optional paid value/allowances; do not claim sustainability.
3. Managed prepaid products need their own positive margin after processing, failures, customer credits and uncertainty. Reconcile usage reservations, duplicate/replayed usage events and refunds before real charges. Publish storage and execution prices separately from the seat comparison.
4. Demonstrate retention/export safety, budget enforcement and clear failure states before introducing quotas. Required external checks may gate acceptance; billing/provider failures must not block browsing or review. No per-bot seat charge and no exclusive agent/CI provider requirement.
5. Revalidate official rates and payment terms before launch. Confirm fixed staffing/support needs, abuse/fraud provision, regional costs and tax handling. Do not subsidize ongoing promises with temporary beta pricing or competition credits.

**Decision:** free core/private/BYOT is the intended product boundary. A ≤$4 collaboration seat is a pricing hypothesis, not yet approved for charging. Measured costs and funded free-user subsidy determine whether it can launch sustainably.

## Current capability and price comparison

This table audits the current checkout, not a declaration that every path has passed hosted acceptance. GitHub's verified Free baseline includes unlimited public/private repositories; its Team headline is $4/user/month for the first 12 months. Scope the comparison to the concurrent collaboration experience rather than a full GitHub feature inventory. [GitHub pricing](https://github.com/pricing)

| Capability | Current FlareGit implementation/evidence | Remaining launch gap |
| --- | --- | --- |
| Free public/private repositories | Authenticated member access provides private repositories without a paid-plan gate. `worker.ts` limits repository creation to 10 registered repositories/account, including Pro. | No public-repository visibility/browsing policy was found in the source audit. Public open-source access and the 10-repo distinction must be resolved or disclosed before claiming GitHub-equivalent free hosting. |
| People, issues and conversations | Account profiles, repository people/contribution summaries, issues, change/candidate comments and line comments exist in API/UI. | Public contributor discovery and broad community workflows are not established by private member routes; hosted completeness is not proved by source alone. |
| Actual concurrent contributions | Separate Artifacts forks and ordinary Git pushes; agent containers/workflows; frozen participating commits and shared context. Real-Git tests exercise concurrent landings/conflicts. | Hosted concurrency, interruption recovery and large-repository latency still require workload-specific receipts; no scale claim follows from those tests. |
| Human review and durable integration | Exact candidate commit/tree/policy evidence, human approval, CAS, durable journal and transactional webhook outbox. Local workerd/SQLite fault-injection tests cover rollback/retry and stale completion. | Local runtime evidence does not prove deployed crash recovery. Keep a committed-state hosted acceptance gate. |
| Merge queue, squash and rebase | Landing lease queues integrations; optional squash preserves contributor attribution; dependent changes rebase after acceptance. | This implements specific workflows, not the full GitHub queue/rebase feature set. Conflict/decision consequences remain human-reviewable. |
| CI and external tools | Imported custom repositories can use protected customer commands or required connected application CI. External-only mode retains native Git integrity and human acceptance while skipping customer commands, preview builds, and automatic AI repair. Frozen service reports and retries have local Git/workerd coverage. | Hosted provider delivery remains unverified. No named vendor adapter or compatibility is claimed. Demo repositories retain protected business checks. |
| Optional GitHub bridge | One-way mirror after acceptance, visible errors/retry; canonical workflow remains on Artifacts. | Bidirectional synchronization and broad migration compatibility are not established. Do not require GitHub availability for browsing/review. |
| Compute limits and pricing | Source defaults: Free 3 model-backed runs/day, Pro 100/day, global 300/day; environment overrides and a run kill switch. Polar integration exists. | These are admission counters, not measured per-run costs or prepaid consumption. A model-backed run can make several calls, spawn parallel work or include repair; task completion/usage cannot be inferred from the count. Existing Pro billing does not establish the proposed $4 price or margins. |
| Storage and retention | Canonical history, task forks, candidate refs and evidence are preserved; storage vendor rates are known. | No billed-byte customer allowance/enforcement or complete storage-cost allocation was identified. The 10-repo cap does not bound repository/fork bytes. Safe quota enforcement and retention notices are prerequisites to charging overages. |

Audit pointers: `src/server/worker.ts` (repository cap, protected routes, external-mode refusal), `src/server/polar.ts` (3/100 defaults), `src/server/projects.ts` (300 global default and admission), `src/server/workflow.ts` (queue/squash/rebase), `tests/platform.test.ts`, `tests/sqlite-publication.test.ts`, and `tests/external-checks.test.ts`. Source defaults can differ from deployed environment values; this audit did not read production billing configuration or merchant prices.

## Provisional minimum launch caps

These are design/cost assumptions for discussion, **not implemented limits, user entitlements or approved prices**. Basic private repos and BYOT remain free; do not bill bot seats or require managed AI/CI. Keep the existing 10-repository cap candidly labeled as a prototype cap until cost evidence supports a change.

| Proposed initial boundary | Assumption and economic implication |
| --- | --- |
| Free core | At least public and private collaboration with a published small-storage allowance; model 100 MB total billed Git storage/account and 500 Artifacts operations/month for this sensitivity only. At marginal rates plus an assumed $0.075 other-infrastructure allocation, cost is $0.20/account/month before support. This is more conservative than the earlier $0.10 lightweight scenario. Public visibility and byte accounting must be implemented before offering this entitlement. |
| Optional ≤$4 collaboration seat | Sensitivity: 250 MB allocated storage and 1,000 Artifacts operations/human seat, $0.15 other infrastructure, $0.25 support, and $0.70 assumed Polar Starter fee. Variable cost is $1.375, contribution $2.625 (65.625%) **before free-user subsidy**. The plan buys optional organization value, not access to private/BYOT capability. Larger safe retention/storage would be separately metered. |
| Free-user subsidy | Two assumed free accounts per paying seat add $0.40 and reduce contribution to $2.225 (55.625%); this fails the proposed 60% gate. Fund the gap through a declared operating budget or demonstrate lower measured costs; do not present caps alone as sustainability. |
| Managed AI/CI | Start with zero automatically included paid compute and a small explicit prepaid trial budget only if funded. Reserve actual estimated token/resource cost before work, set hard token/time/concurrency/spend ceilings, and reconcile usage afterward. The existing 3/100/300 run counters can remain abuse/admission controls but cannot replace consumption accounting. |
| Quota recovery | Warn before reaching an allowance. Budget exhaustion may refuse new managed execution or additional stored data only after an honest recoverable state is recorded. Preserve accepted history, browsing, review, export and independent provider execution; never silently prune forks or revert a merge to fit an allowance. |

These limits trade early operating exposure against usefulness. A 100 MB free allowance is materially narrower than a claim of unlimited GitHub-equivalent hosting. Validate normal target-repository sizes and workflows before selecting any number; if useful free/private collaboration does not fit, revise the funded subsidy rather than conceal the restriction. Hosted external-CI verification, public access and measured storage accounting are more important launch gaps than adding unrelated GitHub features.
