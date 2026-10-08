import { expect, mock, test } from 'bun:test';
mock.module('cloudflare:workers', () => ({ WorkflowEntrypoint: class {
        constructor(_ctx: unknown, public env: unknown) { }
    }, DurableObject: class {
    } }));
import { rebaseWorkflowNativeFixture } from './support/rebase-workflow-native';
test.each(['push', 'ledger'] as const)('production rebase orchestration with native Git settles lost %s acknowledgement without repeating checkpoint application', async (mode) => { const f = await rebaseWorkflowNativeFixture(); try {
    if (mode === 'push')
        f.losePush();
    else
        f.loseApply();
    let interrupted = false;
    try {
        await f.execute();
    }
    catch {
        interrupted = true;
    }
    await f.execute();
    expect(f.applications()).toBe(1);
    expect(f.branchPushes()).toBe(1);
    if (mode === 'push')
        expect(f.lostPushObserved()).toBe(true);
    expect(f.child.baseCommit).toBe(f.landed);
    expect(f.child.currentCommit).not.toBe(f.original);
    const checkpoint = f.child.currentCommit;
    if (checkpoint === null) throw new Error('Native rebase fixture did not produce its committed checkpoint');
    expect(checkpoint).toMatch(/^[a-f0-9]{40}$/);
    expect(await f.git(`git --git-dir '${f.workspace}' rev-parse refs/heads/child`)).toBe(checkpoint);
    const pins = await f.git(`git --git-dir '${f.canonical}' for-each-ref --format='%(objectname)' refs/flaregit/inputs/`);
    expect(pins.split('\n')).toContain(f.original);
    expect(pins.split('\n')).toContain(f.parent);
    expect(pins.split('\n')).toContain(checkpoint);
    expect(f.commands.some(command => command.includes('synthetic-server-only'))).toBe(false);
    if (mode === 'ledger')
        expect(interrupted).toBe(true);
}
finally {
    await f.cleanup();
} }, 30000);
test('optional stack rewrite without creator consent defers while preserving original fork and accepted root',async()=>{
 const f=await rebaseWorkflowNativeFixture();try{
  f.denyMaintainerWrites();expect(await f.execute()).toMatchObject({status:'deferred',reason:'creator_consent_required',rebased:[],blocked:['child']});
  expect(f.commands).toEqual([]);expect(f.branchPushes()).toBe(0);expect(f.applications()).toBe(0);
  expect(f.child.currentCommit).toBe(f.original);expect(f.child.baseCommit).toBe(f.parent);
  expect(await f.git(`git --git-dir '${f.workspace}' rev-parse refs/heads/child`)).toBe(f.original);
  expect(await f.git(`git --git-dir '${f.canonical}' rev-parse refs/heads/main`)).toBe(f.landed);
 }finally{await f.cleanup();}
},30000);
