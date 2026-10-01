# FlareGit Verification Adapter Specification

> **Guaranteed Correctness via Independent Protected Verification**

---

## 1. Overview

In FlareGit, integration is not complete when Git exits code 0. Integration is complete only when the newly composed application passes its **Protected Verification Suite**.

The verification suite runs in an isolated Cloudflare Sandbox completely detached from contributors' development workspaces. It evaluates candidate builds against versioned behavioral requirements.

---

## 2. Requirement Structure

Each feature or task must declare versioned requirements:

```typescript
export interface Requirement {
  id: string;                      // e.g. "REQ-GROUP-DISCOUNT-15"
  title: string;                   // "15% Group Discount for 4+ Tickets"
  description: string;             // Plain-English contract description
  version: number;                 // Monotonically increasing version
  status: "approved" | "superseded" | "rejected";
  assertions: RequirementAssertion[];
  originTaskId: string;
  approvedAt: string;
}
```

---

## 3. Cryptographic Verification Manifest

When a candidate generation passes verification, FlareGit generates an immutable `VerificationEvidence` record stored in Cloudflare R2:

```typescript
export interface VerificationEvidence {
  id: string;                      // Unique evidence identifier (e.g. "ev-1790877840")
  candidateCommit: string;         // Exact Git commit hash verified
  expectedAcceptedBase: string;    // Base commit candidate was composed against
  requirementsVersion: number;     // Active requirement generation
  testBundleDigest: string;        // SHA-256 hash of immutable test suite code
  toolchainDigest: string;         // Compiler / runtime version fingerprint
  builtOutputDigest: string;       // SHA-256 digest of built application bundle
  verifierIdentity: string;        // "flaregit-protected-verifier-v1"
  testResults: {
    suite: string;
    passed: boolean;
    passedCount: number;
    failedCount: number;
    items: TestResultItem[];
  }[];
  timestamp: string;
  status: "passed" | "failed";
}
```

---

## 4. Ticket Booking Application Benchmark Suite

The demonstration fixture includes 5 protected behavioral contracts:

1. **`CHECK-SINGLE-TICKET-BASELINE`**:
   - Asserts that a single $40.00 ticket without extras equals exactly $40.00.
2. **`CHECK-GROUP-DISCOUNT-15PCT`**:
   - Asserts that 4 tickets receive a 15% discount on the ticket subtotal ($160.00 × 0.85 = $136.00).
3. **`CHECK-REFUNDABLE-SURCHARGE`**:
   - Asserts that selecting refundable protection applies a $5.00 surcharge per ticket ($90.00 for two tickets) and displays the `REFUNDABLE ACTIVE` badge.
4. **`CHECK-CROSS-FEATURE-PRICING`**:
   - Asserts cross-feature interaction according to approved policy: 4 refundable tickets cost exactly $156.00 ($160 × 0.85 + $20).
5. **`CHECK-CATALOG-PRICE-UNIT-CONSISTENCY`**:
   - Asserts that catalog prices (whether formatted as floating dollars or integer cents) normalize correctly across module boundaries without corrupting checkout math.

---

## 5. Tamper-Resistance Guarantees

- **Contributor Immutability**: Contributors cannot edit `verifier.ts` in their task workspaces to manufacture a passing build. If a contributor modifies the verification suite, the `testBundleDigest` check rejects the evidence.
- **Clean Environment**: Each verification execution occurs in an ephemeral sandbox created from scratch.
- **Fail-Closed Policy**: If any assertion fails or an unexpected exception is thrown, the candidate status is marked `failed` and canonical `main` remains unchanged.
