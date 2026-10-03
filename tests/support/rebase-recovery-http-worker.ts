import { AgentRunLedger } from '../../src/server/agent-run-ledger';
import worker from '../../src/server/worker';
import { RepositoryController } from '../../src/server/durable-object';
import { RetainedInputs } from '../../src/server/retained-inputs';
import { PrivateRecoveryOperations } from '../../src/server/private-recovery';
import { accountKeyFor } from '../../src/server/projects';
import type { Env } from '../../src/server/env';
import type { FlareGitProjectState } from '../../src/core/types';
const projectId = 'p123456789abc', id = '12345678-1234-4234-8234-123456789abc', old = 'a'.repeat(40), base = 'b'.repeat(40), result = 'c'.repeat(40), target = 'd'.repeat(40);
let mode = 'normal', calls: string[] = [];
export class RebaseRecoveryHttpFixture extends RepositoryController {
    constructor(ctx: DurableObjectState, env: Env) { super(ctx, { ...env, ARTIFACTS: { get: async (name: string) => { calls.push(`get:${name}`); if (mode === 'expiry-await')
                await new Promise(resolve => setTimeout(resolve, 75)); if (mode === 'unavailable')
                throw Error('Synthetic metadata outage'); return { log: async ({ ref }: {
                    ref: string;
                }) => { calls.push(`log:${name}:${ref}`); if (mode === 'withdraw') {
                    mode = 'normal';
                    await this.removeMember('owner');
                } if (mode === 'advance') {
                    mode = 'normal';
                    await this.fixtureAdvance();
                } if (mode === 'agent-start') {
                    mode = 'normal';
                    await this.fixtureAgentStart();
                } if (mode === 'lifecycle') {
                    mode = 'normal';
                    await (env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor('owner')}`) as unknown as RebaseRecoveryHttpFixture).beginAccountDeletion();
                } const hash = ref.startsWith('refs/heads/') ? (mode === 'newer' ? 'e'.repeat(40) : mode === 'old' ? old : result) : ref.endsWith(old) ? old : ref.endsWith(base) ? base : ref.endsWith(result) ? (mode === 'wrong-pin' ? 'f'.repeat(40) : result) : target; return [{ hash }]; }, [Symbol.dispose]: () => { } }; } } } as unknown as Env); }
    async fixtureSeed() { const incarnation = new PrivateRecoveryOperations(this.ctx.storage).incarnation(), state = { projectId, projectName: 'Synthetic owner recovery', canonicalRepoName: 'synthetic-canonical', acceptedState: { currentCommit: target, activeRequirements: [], history: [{ candidateId: 'candidate', commit: target }] }, tasks: { child: { id: 'child', currentCommit: old, baseCommit: base, dependsOn: 'parent', status: 'blocked', blockedReason: 'Unrelated maintainer decision remains unresolved', requirements: [{ id: 'preserved-requirement', description: 'Keep durable context' }], workspace: { repoName: 'synthetic-workspace', branch: 'child' }, checkpoints: [{ id: 'preserved-checkpoint', commitHash: old }], goal: 'Recover saved rebase', contributor: { id: 'original-actor', name: 'Original actor', type: 'human' } } }, candidates: { candidate: { id: 'candidate', status: 'accepted', candidateCommit: target, workflowInstanceId: 'old-workflow' } }, evidence: {}, decisions: {}, journal: [{ state: 'ACCEPTED', candidateId: 'candidate', newHead: target }], policyVersion: 1, verificationPolicy: {} } as unknown as FlareGitProjectState; this.ctx.storage.sql.exec('INSERT INTO project(id,doc)VALUES(1,?)', JSON.stringify(state)); await this.addMember('owner', 'owner'); await this.addMember('member', 'member'); const ledger = new RetainedInputs(this.ctx.storage), input = { id, version: 1 as const, projectId, incarnation, taskId: 'child', commit: old, base, canonicalRepoName: 'synthetic-canonical', workspaceRepoName: 'synthetic-workspace', branch: 'child', protectedRef: `refs/flaregit/inputs/${incarnation}/child/${old}`, protectedBaseRef: `refs/flaregit/inputs/${incarnation}/child/${base}`, workflowId: 'old-workflow', candidateId: 'candidate', actorId: 'original-actor', ownerId: 'owner', accountKey: await accountKeyFor('owner'), dependsOn: 'parent' }; ledger.record(input, { commit: old, base }); ledger.prepareApplication(input, result, target, true); }
    async fixtureAdvance() { const state = await this.getState(); state.tasks.child!.currentCommit = 'e'.repeat(40); this.ctx.storage.sql.exec('UPDATE project SET doc=?WHERE id=1', JSON.stringify(state)); }
    fixtureRawRef(bad: boolean) { const ledger = new RetainedInputs(this.ctx.storage), application = ledger.application(id)!; application.input.protectedRef = bad ? "refs/heads/main" : `refs/flaregit/inputs/${application.input.incarnation}/child/${old}`; this.ctx.storage.sql.exec("UPDATE rebase_applications SET doc=?WHERE id=?", JSON.stringify(application), id); }
    async fixtureAgentStart() { const state = await this.getState(), task = state.tasks.child!; new AgentRunLedger(this.ctx.storage).claim({ runId: 'synthetic-active-agent', taskId: 'child', startingCommit: old, startingBranchHead: old, branch: 'child', goal: task.goal, context: { comments: [] }, allowedScope: ['src/'], protectedPaths: [] }); task.agentRunId = 'synthetic-active-agent'; this.ctx.storage.sql.exec("UPDATE project SET doc=?WHERE id=1", JSON.stringify(state)); }
    fixtureAuditCapacity() { this.ctx.storage.sql.exec("WITH RECURSIVE fixture_rows(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM fixture_rows WHERE n<9999) INSERT INTO rebase_recovery_receipts(request_id,payload,doc)SELECT 'fixture-audit-'||n,'{}','{}' FROM fixture_rows"); }
    fixtureIncarnation() { this.ctx.storage.sql.exec("UPDATE private_recovery_incarnation SET value=?WHERE id=1", crypto.randomUUID()); }
    async fixtureReset() { await this.addMember("owner", "owner"); const state = await this.getState(); state.tasks.child!.currentCommit = old; delete state.tasks.child!.agentRunId; this.ctx.storage.sql.exec("UPDATE project SET doc=?WHERE id=1", JSON.stringify(state)); }
    fixtureResetAccount() { this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS account_lifecycle(id INTEGER PRIMARY KEY,status TEXT NOT NULL)"); this.ctx.storage.sql.exec("DELETE FROM account_lifecycle"); }
    async fixtureSnapshot() { const state = await this.getState(); return { task: state.tasks.child, accepted: state.acceptedState, application: new RetainedInputs(this.ctx.storage).application(id), receipts: this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='rebase_recovery_receipts'").toArray().length ? this.ctx.storage.sql.exec('SELECT doc FROM rebase_recovery_receipts').toArray() : [] }; }
    async fixtureBudget(value: boolean) { await this.reserveCoreGitOperation('fixture-init', await accountKeyFor('owner'), { accountUsdMicros: 2500000, globalUsdMicros: 5000000, readAccountUsdMicros: 1000000, readGlobalUsdMicros: 2000000 }); this.ctx.storage.sql.exec("DELETE FROM core_git_operations WHERE operation_id='fixture-exhausted'"); if (value)
        this.ctx.storage.sql.exec('INSERT INTO core_git_operations(operation_id,account_key,month,reserved,category)VALUES(?,?,?,?,?)', 'fixture-exhausted', await accountKeyFor('owner'), new Date().toISOString().slice(0, 7), 5000000, 'core'); }
}
type FixtureEnv = Env & {
    FIXTURE_ISSUER: string;
};
export default { async fetch(request: Request, env: FixtureEnv, ctx: ExecutionContext) {
        const url = new URL(request.url), repo = env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as RebaseRecoveryHttpFixture, account = env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor('owner')}`) as unknown as RebaseRecoveryHttpFixture;
        try {
            if (url.pathname === '/fixture/seed') {
                await repo.fixtureSeed();
                await account.setProfile({ handle: 'owner', displayName: 'Synthetic owner', bio: '', joinedAt: '2026-10-03' });
                const key = await accountKeyFor('owner'), token = `fgt_${key}_` + 'x'.repeat(32);
                await account.createApiToken('owner', 'task only', token, { scope: 'write', repo: projectId });
                return Response.json({ token, id });
            }
            if (url.pathname === '/fixture/mode') {
                mode = url.searchParams.get('value')!;
                calls = [];
                return new Response('ok');
            }
            if (url.pathname === '/fixture/snapshot')
                return Response.json(await repo.fixtureSnapshot());
            if (url.pathname === '/fixture/calls')
                return Response.json(calls);
            if (url.pathname === '/fixture/restore') {
                await repo.fixtureReset();
                await account.fixtureResetAccount();
                return new Response('ok');
            }
            if (url.pathname === '/fixture/budget') {
                await (env.REPOSITORY_CONTROLLER.getByName('global') as unknown as RebaseRecoveryHttpFixture).fixtureBudget(url.searchParams.get('deny') === '1');
                calls = [];
                return new Response('ok');
            }
            if (url.pathname === '/fixture/audit-capacity') {
                await repo.fixtureAuditCapacity();
                calls = [];
                return new Response('ok');
            }
            if (url.pathname === '/fixture/incarnation') {
                await repo.fixtureIncarnation();
                calls = [];
                return new Response('ok');
            }
            if (url.pathname === '/fixture/raw-ref') {
                await repo.fixtureRawRef(url.searchParams.get('bad') === '1');
                return new Response('ok');
            }
            if (url.pathname === '/fixture/expiry-await') {
                mode = 'expiry-await';
                calls = [];
                const actor = { userId: 'owner', displayName: 'Synthetic owner', viaToken: false };
                const list = await repo.ownerRebaseApplications(actor, undefined, Date.now() + 1000);
                return Response.json(await repo.reconcileRebaseApplication(id, actor, list.applications[0]!.version, crypto.randomUUID(), undefined, Date.now() + 50));
            }
            if (url.pathname === '/fixture/expired') {
                return Response.json(await repo.reconcileRebaseApplication(id, { userId: 'owner', displayName: 'Synthetic owner', viaToken: false }, 0, crypto.randomUUID(), undefined, Date.now() - 1));
            }
            if (url.pathname === '/fixture/advance') {
                await repo.fixtureAdvance();
                return new Response('ok');
            }
            const response = await worker.fetch(request, { ...env, API_LIMITER: { limit: async () => ({ success: true }) }, LOOKUP_LIMITER: { limit: async () => ({ success: true }) }, CLERK_ISSUER: env.FIXTURE_ISSUER, CLERK_AUTHORIZED_PARTIES: 'https://fixture.example' } as unknown as Env, ctx);
            if (mode === 'lost-ack' && request.method === 'POST' && response.ok) {
                mode = 'normal';
                return new Response('Synthetic reply lost after successful saved mutation', { status: 503 });
            }
            return response;
        }
        catch (error) {
            return new Response(error instanceof Error ? error.message : 'fixture failed', { status: 409 });
        }
    } };
