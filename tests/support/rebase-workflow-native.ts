import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RetainedInputs, type RetainedInput } from '../../src/server/retained-inputs';
import { CoreGitOperationLedger } from '../../src/server/core-git-budget';
import { accountKeyFor } from '../../src/server/projects';
import { q } from '../../src/server/shell';
import type { Env } from '../../src/server/env';
import type { Task, CandidateGeneration } from '../../src/core/types';
export async function rebaseWorkflowNativeFixture() {
    const root = await mkdtemp(join(tmpdir(), 'flaregit-workflow-rebase-')), canonical = join(root, 'canonical.git'), workspace = join(root, 'workspace.git'), seed = join(root, 'seed'), work = join(root, 'integration'), incarnation = '12345678-1234-4234-8234-123456789abc';
    const git = async (command: string) => { const child = Bun.spawn(['sh', '-c', command], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'Synthetic', GIT_AUTHOR_EMAIL: 'synthetic@localhost', GIT_COMMITTER_NAME: 'Synthetic', GIT_COMMITTER_EMAIL: 'synthetic@localhost' } }); const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); if (exit)
        throw Error(stderr); return stdout.trim(); };
    await git(`git init -q --initial-branch=main ${q(seed)} && git init -q --bare --initial-branch=main ${q(canonical)} && git init -q --bare ${q(workspace)}`);
    await Bun.write(join(seed, 'base'), 'base');
    await git(`git -C ${q(seed)} add . && git -C ${q(seed)} commit -qm base`);
    const base = await git(`git -C ${q(seed)} rev-parse HEAD`);
    await Bun.write(join(seed, 'parent'), 'parent');
    await git(`git -C ${q(seed)} add . && git -C ${q(seed)} commit -qm parent`);
    const parent = await git(`git -C ${q(seed)} rev-parse HEAD`);
    await Bun.write(join(seed, 'child'), 'child');
    await git(`git -C ${q(seed)} add . && git -C ${q(seed)} commit -qm child && git -C ${q(seed)} push -q ${q(workspace)} HEAD:refs/heads/child`);
    const original = await git(`git -C ${q(seed)} rev-parse HEAD`);
    await git(`git -C ${q(seed)} checkout -q main && git -C ${q(seed)} reset -q --hard ${base}`);
    await Bun.write(join(seed, 'accepted'), 'accepted');
    await git(`git -C ${q(seed)} add . && git -C ${q(seed)} commit -qm 'accepted rewritten parent' && git -C ${q(seed)} push -q ${q(canonical)} HEAD:refs/heads/main`);
    const landed = await git(`git -C ${q(seed)} rev-parse HEAD`);
    const db = new Database(':memory:'), storage = { sql: { exec(query: string, ...bindings: Array<string | number>) { if (query.includes(';')) {
                db.exec(query);
                return { toArray: () => [], one: () => ({}) };
            } const rows = db.query(query).all(...bindings); return { toArray: () => rows, one: () => rows[0] }; } }, transactionSync<T>(fn: () => T) { return db.transaction(fn)(); } }, retained = new RetainedInputs(storage as unknown as DurableObjectStorage), budget = new CoreGitOperationLedger(storage as unknown as DurableObjectStorage);
    const actor = 'fixture-human', accountKey = await accountKeyFor(actor);
    const child = { id: 'child', goal: 'Synthetic child', status: 'ready', baseCommit: parent, currentCommit: original, dependsOn: 'parent', workspace: { repoName: 'synthetic-workspace', branch: 'child' }, checkpoints: [] } as unknown as Task;
    const state = { canonicalRepoName: 'synthetic-canonical', tasks: { parent: { id: 'parent', currentCommit: parent }, child } };
    let prepared: RetainedInput | null = null, applications = 0, lostPush = false, lostApply = false, lostPushObserved = false, branchPushes = 0;
    const commands: string[] = [];
    const ledger = { getState: async () => state, getWorkflowRun: async () => ({ kind: 'integration', actorId: actor }), roleOf: async () => 'owner', assertRetainedInput: async () => true, prepareRetainedInput: async (taskId: string, workflowId: string, candidateId: string, id: string) => { prepared ??= { id, actorId: actor, ownerId: actor, accountKey, projectId: 'p123456789abc', incarnation, taskId, workflowId, candidateId, canonicalRepoName: 'synthetic-canonical', workspaceRepoName: 'synthetic-workspace', branch: 'child', commit: original, base: parent, dependsOn: 'parent', protectedRef: `refs/flaregit/inputs/${incarnation}/child/${original}`, protectedBaseRef: `refs/flaregit/inputs/${incarnation}/child/${parent}`, version: 1 }; return prepared; }, recordRetainedInput: async (input: RetainedInput, proof: {
            commit: string;
            base: string;
        }) => retained.record(input, proof), beginRetainedCredential: async () => true, recordRetainedCredential: async () => { }, revokeRetainedCredential: async () => true, markRetainedCredentialRevoked: async () => { }, logActivity: async () => { }, prepareRebaseApplication: async (input: RetainedInput, commit: string, base: string, parentAccepted: boolean) => retained.prepareApplication(input, commit, base, parentAccepted), recordRebaseRemoteOutcome: async (id: string, observed: string) => retained.remoteVerified(id, observed), rebaseApplication: async () => prepared ? retained.application(prepared.id) : null, applyRebase: async (_id: string, r: {
            commit?: string;
            base?: string;
            applicationId?: string;
            failed?: string;
        }) => { if (r.failed)
            throw Error(r.failed); retained.applyApplication(r.applicationId!, () => { applications++; child.currentCommit = r.commit!; child.baseCommit = r.base!; delete child.dependsOn; }); if (lostApply) {
            lostApply = false;
            throw Error('Synthetic lost ledger apply acknowledgement');
        } } };
    const remoteFor = (name: string) => `https://${(name === 'synthetic-canonical' ? 'a' : 'b').repeat(32)}.artifacts.cloudflare.net/repository.git`, executor = async (command: string, e?: Record<string, string>) => { commands.push(command); if (command.includes(' push ') && command.includes('--force-with-lease') && command.includes('refs/heads/child')) {
        branchPushes++;
        const application = prepared ? retained.application(prepared.id) : null;
        if (!application)
            throw Error('Mutable branch push preceded durable rebase intent');
        const pinned = await git(`git --git-dir ${q(canonical)} rev-parse ${q(`refs/flaregit/inputs/${incarnation}/child/${application.commit}`)}`);
        if (pinned !== application.commit)
            throw Error('Mutable branch push preceded protected result pin');
    } const rewritten = command.replaceAll('/workspace/integration', work).replaceAll(q(remoteFor('synthetic-canonical')), q(canonical)).replaceAll(q(remoteFor('synthetic-workspace')), q(workspace)); const process = Bun.spawn(['sh', '-c', rewritten], { stdout: 'pipe', stderr: 'pipe', env: { ...globalThis.process.env, ...e } }); const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]); if (command.includes(' push ') && command.includes('--force-with-lease') && command.includes('refs/heads/child') && lostPush) {
        lostPush = false;
        lostPushObserved = true;
        throw Error('Synthetic lost branch push acknowledgement');
    } return { success: exitCode === 0, stdout, stderr, exitCode }; };
    const env = { CORE_GIT_GLOBAL_MONTHLY_USD_MICROS: '5000000', CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS: '2500000', REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: (name: string) => name === 'global' ? { reserveCoreGitOperation: async (id: string, key: string, caps: Parameters<CoreGitOperationLedger['reserve']>[2]) => budget.reserve(id, key, caps) } : name.startsWith('account:') ? { accountLifecycle: async () => 'active' } : ledger }, ARTIFACTS: { get: async (name: string) => ({ info: async () => ({ remote: remoteFor(name) }), createToken: async (scope: string) => ({ plaintext: 'synthetic-server-only', scope, expiresAt: new Date(Date.now() + 900000).toISOString() }), [Symbol.dispose]: () => { } }) } } as unknown as Env;
    const { FlareGitIntegrationWorkflow } = await import('../../src/server/workflow');
    const workflow = new FlareGitIntegrationWorkflow({} as ExecutionContext, env);
    Object.assign(workflow, { projectId: 'p123456789abc', computeAccountKey: accountKey, computeWorkflowId: 'integration-fixture', sandbox: async () => ({ exec: executor, destroy: async () => { await rm(work, { recursive: true, force: true }); } }) });
    const callable = workflow as unknown as {
        rebaseDependents(candidate: CandidateGeneration, landed: string, branch: string, stub: unknown): Promise<{
            rebased: string[];
            blocked: string[];
        }>;
    };
    const candidate = { id: 'candidate-fixture', workflowInstanceId: 'integration-fixture', participatingTaskIds: ['parent'] } as CandidateGeneration;
    return { execute: () => callable.rebaseDependents(candidate, landed, 'main', ledger), losePush: () => { lostPush = true; }, loseApply: () => { lostApply = true; }, commands, original, parent, landed, child, canonical, workspace, git, applications: () => applications, branchPushes: () => branchPushes, lostPushObserved: () => lostPushObserved, db, cleanup: async () => { db.close(); await rm(root, { recursive: true, force: true }); } };
}
