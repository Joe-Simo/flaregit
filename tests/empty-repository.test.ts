import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectEmptyRepository, createEmptyRepository, type EmptyRepositoryJournal, type EmptyRepositoryInput } from "../src/server/empty-repository";
import type { Env } from "../src/server/env";

const remote = `https://${"a".repeat(32)}.artifacts.cloudflare.net/owned.git`;
const metadata = { id: "provider-owned", name: "canonical-owned", remote, defaultBranch: "release" };
const input: EmptyRepositoryInput = { projectId: "p123456789abc", canonicalName: metadata.name, name: "Empty repository", description: "", defaultBranch: "release", userId: "owner", operationId: crypto.randomUUID(), eventId: crypto.randomUUID() };

test("real bare Git proves empty advertised refs without inventing symbolic HEAD or creating history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flaregit-empty-native-")), repository = join(directory, "repo.git"), commands: string[] = [];
  const init = Bun.spawn(["git", "init", "--quiet", "--bare", repository], { stdout: "pipe", stderr: "pipe" }); expect(await init.exited).toBe(0);
  try {
    const proof = await inspectEmptyRepository({ beforeCommand: async () => {}, exec: async (command, env) => {
      commands.push(command); expect(command).not.toContain("read-secret"); expect(env?.GIT_CONFIG_VALUE_0).toBe("Authorization: Bearer read-secret");
      const child = Bun.spawn(["sh", "-c", command.replaceAll(remote, repository)], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }, stdout: "pipe", stderr: "pipe" });
      const [stdout, _stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { success: exit === 0, stdout };
    } }, metadata, "read-secret", input.defaultBranch);
    expect(proof).toEqual({ repositoryId: metadata.id, canonicalRepoName: metadata.name, defaultRef: "refs/heads/release", refs: [], symbolicHead: null });
    expect(commands.length).toBe(1); expect(commands[0]).toBe(`git ls-remote --symref '${remote}'`);
    expect(commands.some(command => /commit|push|README|update-ref/.test(command))).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("empty inventory refuses HEAD hashes, tags, hidden refs and mismatched SDK defaults", async () => {
  for (const stdout of [`${"a".repeat(40)}\tHEAD`, `${"a".repeat(40)}\trefs/tags/v1`, `${"a".repeat(40)}\trefs/flaregit/candidates/private`, "ref: refs/heads/main\tHEAD"]) {
    await expect(inspectEmptyRepository({ beforeCommand: async () => {}, exec: async () => ({ success: true, stdout }) }, metadata, "read-secret", input.defaultBranch)).rejects.toThrow("not authoritatively empty");
  }
  await expect(inspectEmptyRepository({ beforeCommand: async () => {}, exec: async () => ({ success: false, stdout: "" }) }, metadata, "read-secret", input.defaultBranch)).rejects.toThrow("not confirmed");
  await expect(inspectEmptyRepository({ beforeCommand: async () => {}, exec: async () => ({ success: true, stdout: "" }) }, { ...metadata, defaultBranch: "main" }, "read-secret", input.defaultBranch)).rejects.toThrow("owner choice");
  expect((await inspectEmptyRepository({ beforeCommand: async () => {}, exec: async () => ({ success: true, stdout: "ref: refs/heads/release\tHEAD" }) }, metadata, "read-secret", input.defaultBranch)).symbolicHead).toBe("refs/heads/release");
});

function lifecycle(options: { stopped?: boolean; revokeRead?: boolean; scope?: string; recordFailure?: boolean; budgetDenied?: boolean; storageDenied?: boolean; createFailure?: boolean } = {}) {
  const calls: string[] = [], commands: string[] = [];
  const journal: EmptyRepositoryJournal = {
    authorize: async () => {}, beforeCreate: async () => { calls.push("intent"); return true; }, created: async (_metadata, token) => { calls.push(`created:${token}`); }, credentialRevoked: async () => { calls.push("initial-revoked"); }, nativeIntent: async () => { calls.push("native-intent"); }, beforeReadCredential: async () => { calls.push("read-intent"); }, readCredentialRecorded: async () => { calls.push("read-recorded"); if (options.recordFailure) throw new Error("Read receipt interrupted"); }, readCredentialRevoked: async () => { calls.push("read-revoked"); }, empty: async () => { calls.push("empty"); }, nativeStopped: async () => { calls.push("native-stopped"); },
  };
  const controller = { beginArtifactAllocation: async () => {}, activateArtifactAllocation: async () => { calls.push("allocation-active"); }, settleArtifactAllocation: async () => {}, reconcileArtifactInventory: async () => {}, reserveArtifactStorage: async () => ({ allowed: !options.storageDenied, reason: "account_capacity" }), accountLifecycle: async () => "active", reserveManagedSpend: async () => {calls.push("native-reserve");return {allowed:!options.budgetDenied};}, consumeManagedSpend: async () => {calls.push("native-funded");} };
  const env = {
    ARTIFACT_STORAGE_NAMESPACE: "synthetic", ARTIFACT_STORAGE_GLOBAL_SLOTS: "32", ARTIFACT_STORAGE_ACCOUNT_SLOTS: "10",
    REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: () => controller },
    ARTIFACTS: { list: async () => ({ repos: [] }), create: async (_name: string, opts: { setDefaultBranch: string }) => { expect(opts.setDefaultBranch).toBe(input.defaultBranch); calls.push("create"); if(options.createFailure)throw Error("Synthetic SDK create failure"); return { ...metadata, token: "initial-secret" }; }, get: async () => ({ info: async () => metadata, [Symbol.dispose]() {}, revokeToken: async (token: string) => { calls.push(`revoke:${token}`); return token !== "read-secret" || options.revokeRead !== false; }, createToken: async (scope: string, ttl: number) => { expect(scope).toBe("read"); expect(ttl).toBe(60); calls.push("read-issued"); return { plaintext: "read-secret", expiresAt: new Date(Date.now() + 60000).toISOString(), scope: options.scope ?? "read" }; } }) },
    INTEGRATOR: { getByName: () => ({ exec: async (argv: string[]) => { commands.push(argv[2]!); return { success: true, stdout: "", stderr: "" }; }, seal: async () => { calls.push("sealed"); }, destroy: async () => { calls.push("destroyed"); }, lifetimeStatus: async () => ({ state: options.stopped === false ? "unknown" : "stopped", sealed: true }) }) },
  } as unknown as Env;
  return { env, journal, calls, commands };
}
test("SDK empty creation records and revokes initial token before narrow read and confirmed cleanup", async () => {
  const f = lifecycle(); const proof = await createEmptyRepository(f.env, input, f.journal);
  expect(f.calls.lastIndexOf("allocation-active")).toBeLessThan(f.calls.indexOf("native-funded")); expect(f.calls.indexOf("native-funded")).toBeLessThan(f.calls.indexOf("intent")); expect(f.calls.indexOf("intent")).toBeLessThan(f.calls.indexOf("create"));
  expect(proof.refs).toEqual([]); expect(f.calls.indexOf("created:initial-secret")).toBeLessThan(f.calls.indexOf("revoke:initial-secret")); expect(f.calls.indexOf("initial-revoked")).toBeLessThan(f.calls.indexOf("read-issued")); expect(f.calls.indexOf("read-recorded")).toBeLessThan(f.calls.indexOf("empty")); expect(f.calls).toContain("read-revoked"); expect(f.calls.indexOf("sealed")).toBeLessThan(f.calls.indexOf("native-stopped"));
  expect(f.commands.length).toBe(1); expect(f.commands.some(command => /push|commit|README|update-ref/.test(command))).toBe(false);
});
test("unconfirmed native stop or credential revocation cannot publish empty readiness", async () => {
  for (const options of [{ stopped: false }, { revokeRead: false }]) {
    const f = lifecycle(options); await expect(createEmptyRepository(f.env, input, f.journal)).rejects.toThrow("remains pending");
    expect(options.stopped === false ? f.calls.includes("native-stopped") : f.calls.includes("read-revoked")).toBe(false);
  }
  const f = lifecycle({ scope: "write" }); await expect(createEmptyRepository(f.env, input, f.journal)).rejects.toThrow("read credential was not confirmed"); expect(f.calls).toContain("read-recorded"); expect(f.calls).toContain("read-revoked"); expect(f.calls).not.toContain("empty");
  const interrupted = lifecycle({ recordFailure: true }); await expect(createEmptyRepository(interrupted.env, input, interrupted.journal)).rejects.toThrow("Read receipt interrupted"); expect(interrupted.calls).toContain("revoke:read-secret"); expect(interrupted.calls).toContain("native-stopped");
});

test("lost created receipt acknowledgement revokes known initial token without another allocation", async () => {
  const f = lifecycle();
  f.journal.created = async (_metadata, token) => { f.calls.push(`created:${token}`); throw new Error("Created receipt acknowledgement lost"); };
  await expect(createEmptyRepository(f.env, input, f.journal)).rejects.toThrow("creation receipt is unconfirmed");
  expect(f.calls.filter(call => call === "create").length).toBe(1); expect(f.calls).toContain("revoke:initial-secret"); expect(f.calls).toContain("initial-revoked"); expect(f.calls).not.toContain("read-issued"); expect(f.commands).toEqual([]);
});

test("withdrawn read authority still cleans known credentials and native identity without empty publication", async () => {
  const f = lifecycle();
  f.journal.authorize = async () => { if (f.calls.includes("read-recorded")) throw new Error("Owner authority withdrawn"); };
  await expect(createEmptyRepository(f.env, input, f.journal)).rejects.toThrow("Owner authority withdrawn");
  expect(f.calls).toContain("revoke:read-secret"); expect(f.calls).toContain("read-revoked"); expect(f.calls).toContain("native-stopped"); expect(f.calls).not.toContain("empty"); expect(f.commands).toEqual([]);
});

import {createReadmeRepository,type ReadmeRepositoryInput,type RepositoryInitializationJournal} from '../src/server/readme-repository';
test('essential funding refusal happens before empty or README provider creation',async()=>{
 for(const kind of ['empty','readme']){const f=lifecycle({budgetDenied:true});const readme={...input,authorName:'Owner',authorEmail:'owner@users.noreply.flaregit.com',commitTimestamp:'2026-10-07T00:00:00Z'} satisfies ReadmeRepositoryInput;
 await expect(kind==='empty'?createEmptyRepository(f.env,input,f.journal):createReadmeRepository(f.env,readme,f.journal as unknown as RepositoryInitializationJournal)).rejects.toThrow('budget unavailable');expect(f.calls).not.toContain('intent');expect(f.calls).not.toContain('create');expect(f.calls).not.toContain('native-intent');expect(f.calls.filter(x=>x==='native-funded')).toHaveLength(0);}
});
test('storage refusal leaves original creation dispatch unused for empty and README requests',async()=>{
 for(const kind of ['empty','readme']){const f=lifecycle({storageDenied:true});const readme={...input,authorName:'Owner',authorEmail:'owner@users.noreply.flaregit.com',commitTimestamp:'2026-10-07T00:00:00Z'} satisfies ReadmeRepositoryInput;
 await expect(kind==='empty'?createEmptyRepository(f.env,input,f.journal):createReadmeRepository(f.env,readme,f.journal as unknown as RepositoryInitializationJournal)).rejects.toThrow('capacity reached');expect(f.calls).not.toContain('intent');expect(f.calls).not.toContain('create');expect(f.calls).not.toContain('allocation-active');expect(f.calls).not.toContain('native-funded');expect(f.calls).not.toContain('native-reserve');}
});
test('SDK creation failure retains original dispatch fence and prevents duplicate creation',async()=>{
 for(const kind of ['empty','readme']){const f=lifecycle({createFailure:true});let dispatched=false;f.journal.beforeCreate=async()=>{if(dispatched)throw Error('Original creation already dispatched');dispatched=true;return true;};const readme={...input,authorName:'Owner',authorEmail:'owner@users.noreply.flaregit.com',commitTimestamp:'2026-10-07T00:00:00Z'} satisfies ReadmeRepositoryInput;
 const run=()=>kind==='empty'?createEmptyRepository(f.env,input,f.journal):createReadmeRepository(f.env,readme,f.journal as unknown as RepositoryInitializationJournal);
 await expect(run()).rejects.toThrow('SDK create failure');await expect(run()).rejects.toThrow('already dispatched');expect(f.calls.filter(x=>x==='create')).toHaveLength(1);expect(f.calls).not.toContain('native-intent');expect(f.commands).toEqual([]);}
});
