# FlareGit Competition Demonstration Script

> **Video Presentation & Live Judges Walkthrough**  
> Product Domain: [flaregit.com](https://flaregit.com)  
> Cloudflare "Build the Next-Gen Git Platform" Competition

---

## Video Timeline (Under 4 Minutes)

### 0:00 - 0:30 | The Core Problem & Product Promise
- **Visual**: Show traditional Git merge conflict hell (split screens with `<<<<<<< HEAD`, failing CI queues, blocked developers).
- **Voiceover**:
  > “Modern engineering teams are deploying dozens of AI coding agents alongside human developers. But today's Git platforms weren't built for concurrent contributors—they force us into serialized queues or painful manual conflict resolution rituals.
  > 
  > This is **FlareGit**. Our promise is simple: **Work in parallel. Integration happens automatically.**
  > 
  > FlareGit is built 100% on Cloudflare's developer platform: Workers, Artifacts, Sandboxes, Durable Objects, Workflows, Queues, R2, and Workers AI.”

---

### 0:30 - 1:15 | Act I: Parallel Text Conflict & Workers AI Repair
- **Action**: In the FlareGit web UI, click **Act I: Text Conflict**.
- **Visual**:
  - The **Status Banner** illuminates in orange: `INTEGRATING: Analyzing compatibility & composing candidate...`
  - In the **Parallel Workspaces** panel, observe **Agent A** (implementing 15% group discount) and **Agent B** (implementing refundable protection guarantee) writing concurrently to `src/pricing.ts`.
  - Notice the **Repair Badge**: `WORKERS AI REPAIR: Invoking DeepSeek-R1 Distill for Round 1 synthesis`.
  - The **Live Preview** updates instantly with commit `425f717`.
- **Voiceover**:
  > “In Act I, two agents make conflicting edits to the same pricing function. Standard Git fails with six overlapping conflict markers.
  > 
  > FlareGit freezes the candidate generation, passes the conflict diff and behavioral specifications to Cloudflare Workers AI, and synthesizes a compatible implementation that preserves both features.
  > 
  > In an isolated Cloudflare Sandbox, the protected verifier confirms both features work together ($156 total), and our Durable Object executes an atomic CAS commit to canonical main.”

---

### 1:15 - 2:00 | Act II: Clean Merge, Broken Behavior (Semantic Bug)
- **Action**: Click **Act II: Semantic Conflict**.
- **Visual**:
  - Show the diff where Agent A changes ticket catalog prices to integer cents (`4000`), while Agent B adds receipt items expecting float dollars.
  - Show Git merge exiting code 0 (syntactically clean merge).
  - The Status Banner turns blue: `PROTECTED VERIFICATION: Test failed: checkout total calculated $16,020.00!`.
  - Show Round 2 autonomous repair normalizing units.
  - New verified commit accepted and displayed in the live application.
- **Voiceover**:
  > “Now observe the most dangerous failure in software engineering: the clean merge that breaks application behavior.
  > 
  > Agent A migrated catalog prices to integer cents; Agent B added receipt line items. Standard Git merges cleanly without warnings—silently billing customers sixteen thousand dollars!
  > 
  > But FlareGit never accepts code based on syntax alone. Our protected verification engine catches the units mismatch in an isolated sandbox, triggers autonomous repair, re-verifies, and lands the repaired build.”

---

### 2:00 - 2:50 | Act III: Contradictory Requirements & Human Product Decision
- **Action**: Click **Act III: Contradiction**.
- **Visual**:
  - Status Banner turns purple: `DECISION REQUIRED: Contradictory business rules detected`.
  - The **Product Decision Modal** pops up.
  - Highlight the key detail: **The Live Preview application remains completely stable at the last accepted commit.**
  - Show the two concrete choices:
    - **Option 1**: Apply discount only to base tickets ($156.00).
    - **Option 2**: Apply discount to both tickets and surcharge ($153.00).
  - Click **Option 1 (Recommended)** and click **Apply Choice & Auto-Integrate**.
  - Modal closes, pipeline verifies, and canonical HEAD advances automatically.
- **Voiceover**:
  > “When requirements genuinely contradict each other, an AI shouldn't guess, and a platform shouldn't silently drop a feature.
  > 
  > FlareGit detects the contradiction, preserves zero downtime on canonical main, and asks the product owner one clear question with concrete price trade-offs.
  > 
  > Once answered, FlareGit automatically supersedes the rejected requirement, verifies the application, and publishes the result. Never manually merge.”

---

### 2:50 - 3:30 | Evidence Drawer & CAS Publication Journal
- **Action**: Click **Audit Evidence** in the top navigation.
- **Visual**:
  - The Evidence Drawer slides out from the right.
  - Review the **5/5 Protected Test Contracts**.
  - Show the **SHA-256 test bundle digest**, toolchain fingerprint, and built output digest.
  - Switch to the **CAS Journal** tab: show `PREPARED -> REF_UPDATED -> ACCEPTED` state transitions and stale base prevention.
- **Voiceover**:
  > “Every accepted version is backed by immutable cryptographic evidence in Cloudflare R2: test bundle digests, toolchain versions, and execution manifests.
  > 
  > Our SQLite-backed Durable Object enforces transactional Compare-And-Swap locks, ensuring race-free concurrency and zero unverified landings.”

---

### 3:30 - 3:55 | Conclusion & Cloudflare Platform Wrap-up
- **Visual**: Zoom out to show the full dashboard, active preview, and benchmark matrix from `bun run eval`.
- **Voiceover**:
  > “FlareGit is not a concept or a thin wrapper. It is a complete, working platform built end-to-end on Cloudflare: Workers, Artifacts, Sandboxes, Durable Objects, Workflows, Queues, R2, and Workers AI.
  > 
  > Work in parallel. Integration happens automatically. Thank you.”
