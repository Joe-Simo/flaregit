# FlareGit

> **“Work in parallel. Integration happens automatically.”**  
> Custom domain: [flaregit.com](https://flaregit.com)  
> Built for the **Cloudflare Next-Gen Git Platform Competition** (October 2026).

---

## What is FlareGit?

Traditional Git platforms force developers into a serialized merge queue or painful manual conflict resolution rituals. When multiple humans and AI agents write code concurrently, branches drift, textual merges collide, and worse—syntactically clean merges silently corrupt application behavior.

**FlareGit** is an owner-operated, Git-compatible platform where contributors never manually merge. Instead, FlareGit:
1. **Continuously combines contributors’ work** in isolated Cloudflare Sandboxes.
2. **Detects textual, semantic, and dependency contract conflicts** before code lands.
3. **Autonomously repairs compatible changes** using Cloudflare Workers AI.
4. **Independently verifies the result** against versioned behavioral requirements.
5. **Accepts only the exact version that passed verification** via CAS update-ref operations on Cloudflare Durable Objects and Artifacts.
6. **Preserves stable applications during contradictions**, presenting exactly one clear product question with concrete price trade-offs.

---

## Cloudflare-Native Architecture

FlareGit is built end-to-end on Cloudflare’s developer platform:

```
                  +----------------------------------------------+
                  |               Web / Browser UI               |
                  |  React 19 + Tailwind CSS + shadcn/ui (Vite)  |
                  +----------------------+-----------------------+
                                         |
                                         v
                         +-------------------------------+
                         |   Cloudflare Workers / API    |
                         |  (flaregit.com / ASSETS SPA)  |
                         +---------------+---------------+
                                         |
            +----------------------------+----------------------------+
            |                            |                            |
            v                            v                            v
+-----------------------+    +-----------------------+    +-----------------------+
|  Cloudflare Durable   |    |  Cloudflare Workflows |    |   Cloudflare Queues   |
|   Objects + SQLite    |    | Multi-Step Pipeline:  |    |  Async Git Pushes &   |
|  Authoritative State, |    | Detect -> Compose ->  |    |  Checkpoint Ingestion |
|  CAS Ref Locks, SSE   |    | Repair -> Verify ->   |    +-----------------------+
+-----------+-----------+    | CAS Publication       |
            |                +-----------+-----------+
            |                            |
            +----------------------------+
                                         |
            +----------------------------+----------------------------+
            |                            |                            |
            v                            v                            v
+-----------------------+    +-----------------------+    +-----------------------+
|  Cloudflare Artifacts |    |  Cloudflare Sandboxes |    | Cloudflare Workers AI |
| Canonical & Task Git  |    | Containerized Linux   |    | Models: DeepSeek-R1 / |
| Repositories (HTTP)   |    | Git, Build & Verifier |    | Llama 3.1 via Gateway |
+-----------------------+    +-----------------------+    +-----------------------+
                                         |
                                         v
                             +-----------------------+
                             |     Cloudflare R2     |
                             |   Immutable Evidence, |
                             |   Digests & Artifacts |
                             +-----------------------+
```

| Cloudflare Service | Role in FlareGit |
|---|---|
| **Cloudflare Workers** | Edge API, routing, WebSocket/SSE streaming, and static UI delivery |
| **Cloudflare Artifacts** | Canonical Git repositories and isolated per-task workspaces |
| **Cloudflare Sandboxes** | Secure containerized Linux execution for native Git commands and test suites |
| **Cloudflare Durable Objects + SQLite** | Authoritative project state, CAS ref publication locks, and event deduplication |
| **Cloudflare Workflows** | Resilient multi-step pipeline orchestration with step retries and timeouts |
| **Cloudflare Queues** | Asynchronous Git push event ingestion and checkpoint queuing |
| **Cloudflare R2** | Immutable storage for test bundles, build digests, and cryptographic audit evidence |
| **Cloudflare Workers AI** | Autonomous repair synthesis using `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` |
| **Cloudflare AI Gateway** | Observability, token usage tracking, and rate limit management |

---

## The Three Acts of Autonomous Integration

FlareGit is evaluated against three core concurrency challenges:

### Act I: Textual Conflict & Autonomous Repair
* Two agents edit `src/pricing.ts` concurrently:
  * **Agent A**: Implements 15% group discount for 4+ tickets ($136 for 4 $40 tickets).
  * **Agent B**: Implements refundable tickets guarantee (+$5 surcharge per ticket).
* **Native Git**: Fails with 6 overlapping hunk conflict markers.
* **FlareGit**: Freezes candidate generation, invokes Cloudflare Workers AI for bounded repair, verifies the combined result ($156 total), and accepts the exact verified commit.

### Act II: Clean Merge, Broken Behavior (Semantic Conflict)
* **Agent A**: Migrates catalog price representation to integer cents (4000 cents).
* **Agent B**: Adds itemized receipt line items expecting dollar floats.
* **Native Git**: Merges cleanly without conflict markers—silently producing a broken checkout total ($16,020 instead of $156).
* **FlareGit**: Protected independent verifier catches the behavioral failure, triggers Round 2 repair to normalize units across module boundaries, verifies, and accepts the exact repaired build.

### Act III: Incompatible Requirements & Human Product Decision
* Contributor A requires the group discount apply to the whole order ($153).
* Contributor B specifies the refund fee is non-discountable ($156).
* **FlareGit**: Automatically detects the business logic contradiction, pauses safely, preserves the last accepted application on canonical `main` (zero downtime), and asks the product owner **one clear question** with concrete price calculations.
* Upon answer, FlareGit immediately synthesizes, verifies, and publishes the result without manual merge.

---

## 20-Run Evaluation Benchmark

Rigorous evaluation comparing Native Git, Mergiraf structural merge, and FlareGit:

| Engine | Runs | Conflict Resolution | Semantics Caught | Contracts Preserved | Unverified Landed | Contradiction Safe |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Native Git** | 20 | 0% | 0% | 15% | 85% | 0% |
| **Mergiraf Baseline** | 20 | 40% | 0% | 30% | 70% | 0% |
| **FlareGit (Autonomous)** | **20** | **100%** | **100%** | **100%** | **0%** | **100%** |

### Key Findings:
1. **Zero Unverified Landings**: FlareGit enforces cryptographic verification digests prior to CAS acceptance. No commit reaches canonical `main` without 5/5 passing test contracts.
2. **Semantic Protection**: Syntactic tools (Git, Mergiraf) fail to detect cross-file unit and contract bugs. FlareGit catches 100% of semantic regressions in isolated verification sandboxes.
3. **Contradiction Safety**: FlareGit never silently drops a feature or guesses on conflicting business rules.

---

## Quick Start & Verification

### Prerequisites
- [Bun](https://bun.sh) (v1.2+)
- Git 2.40+

### Installation
```bash
git clone https://github.com/josephsimo/flaregit.git
cd flaregit
bun install
```

### Run Checks & Tests
```bash
# Run unit tests
bun test

# Run strict TypeScript check
bun run typecheck

# Build production assets
bun run build

# Run the complete 8-point Feasibility Spike (Acts I, II, III + fault tests)
bun run spike

# Run the 20-Run Evaluation Benchmark
bun run eval
```

### Launch Web Dashboard
```bash
# Start local API server & Vite frontend
bun run server &
bun run dev
```
Navigate to `http://localhost:5173` to explore the interactive dashboard and live preview.

---

## Competition Compliance & Submission Truth

- **Competition**: Cloudflare "Build the Next-Gen Git Platform" Competition.
- **Deadline**: October 14, 2026, 11:59 PM PDT.
- **Final Presentation**: Cloudflare Connect, San Francisco (October 21, 2026).
- **Core Invariant**: The accepted Git commit and live preview correspond to the exact version that passed independent protected verification.
- **Zero Third-Party Hosted Dependencies**: 100% Cloudflare-native control plane, Git storage, compute sandboxes, and AI inference.

---

## License
MIT License. Copyright (c) 2026 FlareGit Contributors.
