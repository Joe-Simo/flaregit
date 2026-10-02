import { workerdChild } from "./support/workerd-child";
import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

function state(newer = false) {
  return {
    projectId: "test", projectName: "Test", canonicalRepoName: "repo", policyVersion: 1, verificationPolicy: {}, decisions: {}, evidence: {},
    acceptedState: { currentCommit: newer ? "newer" : "base", buildDigest: "original", activeRequirements: [] as Array<{ id: string; status: string }>, history: [] },
    tasks: { task: { id: "task", goal: "Checkpoint goal", contributor: { id: "person", name: "Person", type: "human" }, checkpoints: [] as Array<{ id: string }>, status: newer ? "integrating" : "verifying", currentCommit: "task-tip", activeCandidateId: newer ? "new-candidate" : "candidate", requirements: [{ id: "unverified", status: "approved" }], issue: undefined } },
    candidates: { candidate: { id: "candidate", status: "verified", workflowInstanceId: "old-holder", participatingTaskIds: ["task"], participatingCommits: { task: "task-tip" }, evidenceId: "evidence", frozenPolicyVersion: 1, frozenRequirements: [{ id: "verified", status: "approved" }] } },
    journal: [{ id: "journal", candidateId: "candidate", state: "PREPARED", expectedHead: "base", newHead: "landed", outputDigest: "build", candidateTree: "tree" }],
  };
}

test("local workerd SQLite executes production publication rollback and recovery", async () => {
  if (await workerdChild("tests/sqlite-publication.test.ts")) return;
  const bundlePath = `/tmp/flaregit-publication-${crypto.randomUUID()}.js`;
  const built = Bun.spawn([process.execPath, "build", "tests/support/sqlite-publication-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:crypto", `--outfile=${bundlePath}`], { stdout: "ignore", stderr: "pipe" });
  if (await built.exited !== 0) throw new Error(await new Response(built.stderr).text());
  const script = await Bun.file(bundlePath).text();
  await Bun.file(bundlePath).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "publication-test", modules: true, script, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { TEST: { className: "PublicationFixture", useSQLite: true } }, queueProducers: ["INTEGRATION_QUEUE"] }] }));
  const request = async (route: string, body?: unknown) => (await mf.getWorker("publication-test")).fetch(`http://test${route}`, body ? { method: "POST", body: JSON.stringify(body) } : undefined);
  try {
    const publishable = {
      ...state(),
      evidence: { evidence: { id: "evidence", candidateCommit: "landed", candidateTree: "tree", status: "passed", verifierIdentity: "flaregit-ticket-booking-protected-verifier-v2", expectedAcceptedBase: "base", requirementsVersion: 1, builtOutputDigest: "build" } },
      candidates: { candidate: { ...state().candidates.candidate, candidateCommit: "landed", expectedAcceptedBase: "base", frozenVerificationPolicy: {}, review: { approved: true, commit: "landed", by: "reviewer" } } },
    };
    const policy = { version: 2, mode: "external", checks: [{ id: "required-check", providerId: "provider-one", required: true }] };
    const nativeCandidate = {
      ...publishable,
      evidence: { evidence: { ...publishable.evidence.evidence, verifierIdentity: "flaregit-native-integrity-v1" } },
      candidates: { candidate: { ...publishable.candidates.candidate, frozenVerificationPolicy: { kind: "command", test: "bun test" }, frozenExternalChecksPolicy: policy, frozenContributorProofs: [{ id: "task", commit: "task-tip", baseCommit: "base", ref: "refs/flaregit/tasks/task", allowedScope: ["src/"] }] } },
    };
    const externalPassed = { frozen: { repositoryId: "test", candidateId: "candidate", commit: "landed", tree: "tree", policy }, runs: { run: { id: "run", checkId: "required-check", sequence: 1, status: "passed" } }, selectedRuns: { "required-check": "run" }, receipts: {} };
    await request("/seed?name=native-alone", { state: nativeCandidate, holder: "old-holder" });
    expect((await (await request("/prepare?name=native-alone")).json() as { ok: boolean }).ok).toBe(false);
    for (const [label, external] of [["commit", { ...externalPassed, frozen: { ...externalPassed.frozen, commit: "wrong" } }], ["tree", { ...externalPassed, frozen: { ...externalPassed.frozen, tree: "wrong" } }], ["policy", { ...externalPassed, frozen: { ...externalPassed.frozen, policy: { ...policy, version: 3 } } }]] as const) {
      await request(`/seed?name=wrong-${label}`, { state: nativeCandidate, holder: "old-holder" });
      await request(`/external?name=wrong-${label}`, external);
      expect((await (await request(`/prepare?name=wrong-${label}`)).json() as { ok: boolean }).ok).toBe(false);
    }
    await request("/seed?name=native-external-good", { state: nativeCandidate, holder: "old-holder" });
    await request("/external?name=native-external-good", externalPassed);
    expect((await (await request("/prepare?name=native-external-good")).json() as { ok: boolean }).ok).toBe(true);
    await request("/seed?name=native-augment", { state: { ...nativeCandidate, candidates: { candidate: { ...nativeCandidate.candidates.candidate, frozenExternalChecksPolicy: { ...policy, mode: "augment" } } } }, holder: "old-holder" });
    await request("/external?name=native-augment", { ...externalPassed, frozen: { ...externalPassed.frozen, policy: { ...policy, mode: "augment" } } });
    expect((await (await request("/prepare?name=native-augment")).json() as { ok: boolean }).ok).toBe(false);
    const provider = await (await request("/connection?name=frozen-policy")).json() as { metadata: { id: string } };
    const capturedPolicy = { version: 2, mode: "external", checks: [{ id: "required-check", providerId: provider.metadata.id, required: true }] };
    const commit = "a".repeat(40), tree = "b".repeat(40);
    await request("/seed?name=frozen-policy", { state: { ...nativeCandidate, evidence: { evidence: { ...nativeCandidate.evidence.evidence, candidateCommit: commit, candidateTree: tree } }, candidates: { candidate: { ...nativeCandidate.candidates.candidate, candidateCommit: commit, review: undefined, frozenExternalChecksPolicy: capturedPolicy } } }, holder: "old-holder" });
    await request("/external-policy?name=frozen-policy", capturedPolicy);
    await request("/external-policy?name=frozen-policy", { ...capturedPolicy, version: 3, checks: [] });
    expect((await request(`/await-review?name=frozen-policy&commit=${commit}`)).status).toBe(200);
    const beforeReplay = await (await request("/checks?name=frozen-policy")).json() as { frozen: { policy: typeof capturedPolicy }; selectedRuns: Record<string, string> };
    expect(beforeReplay.frozen.policy).toEqual(capturedPolicy);
    await request(`/await-review?name=frozen-policy&commit=${commit}`);
    const afterReplay = await (await request("/checks?name=frozen-policy")).json() as typeof beforeReplay;
    expect(afterReplay).toEqual(beforeReplay);
    const mismatched = { frozen: { repositoryId: "test", candidateId: "candidate", commit: "different-commit", tree: "tree", policy: { version: 1, mode: "augment", checks: [] } }, runs: {}, selectedRuns: {}, receipts: {} };
    await request("/seed?name=mismatched-review", { state: { ...publishable, candidates: { candidate: { ...publishable.candidates.candidate, status: "awaiting_review", review: undefined } } }, holder: "old-holder" });
    await request("/external?name=mismatched-review", mismatched);
    expect((await (await request("/review?name=mismatched-review")).json() as { ok: boolean }).ok).toBe(false);
    const unreviewed = await (await request("/snapshot?name=mismatched-review")).json() as { state: { candidates: { candidate: { review?: unknown } } } };
    expect(unreviewed.state.candidates.candidate.review).toBeUndefined();
    await request("/seed?name=mismatched-prepare", { state: publishable, holder: "old-holder" });
    await request("/external?name=mismatched-prepare", mismatched);
    expect((await (await request("/prepare?name=mismatched-prepare")).json() as { ok: boolean }).ok).toBe(false);
    await request("/seed?name=prepare", { state: publishable, holder: "old-holder" });
    const prepared = await (await request("/prepare?name=prepare")).json() as { ok: boolean; journal: { id: string } };
    expect(prepared.ok).toBe(true);
    expect(prepared.journal.id).toMatch(/^jrnl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await request("/seed?name=obsolete", { state: { ...publishable, evidence: { evidence: { ...publishable.evidence.evidence, verifierIdentity: "flaregit-ticket-booking-protected-verifier-v1" } } }, holder: "old-holder" });
    expect((await (await request("/prepare?name=obsolete")).json() as { ok: boolean }).ok).toBe(false);
    await request("/seed", { state: state(), holder: "old-holder" });
    await request("/fail?enabled=true");
    expect((await request("/complete")).status).toBe(500);
    const rolledBack = await (await request("/snapshot")).json() as { state: ReturnType<typeof state>; deliveries: unknown[] };
    expect(rolledBack.state.journal[0]!.state).toBe("PREPARED");
    expect(rolledBack.deliveries).toHaveLength(0);
    await request("/fail?enabled=false");
    const accepted = await (await request("/complete")).json() as { state: ReturnType<typeof state>; deliveries: unknown[]; lease: unknown[] };
    expect(accepted.state.journal[0]!.state).toBe("ACCEPTED");
    expect(accepted.deliveries).toHaveLength(1);
    expect(accepted.lease).toHaveLength(0);
    expect(accepted.state.acceptedState.activeRequirements).toEqual([{ id: "verified", status: "approved" }]);
    const repeated = await (await request("/complete")).json() as typeof accepted;
    expect(repeated.deliveries).toHaveLength(1);
    const late = await (await request("/abort")).json() as typeof accepted;
    expect(late.state.candidates.candidate.status).toBe("accepted");
    await request("/seed?name=newer", { state: state(true), holder: "new-holder" });
    const historical = await (await request("/complete?name=newer")).json() as typeof accepted;
    expect(historical.state.acceptedState.currentCommit).toBe("newer");
    expect(historical.state.acceptedState.activeRequirements).toEqual([]);
    expect(historical.state.tasks.task.status).toBe("integrating");
    expect(historical.lease).toEqual([{ holder: "new-holder" }]);
    await request("/seed?name=abort", { state: state(true), holder: "new-holder" });
    const aborted = await (await request("/abort?name=abort")).json() as typeof accepted;
    expect(aborted.state.journal[0]!.state).toBe("ABORTED");
    expect(aborted.state.tasks.task.status).toBe("integrating");
    expect(aborted.lease).toEqual([{ holder: "new-holder" }]);
    await request("/seed?name=checkpoint", { state: state(), holder: "old-holder" });
    await request("/fail?name=checkpoint&enabled=true");
    expect((await request("/checkpoint?name=checkpoint")).status).toBe(500);
    const checkpointRollback = await (await request("/snapshot?name=checkpoint")).json() as typeof accepted & { events: unknown[] };
    expect(checkpointRollback.events).toHaveLength(0);
    expect(checkpointRollback.deliveries).toHaveLength(0);
    expect(checkpointRollback.state.tasks.task.currentCommit).toBe("task-tip");
    await request("/fail?name=checkpoint&enabled=false");
    const checkpointSaved = await (await request("/checkpoint?name=checkpoint")).json() as typeof checkpointRollback;
    expect(checkpointSaved.events).toHaveLength(1);
    expect(checkpointSaved.deliveries).toHaveLength(1);
    expect(checkpointSaved.state.tasks.task.currentCommit).toBe("checkpoint-tip");
    const checkpointRepeated = await (await request("/checkpoint?name=checkpoint")).json() as typeof checkpointRollback;
    expect(checkpointRepeated.deliveries).toHaveLength(1);
    expect(checkpointRepeated.state.tasks.task.checkpoints).toHaveLength(1);
    const delivery = checkpointRepeated.deliveries[0] as { id: string; payload: string };
    const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
    expect(delivery.id).toMatch(new RegExp(`^dlv_${uuid}$`));
    expect((JSON.parse(delivery.payload) as { id: string }).id).toMatch(new RegExp(`^evt_${uuid}$`));
    const checkpoint = checkpointRepeated.state.tasks.task.checkpoints[0] as { id: string };
    expect(checkpoint.id).toMatch(new RegExp(`^chk_${uuid}$`));
    expect((await request("/subscribe?name=checkpoint", [])).status).toBe(500);
    expect((await request("/subscribe?name=checkpoint", ["unsupported"])).status).toBe(500);
    const subscriptions = await (await request("/snapshot?name=checkpoint")).json() as { webhooks: unknown[] };
    expect(subscriptions.webhooks).toHaveLength(1);
    await request("/seed?name=abort-rollback", { state: state(), holder: "old-holder" });
    await request("/fail?name=abort-rollback&enabled=true");
    expect((await request("/abort?name=abort-rollback")).status).toBe(500);
    const abortRollback = await (await request("/snapshot?name=abort-rollback")).json() as typeof accepted;
    expect(abortRollback.state.journal[0]!.state).toBe("PREPARED");
    expect(abortRollback.deliveries).toHaveLength(0);
    expect(abortRollback.lease).toEqual([{ holder: "old-holder" }]);
    await request("/fail?name=abort-rollback&enabled=false");
    const abortRetry = await (await request("/abort?name=abort-rollback")).json() as typeof accepted;
    expect(abortRetry.deliveries).toHaveLength(1);
    const abortDuplicate = await (await request("/abort?name=abort-rollback")).json() as typeof accepted;
    expect(abortDuplicate.deliveries).toHaveLength(1);
    await request("/seed?name=claim", { state: state(), holder: "old-holder" });
    await request("/expire?name=claim");
    await request("/fail?name=claim&enabled=true");
    expect((await request("/claim?name=claim")).status).toBe(500);
    const claimRollback = await (await request("/snapshot?name=claim")).json() as typeof accepted;
    expect(claimRollback.lease).toHaveLength(0);
    expect(Object.keys(claimRollback.state.candidates)).toEqual(["candidate"]);
    expect(claimRollback.state.tasks.task.status).toBe("verifying");
    await request("/fail?name=claim&enabled=false");
    const claimRetry = await (await request("/claim?name=claim")).json() as typeof accepted & { alarm: number };
    expect(claimRetry.lease).toEqual([{ holder: "claim-holder" }]);
    expect(Object.keys(claimRetry.state.candidates)).toHaveLength(2);
    const alarmAfter = await (await request("/checkpoint?name=claim")).json() as { alarm: number };
    expect(alarmAfter.alarm).toBe(claimRetry.alarm);
    const decisionState = state();
    const requirement = (id: string, output: number) => ({ id, status: "approved", title: id, description: id, assertions: [{ input: 1, expectedOutput: output }] });
    const decisionFixture = { ...decisionState, tasks: { task: { ...decisionState.tasks.task, requirements: [requirement("one", 1)] }, other: { ...decisionState.tasks.task, id: "other", requirements: [requirement("two", 2)] } } };
    await request("/seed?name=decision", { state: decisionFixture, holder: "old-holder" });
    await request("/expire?name=decision");
    await request("/fail?name=decision&enabled=true");
    expect((await request("/claim?name=decision&tasks=task,other")).status).toBe(500);
    const decisionRollback = await (await request("/snapshot?name=decision")).json() as typeof accepted;
    expect(decisionRollback.state.decisions).toEqual({});
    expect(decisionRollback.deliveries).toHaveLength(0);
    await request("/fail?name=decision&enabled=false");
    const decisionRetry = await (await request("/claim?name=decision&tasks=task,other")).json() as typeof accepted;
    expect(Object.keys(decisionRetry.state.decisions)).toHaveLength(1);
    expect(decisionRetry.deliveries).toHaveLength(1);
  } finally { await mf.dispose(); }
}, 30_000);
