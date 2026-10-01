# FlareGit Technical Architecture

> **Cloudflare-Native Autonomous Git Platform**  
> Custom Domain: [flaregit.com](https://flaregit.com)

---

## 1. Executive Architectural Overview

FlareGit is designed from first principles for the **Cloudflare Developer Platform**. It removes the serialization bottleneck of traditional Git pull-request queues without sacrificing behavioral correctness.

### Core Architectural Invariant
> **The exact commit accepted into canonical `main` and published to live previews MUST be the identical cryptographic tree that passed independent protected verification in an isolated sandbox.**

No human or agent commit is ever merged directly into canonical history without passing through candidate composition, bounded repair, independent verification, and a transactional Compare-And-Swap (CAS) reservation.

---

## 2. Cloudflare Service Topology

FlareGit utilizes Cloudflare's complete infrastructure stack, mapping each capability to its native Cloudflare primitive:

```
+----------------------------------------------------------------------------------------------------+
|                                      EDGE INGRESS & ROUTING                                        |
|  flaregit.com  •  Cloudflare Workers  •  Static Asset Binding (ASSETS)  •  Cloudflare Access       |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                                    AUTHORITATIVE CONTROL PLANE                                     |
|  Cloudflare Durable Objects + Embedded SQLite (RepositoryController)                               |
|  - Authoritative Project State (Active Requirements, Accepted Commits, History)                    |
|  - CAS Ref Publication Locks (Atomic update-ref with expected-base validation)                     |
|  - Real-Time WebSockets & Server-Sent Events (SSE) Client Broadcast                                 |
+------------------------------------+-----------------------------------+---------------------------+
                                     │                                   │
                                     ▼                                   ▼
+------------------------------------+-----------+   +-------------------+---------------------------+
|               ORCHESTRATION ENGINE             |   |                 EVENT INGESTION               |
|  Cloudflare Workflows                          |   |  Cloudflare Queues                            |
|  - Step 1: Detect Compatibility (Diff Tree)    |   |  - Async Git Push Events                      |
|  - Step 2: Native Git Composition in Sandbox   |   |  - Checkpoint Ingestion & Event Deduplication |
|  - Step 3: Bounded Repair (Cloudflare AI)      |   |  - Ref Reconciliation                         |
|  - Step 4: Protected Independent Verification  |   +-----------------------------------------------+
|  - Step 5: Exact-Version CAS Acceptance        |
+------------------------------------+-----------+
                                     │
                                     ▼
+----------------------------------------------------------------------------------------------------+
|                                      EXECUTION & REPAIR PLANE                                      |
|                                                                                                    |
|  +--------------------------------+  +-------------------------------+  +-----------------------+  |
|  |      Cloudflare Sandboxes      |  |     Cloudflare Workers AI     |  |  Cloudflare Artifacts |  |
|  | Containerized Linux execution  |  | Model: DeepSeek-R1 Distill    |  | Canonical & Task Git  |  |
|  | Native git clone, merge, diff  |  | Fallback: Llama 3.1 8B FP8    |  | Repositories via HTTP |  |
|  | Isolated test runner sandbox   |  | Routed via AI Gateway         |  | Real Git commits & ref|  |
|  +--------------------------------+  +-------------------------------+  +-----------------------+  |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                                     IMMUTABLE AUDIT & EVIDENCE                                     |
|  Cloudflare R2 Bucket (flaregit-evidence)                                                           |
|  - Test bundle fingerprints and toolchain digests                                                  |
|  - Execution logs and candidate build artifacts                                                    |
|  - JSON publication journal records                                                                |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. Data Storage & State Machine

### Authoritative SQLite State (Durable Object)
Each project repository is governed by an authoritative Durable Object running transactional SQLite (`this.ctx.storage.sql`):

1. **`project_meta`**: Authoritative repository head, policy version, and active requirement IDs.
2. **`tasks`**: Active human and agent tasks, workspace branches, and checkpoint sequences.
3. **`candidates`**: Candidate generation records, composition methods, and repair attempts.
4. **`evidence`**: Cryptographic test verification reports with suite item results.
5. **`publication_journal`**: CAS transaction log tracking the 3-state transition:
   - `PREPARED`: Candidate verified; CAS lock requested against `expectedHead`.
   - `REF_UPDATED`: Git ref atomically pointed to candidate commit.
   - `ACCEPTED`: Authoritative state updated; event broadcast to live subscribers.

---

## 4. Cloudflare Workers AI Model Strategy

FlareGit delegates integration repair and conflict reasoning to **Cloudflare Workers AI**:

- **Primary Reasoning Model**: `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`
  - High mathematical and programmatic reasoning capacity.
  - Successfully resolves multi-variable pricing equations and module contract mismatches.
- **Fast Instruct Model**: `@cf/meta/llama-3.1-8b-instruct-fp8`
  - Low-latency inference for prompt generation and candidate diff summarization.
- **AI Gateway Integration**:
  - Telemetry: Latency, prompt tokens, completion tokens recorded per repair attempt.
  - Zero external third-party model dependencies.

---

## 5. Security & Isolation Boundaries

1. **Workspace Isolation**: Contributor tasks run in isolated repository forks. They cannot mutate canonical `main` directly.
2. **Execution Sandboxing**: All Git merges and verification tests execute within ephemeral Cloudflare Sandboxes. Network egress is restricted to local package artifacts.
3. **Test Immutability**: The verification test suite is bundled and hashed (`testBundleDigest`). Contributors cannot modify verification assertions in their task branch to manufacture a passing build.
4. **CAS Protection**: If another candidate lands while a generation is undergoing verification, the publication step detects that `currentCanonicalHead !== expectedAcceptedBase`, marks the candidate `stale`, and triggers automatic recomposition against the new base.
