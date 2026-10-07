import {RetainedCredentialIncidents} from '../../src/server/retained-credential-incidents';
import { RepositoryController } from '../../src/server/durable-object';
import { accountKeyFor } from '../../src/server/projects';
import type { Env } from '../../src/server/env';
import type { RetainedInput } from '../../src/server/retained-inputs';
import type { FlareGitProjectState } from '../../src/core/types';
const projectId = 'p123456789abc', owner = 'synthetic-owner', actor = 'synthetic-actor', wf = 'integration-synthetic', candidate = 'candidate-synthetic', taskId = 'task-synthetic', head = 'a'.repeat(40), base = 'b'.repeat(40), rebased = 'c'.repeat(40), target = 'd'.repeat(40), secret = 'synthetic-server-only-token';
export class RetainedNativeFixture extends RepositoryController {
    constructor(ctx: DurableObjectState, env: Env) { super(ctx, { ...env, ARTIFACTS: { get: async (name: string) => ({ revokeToken: async () => { const global = env.REPOSITORY_CONTROLLER.getByName('global') as unknown as RetainedNativeFixture; await global.fixtureProviderCall(name); return await global.fixtureRevokeMode(); }, [Symbol.dispose]: () => { } }) } } as unknown as Env); }
    async fixtureProviderCall(name: string) { await this.ctx.storage.put('calls', (await this.ctx.storage.get<string[]>('calls') ?? []).concat(name)); }
    async fixtureRevokeMode() { return await this.ctx.storage.get<boolean>('revoke') ?? false; }
    async fixtureRevoke(value: boolean) { await this.ctx.storage.put('revoke', value); }
    async fixtureClearCalls() { await this.ctx.storage.put("calls", []); }
    async fixtureCalls() { return await this.ctx.storage.get('calls') ?? []; }
    async fixtureWithdrawDuringAwait(who = actor) { await this.ctx.storage.put('withdraw', who); }
    override async accountLifecycle() { const value = await super.accountLifecycle(); const who = await this.ctx.storage.get<string>('withdraw'); if (who) {
        await this.ctx.storage.delete('withdraw');
        await (this.env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as RetainedNativeFixture).removeMember(who);
    } return value; }
    async fixtureSeed() { const state = { projectId, projectName: 'Synthetic', canonicalRepoName: 'synthetic-canonical', acceptedState: { currentCommit: base, history: [], activeRequirements: [] }, tasks: { [taskId]: { id: taskId, goal: 'Synthetic source pin', contributor: { id: actor, name: 'Synthetic actor', type: 'human' }, baseCommit: base, currentCommit: head, workspace: { repoName: 'synthetic-workspace', branch: 'task/source' }, status: 'ready', allowedScope: [], requirements: [], checkpoints: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }, candidates: { [candidate]: { id: candidate, workflowInstanceId: wf, participatingCommits: { [taskId]: head }, participatingTaskIds: [taskId], frozenContributorProofs: [{ id: taskId, commit: head, baseCommit: base, ref: "refs/heads/task", allowedScope: ["src/"] }] } }, evidence: {}, journal: [], decisions: {}, policyVersion: 1, verificationPolicy: {} } as unknown as FlareGitProjectState; this.ctx.storage.sql.exec('INSERT INTO project(id,doc)VALUES(1,?)', JSON.stringify(state)); await this.addMember(owner, 'owner'); await this.addMember(actor, 'member'); await this.registerWorkflow(wf, 'integration', undefined, actor); }
    async fixtureLegacyCredential(input:RetainedInput){const expected=await this.prepareRetainedInput(input.taskId,input.workflowId,input.candidateId,input.id);if(JSON.stringify(expected)!==JSON.stringify(input))throw Error('Legacy fixture original scope differs');return new RetainedCredentialIncidents(this.ctx.storage).begin(input,'workspace',Date.now()+60000,'read');}
    async fixtureResetCheckpoint() { const state = await this.getState(); state.tasks[taskId]!.currentCommit = head; this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1", JSON.stringify(state)); }
    async fixtureAdvance() { const state = await this.getState(); state.tasks[taskId]!.currentCommit = 'e'.repeat(40); this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1', JSON.stringify(state)); }
    async fixtureAlarm() { await this.alarm(); }
    fixtureExpire(id: string) { this.ctx.storage.sql.exec("UPDATE retained_credential_incidents SET expires_at=? WHERE input_id=?", Date.now() - 1, id); }
    async fixtureBudget(exhausted: boolean) { await this.reserveCoreGitOperation("fixture-init", await accountKeyFor(owner), { globalUsdMicros: 5000000, accountUsdMicros: 2500000, readGlobalUsdMicros: 2000000, readAccountUsdMicros: 1000000 }); this.ctx.storage.sql.exec("DELETE FROM core_git_operations WHERE operation_id='fixture-exhausted'"); if (exhausted)
        this.ctx.storage.sql.exec("INSERT INTO core_git_operations(operation_id,account_key,month,reserved)VALUES(?,?,?,?)", "fixture-exhausted", await accountKeyFor(owner), new Date().toISOString().slice(0, 7), 5000000); }
    async fixtureState() { const state = await this.getState(); return { task: state.tasks[taskId], activity: this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM activity WHERE type='stack.rebased'").toArray() }; }
}
export default { async fetch(request: Request, env: Env) {
        const path = new URL(request.url).pathname, project = env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as RetainedNativeFixture, global = env.REPOSITORY_CONTROLLER.getByName('global') as unknown as RetainedNativeFixture;
        try {
            if (path === '/seed') {
                await project.fixtureSeed();
                return new Response('ok');
            }
            if (path === '/input')
                return Response.json(await project.prepareRetainedInput(taskId, wf, candidate, new URL(request.url).searchParams.get('id')!));
            const body = request.method === 'POST' ? await request.json() as RetainedInput : null;
            if (path === '/record')
                return Response.json(await project.recordRetainedInput(body!, { commit: head, base }));
            if (path === '/intent')
                return Response.json(await project.prepareRebaseApplication(body!, rebased, target, true));
            if (path === '/remote')
                return Response.json(await project.recordRebaseRemoteOutcome(body!.id, rebased));
            if (path === '/wrong-remote')
                return Response.json(await project.recordRebaseRemoteOutcome(body!.id, 'f'.repeat(40)));
            if (path === '/apply') {
                await project.applyRebase(taskId, { expected: body!, receiptId: body!.id, applicationId: body!.id, commit: rebased, base: target, parentAccepted: true });
                return new Response('ok');
            }
            if (path === '/advance') {
                await project.fixtureAdvance();
                return new Response('ok');
            }
            if (path === '/state')
                return Response.json(await project.fixtureState());
            if (path === '/withdraw-actor-await') {
                await (env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor(actor)}`) as unknown as RetainedNativeFixture).fixtureWithdrawDuringAwait();
                return new Response('ok');
            }
            if (path === '/withdraw-owner-await') {
                await (env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor(owner)}`) as unknown as RetainedNativeFixture).fixtureWithdrawDuringAwait(owner);
                return new Response('ok');
            }
            if (path === '/restore-owner') {
                await project.addMember(owner, 'owner');
                return new Response('ok');
            }
            if (path === '/restore-actor') {
                await project.addMember(actor, 'member');
                return new Response('ok');
            }
            if (path === '/historical-begin') {
                const params = new URL(request.url).searchParams;
                return Response.json(await project.beginRetainedCredential(body!, params.get('purpose') === 'workspace' ? 'workspace' : 'canonical', Date.now() + 60000, params.get('scope') === 'read' ? 'read' : 'write'));
            }
            if (path === '/historical-close')
                return Response.json(await project.revokeRetainedCredential(body!.id, new URL(request.url).searchParams.get('purpose') === 'workspace' ? 'workspace' : 'canonical'));
            if (path === '/clear-calls') {
                await global.fixtureClearCalls();
                return new Response('ok');
            }
            if (path === '/historical-issued') {
                const workspace = new URL(request.url).searchParams.get('purpose') === 'workspace';
                await project.recordRetainedCredential(body!.id, workspace ? 'workspace' : 'canonical', workspace ? 'synthetic-workspace' : 'synthetic-canonical', secret, Date.now() + 60000);
                return new Response('ok');
            }
            if (path === '/reset-checkpoint') {
                await project.fixtureResetCheckpoint();
                return new Response('ok');
            }
            if(path==='/credential-begin-legacy')return Response.json(await project.fixtureLegacyCredential(body!));
            if (path === '/credential-begin')
                return Response.json(await project.beginRetainedCredential(body!, 'workspace', Date.now() + 60000, 'read'));
            if (path === '/withdraw-owner') {
                await project.removeMember(owner);
                return new Response('ok');
            }
            if (path === '/credential-record') {
                await project.recordRetainedCredential(body!.id, 'workspace', 'synthetic-workspace', secret, Date.now() + 60000);
                return new Response('ok');
            }
            if (path === '/credential-revoke')
                return Response.json(await project.revokeRetainedCredential(body!.id, 'workspace'));
            if (path === '/credential-summary')
                return Response.json(await project.retainedCredentialSummary(body!.id, 'workspace'));
            if (path === '/provider-mode') {
                await global.fixtureRevoke(new URL(request.url).searchParams.get('fail') !== '1');
                return new Response('ok');
            }
            if (path === '/alarm') {
                await project.fixtureAlarm();
                return new Response('ok');
            }
            if (path === '/credential-expire') {
                await project.fixtureExpire(body!.id);
                return new Response('ok');
            }
            if (path === '/budget-exhaust') {
                await global.fixtureBudget(true);
                return new Response('ok');
            }
            if (path === '/budget-fund') {
                await global.fixtureBudget(false);
                return new Response('ok');
            }
            if (path === '/calls')
                return Response.json(await global.fixtureCalls());
            return new Response('missing', { status: 404 });
        }
        catch (error) {
            return new Response(error instanceof Error ? error.message : 'failure', { status: 409 });
        }
    } };
