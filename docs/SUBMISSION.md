# Cloudflare Competition Submission Package

> **Competition**: Build the Next-Generation Git Platform on Cloudflare  
> **Official Deadline**: October 14, 2026 at 11:59 PM PDT  
> **Winners Presentation**: Cloudflare Connect, San Francisco (October 21, 2026)  
> **Project Name**: FlareGit  
> **Custom Domain**: [flaregit.com](https://flaregit.com)

---

## 1. Submission Form Field Drafts

### Project Title
`FlareGit: Work in parallel. Integration happens automatically.`

### Short Description (under 250 characters)
`An autonomous, owner-operated Git platform where humans and AI agents work concurrently. Textual & semantic conflicts are automatically repaired via Cloudflare Workers AI and verified before exact-version CAS acceptance.`

### Full Architecture & Cloudflare Integration Overview
```
FlareGit is built 100% on the Cloudflare Developer Platform:
- Cloudflare Workers: High-speed edge control plane, REST/RPC API, Server-Sent Events (SSE), and static SPA delivery.
- Cloudflare Artifacts: Authoritative canonical Git repository and isolated per-task workspaces with token-based access.
- Cloudflare Sandboxes: Secure containerized Linux execution running native Git operations (clone, fetch, merge, commit) and cleanroom test runs.
- Cloudflare Durable Objects + SQLite: Single-point-of-truth project state, CAS ref publication locks, and event deduplication.
- Cloudflare Workflows: Durable multi-step pipeline orchestration (Detect -> Compose -> Repair -> Verify -> Accept).
- Cloudflare Queues: Asynchronous Git push event ingestion and checkpoint queuing.
- Cloudflare R2: Immutable verification evidence, test bundles, digests, and built artifacts.
- Cloudflare Workers AI: Autonomous code repair using @cf/deepseek-ai/deepseek-r1-distill-qwen-32b.
- Cloudflare AI Gateway: Telemetry, token usage tracking, and rate limit management.
```

### Video Demonstration Link
`[USER_TO_SUPPLY_FINAL_VIDEO_URL]` (Follows `docs/DEMO_SCRIPT.md`)

### Open Source Repository Mirror
`[USER_TO_SUPPLY_PUBLIC_GITHUB_MIRROR_URL]` (Licensed under MIT)

---

## 2. Competition Judging Criteria Alignment

| Judging Criterion | FlareGit Implementation Evidence |
|---|---|
| **Novelty & Innovation** | Eliminates manual merging and serialized queues through continuous candidate composition, contract-aware bounded repair, and cryptographic verification digests. |
| **Cloudflare Platform Depth** | Uses 9 native Cloudflare services (Workers, Artifacts, Sandboxes, Durable Objects, Workflows, Queues, R2, Workers AI, AI Gateway) as core architectural components. |
| **Multi-Agent Concurrency** | Real concurrent coding agents (`RuntimeCodingAgent`) perform parallel file edits and independent Git pushes in isolated workspaces. |
| **Technical Correctness & Safety** | Core Invariant: Only the exact commit that passed protected verification is published. Zero unverified landings; CAS stale-base prevention; 100% contradiction safety. |
| **Production Polish & UX** | Real-time React 19 dashboard with Tailwind CSS, shadcn/ui, live interactive preview, status banner, evidence drawer, and 1-click product decision modal. |

---

## 3. Pre-Submission Checklist

- [x] Canonical Git storage runs on Cloudflare Artifacts
- [x] Zero third-party hosted dependencies (no AWS, GCP, Vercel, Supabase)
- [x] AI inference defaults to Cloudflare Workers AI (`@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`)
- [x] Act I (Text conflict & repair) experimentally proven (`bun run spike`)
- [x] Act II (Semantic units mismatch caught & repaired) experimentally proven (`bun run spike`)
- [x] Act III (Contradictory requirements & human product decision) experimentally proven (`bun run spike`)
- [x] Second repository tested and verified domain-agnostic (`tests/second-repo.test.ts`)
- [x] 20-Run evaluation benchmark matrix generated (`bun run eval`)
- [x] Strict TypeScript check passes (`bun run typecheck`)
- [x] All unit and integration tests pass (`bun test`)
- [x] Production web bundle builds cleanly (`bun run build`)
- [x] MIT License and dependency notices included
- [ ] User authorization for public mirror creation and video upload
