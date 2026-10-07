import { z } from 'zod';
import { q } from './shell';
import { repairDigest, type RepairPatch, type ProtectedRepairPlan } from './protected-model-repair';
import { verifyBuildManifest } from './static-build-artifact';
import {validateProtectedConflictSnapshot,type ProtectedConflictContext,type ProtectedConflictSnapshot} from './protected-conflict-source';
import type { TrustedGitSource } from './trusted-git-source';
const sha = z.string().regex(/^[a-f0-9]{40}$/).refine(value => !/^0{40}$/.test(value));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const safePath = z.string().min(1).max(256).refine(value => !/[\\\x00-\x20\x7f%?#]/.test(value) && !value.startsWith('/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..') && !/^[A-Za-z]:/.test(value));
const patchSchema = z.object({ attemptId: z.uuid(), sourceDigest: digest, planDigest: digest, changes: z.array(z.object({ path: safePath, beforeDigest: digest, digest, content: z.string().max(60000) }).strict()).min(1).max(100), requiresIndependentVerification: z.literal(true), acceptanceEvidence: z.literal(false) }).strict();
export type ProtectedRepairLanding = {kind:'merge'} | {kind:'squash';acceptedBase:string;coauthors?:string[]};
export interface ProtectedNativeRepairPorts {
 directory: string;
 authorize(): Promise<void>;
 exec(command: string, env?: Record<string, string>): Promise<{ success: boolean; stdout: string }>;
 readFileBytes(path: string): Promise<Uint8Array>;
 writeFile(path: string, content: string): Promise<unknown>;
 readGitObject(kind: 'commit' | 'tree' | 'blob', hash: string, maxBytes: number): Promise<Uint8Array>;
}
async function byteDigest(bytes: Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), byte => byte.toString(16).padStart(2, '0')).join(''); }
async function gitHash(kind: string, bytes: Uint8Array) {
 const header = new TextEncoder().encode(`${kind} ${bytes.length}\0`), value = new Uint8Array(header.length + bytes.length); value.set(header); value.set(bytes, header.length);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', value)), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Apply only a durable, digest-bound patch. Git objects/commit are deterministic for
 * the recorded model attempt, so lost commit acknowledgements cannot mint another SHA.
 * This returns no acceptance evidence: a new pin and all independent gates are required. */
export async function applyProtectedNativeRepair(planInput: ProtectedRepairPlan, sourceInput: TrustedGitSource, patchInput: RepairPatch, ports: ProtectedNativeRepairPorts, landingInput: ProtectedRepairLanding = {kind:'merge'}): Promise<{ commit: string; tree: string; modelAttemptId: string }> {
 const landing=structuredClone(landingInput);
 const plan = structuredClone(planInput), source = structuredClone(sourceInput), patch = patchSchema.parse(structuredClone(patchInput));
 if (plan.source.kind !== 'committed-browser-failure') throw Error('Frozen uncommitted conflict repair is not wired');
 const identity = plan.source.identity;
 if (patch.sourceDigest !== identity.sourceDigest || patch.sourceDigest !== source.sourceManifest.digest || patch.planDigest !== await repairDigest(JSON.stringify(plan)) || source.proof.commit !== identity.commit || source.proof.tree !== identity.tree || source.proof.sourceDigest !== identity.sourceDigest || new Set(patch.changes.map(file => file.path)).size !== patch.changes.length) throw Error('Protected repair patch identity differs');
 await verifyBuildManifest(source.sourceManifest, source.sourceManifest.scope, source.files);
 const changed = new Map(patch.changes.map(file => [file.path, file]));
 for (const file of patch.changes) { const frozen = plan.files.find(value => value.path === file.path), original = source.sourceManifest.files.find(value => value.path === file.path); if (!frozen || !original || frozen.digest !== file.beforeDigest || original.digest !== file.beforeDigest || await repairDigest(file.content) !== file.digest) throw Error('Protected repair bytes or file boundary differs'); }
 if (source.proof.blobs.length !== source.files.length || new Set(source.proof.blobs.map(file => file.path)).size !== source.files.length) throw Error('Protected repair regular file inventory differs');
 const execute = async (command: string, env?: Record<string, string>) => { await ports.authorize(); const result = await ports.exec(command, env); await ports.authorize(); if (!result.success) throw Error('Protected native command acknowledgement unconfirmed'); return result.stdout; };
 const git = `git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c commit.gpgsign=false -c i18n.commitEncoding=UTF-8 -C ${q(ports.directory)}`;
 const head = sha.parse((await execute(`${git} rev-parse HEAD`)).trim());
 const originalCommit = await ports.readGitObject('commit', identity.commit, 262144); await ports.authorize();
 if (await gitHash('commit', originalCommit) !== identity.commit) throw Error('Original repair commit object differs');
 const originalText = new TextDecoder('utf-8', { fatal: true }).decode(originalCommit), timestamp = /^committer .* ([0-9]+) [+-][0-9]{4}$/m.exec(originalText);
 const seconds = Number(timestamp?.[1]); if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds >= 4102444800 || !originalText.startsWith(`tree ${identity.tree}\n`)) throw Error('Original repair commit metadata unavailable');
 const env = { GIT_AUTHOR_NAME: 'FlareGit', GIT_AUTHOR_EMAIL: 'integrator@flaregit.com', GIT_COMMITTER_NAME: 'FlareGit', GIT_COMMITTER_EMAIL: 'integrator@flaregit.com', GIT_AUTHOR_DATE: `@${seconds + 1} +0000`, GIT_COMMITTER_DATE: `@${seconds + 1} +0000`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
 const parent=landing.kind==='squash'?sha.parse(landing.acceptedBase):identity.commit;
 if(landing.kind==='squash')await execute(`${git} merge-base --is-ancestor ${q(parent)} ${q(identity.commit)}`);
 const expectedEntries: string[] = [];
 // A replay may find only the same durable patch bytes already written. Other
 // source bytes, modes, untracked paths or partially unrelated edits fail closed.
 for (const file of source.files) {
  const proof = source.proof.blobs.find(value => value.path === file.path); if (!proof || !['100644', '100755'].includes(proof.mode) || await gitHash('blob', file.bytes) !== proof.hash) throw Error('Original repair regular file proof differs');
  const segments = file.path.split('/'), ancestors = segments.map((_, index) => `${ports.directory}/${segments.slice(0, index + 1).join('/')}`);
  await execute(`${ancestors.map(path => `test ! -L ${q(path)}`).join(' && ')} && test -f ${q(`${ports.directory}/${file.path}`)}`);
  await ports.authorize(); const current = (await ports.readFileBytes(`${ports.directory}/${file.path}`)).slice(); await ports.authorize();
  const currentDigest = await byteDigest(current);
  const originalDigest = source.sourceManifest.files.find(value => value.path === file.path)!.digest, proposed = changed.get(file.path);
  if (currentDigest !== originalDigest && currentDigest !== proposed?.digest) throw Error('Protected repair checkout changed before write');
  const bytes = proposed ? new TextEncoder().encode(proposed.content) : file.bytes;
  expectedEntries.push(`${proof.mode} blob ${await gitHash('blob', bytes)}\t${file.path}`);
 }
 const originalMessage=originalText.slice(originalText.indexOf('\n\n')+2).trimEnd();
 const message = `${originalMessage}\n\nFlareGit protected repair ${patch.attemptId}\nProtected landing: ${landing.kind}\nProtected parent: ${parent}`;
 const commitText = (tree: string) => `tree ${tree}\nparent ${parent}\nauthor FlareGit <integrator@flaregit.com> ${seconds + 1} +0000\ncommitter FlareGit <integrator@flaregit.com> ${seconds + 1} +0000\n\n${message}\n`;
 if (head !== identity.commit) {
  const replayTree = sha.parse((await execute(`${git} rev-parse ${q('HEAD^{tree}')}`)).trim());
  const replayEntries = (await execute(`${git} ls-tree -r -z ${q(replayTree)}`)).split('\0').filter(Boolean);
  if (await gitHash('commit', new TextEncoder().encode(commitText(replayTree))) !== head || JSON.stringify(replayEntries.sort()) !== JSON.stringify([...expectedEntries].sort())) throw Error('Protected repair HEAD differs from exact recorded patch replay');
 }
 const status = await execute(`${git} status --porcelain=v1 -z --untracked-files=all`);
 for (const entry of status.split('\0').filter(Boolean)) if (!/^(?: M|M |MM) /.test(entry) || !changed.has(entry.slice(3))) throw Error('Protected repair index or worktree changed');
 for (const file of patch.changes) {
  await ports.authorize(); await ports.writeFile(`${ports.directory}/${file.path}`, file.content); await ports.authorize();
  const actual = await ports.readFileBytes(`${ports.directory}/${file.path}`); await ports.authorize();
  if (await byteDigest(actual) !== file.digest) throw Error('Protected repair native write differs');
 }
 await execute(`${git} add -- ${patch.changes.map(file => q(file.path)).join(' ')}`, env);
 const tree = sha.parse((await execute(`${git} write-tree`, env)).trim());
 const entries = (await execute(`${git} ls-tree -r -z ${q(tree)}`)).split('\0').filter(Boolean);
 if (JSON.stringify(entries.sort()) !== JSON.stringify(expectedEntries.sort())) throw Error('Protected repair staged tree differs');
 const text = commitText(tree);
 const commit = await gitHash('commit', new TextEncoder().encode(text));
 if (head !== identity.commit && head !== commit) throw Error('Protected repair HEAD differs from original or exact replay');
 // A lost commit ACK is settled only by reading this deterministic object. No
 // second model request, different timestamp, or broader stage operation occurs.
 try { await execute(`${git} commit-tree ${q(tree)} -p ${q(parent)} -m ${q(message)}`, env); } catch { /* Read exact object below; missing/unknown remains failure. */ }
 await ports.authorize(); const written = await ports.readGitObject('commit', commit, 262144); await ports.authorize();
 if (await gitHash('commit', written) !== commit || new TextDecoder('utf-8', { fatal: true }).decode(written) !== text) throw Error('Protected repair commit was not confirmed');
 try { await execute(`${git} checkout --quiet --detach ${q(commit)}`, env); } catch { /* Exact HEAD observation is required below. */ }
 if ((await execute(`${git} rev-parse HEAD`)).trim() !== commit || (await execute(`${git} status --porcelain=v1 -z --untracked-files=all`)) !== '') throw Error('Protected repair commit checkout remains unconfirmed');
 return { commit, tree, modelAttemptId: patch.attemptId };
}

/** Native application of an actual registered unmerged index snapshot. No synthetic
 * commit/tree provenance substitutes for the independently stored conflict receipt. */
export async function applyProtectedNativeConflictRepair(planInput:ProtectedRepairPlan,contextInput:ProtectedConflictContext,snapshotInput:ProtectedConflictSnapshot,patchInput:RepairPatch,ports:ProtectedNativeRepairPorts,landing:ProtectedRepairLanding={kind:'merge'}):Promise<{commit:string;tree:string;modelAttemptId:string}>{
 const plan=structuredClone(planInput),context=structuredClone(contextInput),snapshot=validateProtectedConflictSnapshot(context,snapshotInput),patch=patchSchema.parse(structuredClone(patchInput));
 if(plan.source.kind!=='uncommitted-conflict-input'||patch.sourceDigest!==plan.source.sourceDigest||patch.sourceDigest!==await repairDigest(JSON.stringify({context,snapshot}))||patch.planDigest!==await repairDigest(JSON.stringify(plan))||plan.source.attemptId!==context.attemptId||plan.source.acceptedBase!==context.acceptedBase||JSON.stringify(plan.source.contributorCommits)!==JSON.stringify(context.contributorCommits)||new Set(patch.changes.map(file=>file.path)).size!==patch.changes.length)throw Error('Exact frozen native conflict patch binding differs');
 const changes=new Map(patch.changes.map(file=>[file.path,file]));
 for(const file of patch.changes){const planned=plan.files.find(value=>value.path===file.path),original=snapshot.files.find(value=>value.path===file.path);if(!planned||!original||file.beforeDigest!==planned.digest||file.beforeDigest!==original.digest||await repairDigest(file.content)!==file.digest||/^(<<<<<<<|=======|>>>>>>>)/m.test(file.content))throw Error('Conflict patch violates regular file boundary');}
 const execute=async(command:string,env?:Record<string,string>)=>{await ports.authorize();const result=await ports.exec(command,env);await ports.authorize();if(!result.success)throw Error('Native conflict command acknowledgement unconfirmed');return result.stdout;};
 const git=`git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c commit.gpgsign=false -c i18n.commitEncoding=UTF-8 -C ${q(ports.directory)}`;
 if((await execute(`${git} rev-parse HEAD`)).trim()!==snapshot.head)throw Error('Conflict HEAD changed');
 const heads=new TextDecoder('utf-8',{fatal:true}).decode(await ports.readFileBytes(`${ports.directory}/.git/MERGE_HEAD`)).trim().split('\n').sort();await ports.authorize();if(JSON.stringify(heads)!==JSON.stringify([...snapshot.mergeHeads].sort()))throw Error('Conflict merge parents changed');
 const index=(await execute(`${git} ls-files --stage -z`)).split('\0').filter(Boolean).map(value=>{const match=/^(100644|100755) ([a-f0-9]{40}) ([0-3])\t(.+)$/.exec(value);if(!match)throw Error('Unsupported conflict index');return[match[4],match[1],Number(match[3]),match[2]];}).sort();
 if(JSON.stringify(index)!==JSON.stringify(snapshot.index.map(value=>[value.path,value.mode,value.stage,value.object]).sort()))throw Error('Conflict native index changed');
 const expected:string[]=[];
 for(const file of snapshot.files){const ancestors=file.path.split('/').map((_,i)=>`${ports.directory}/${file.path.split('/').slice(0,i+1).join('/')}`);await execute(`${ancestors.map(path=>`test ! -L ${q(path)}`).join(' && ')} && test -f ${q(`${ports.directory}/${file.path}`)}`);await ports.authorize();const bytes=(await ports.readFileBytes(`${ports.directory}/${file.path}`)).slice();await ports.authorize();if(await byteDigest(bytes)!==file.digest)throw Error('Original native conflict bytes changed');const proposed=changes.get(file.path);expected.push(`${file.mode} blob ${await gitHash('blob',proposed?new TextEncoder().encode(proposed.content):bytes)}\t${file.path}`);}
 const original=await ports.readGitObject('commit',snapshot.head,262144);await ports.authorize();if(await gitHash('commit',original)!==snapshot.head)throw Error('Native conflict parent object differs');const originalText=new TextDecoder('utf-8',{fatal:true}).decode(original),seconds=Number(/^committer .* ([0-9]+) [+-][0-9]{4}$/m.exec(originalText)?.[1]);if(!Number.isSafeInteger(seconds)||seconds<0||seconds>=4102444800)throw Error('Native conflict timestamp unavailable');
 const env={GIT_AUTHOR_NAME:'FlareGit',GIT_AUTHOR_EMAIL:'integrator@flaregit.com',GIT_COMMITTER_NAME:'FlareGit',GIT_COMMITTER_EMAIL:'integrator@flaregit.com',GIT_AUTHOR_DATE:`@${seconds+1} +0000`,GIT_COMMITTER_DATE:`@${seconds+1} +0000`,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
 for(const file of patch.changes){await ports.authorize();await ports.writeFile(`${ports.directory}/${file.path}`,file.content);await ports.authorize();if(await byteDigest(await ports.readFileBytes(`${ports.directory}/${file.path}`))!==file.digest)throw Error('Native conflict write differs');await ports.authorize();}
 await execute(`${git} add -- ${patch.changes.map(file=>q(file.path)).join(' ')}`,env);
 if(await execute(`${git} ls-files -u -z`)!=='')throw Error('Unresolved native conflict remains');
 const tree=sha.parse((await execute(`${git} write-tree`,env)).trim()),entries=(await execute(`${git} ls-tree -r -z ${q(tree)}`)).split('\0').filter(Boolean);
 if(JSON.stringify(entries.sort())!==JSON.stringify(expected.sort()))throw Error('Conflict staged tree differs from exact patch');
 const parents=landing.kind==='squash'?[sha.parse(landing.acceptedBase)]:[snapshot.head,...snapshot.mergeHeads];if(landing.kind==='squash'&&parents[0]!==context.acceptedBase)throw Error('Conflict squash base differs');
 const attribution=Object.entries(context.contributorCommits).map(([taskId,commit])=>`Contributor ${taskId}: ${commit}`).join('\n');
 const message=`FlareGit protected conflict repair ${patch.attemptId}\nProtected landing: ${landing.kind}\n${attribution}\n\n${landing.kind==='squash'?(landing.coauthors??[]).join('\n'):''}`.trimEnd();
 const text=`tree ${tree}\n${parents.map(parent=>`parent ${parent}\n`).join('')}author FlareGit <integrator@flaregit.com> ${seconds+1} +0000\ncommitter FlareGit <integrator@flaregit.com> ${seconds+1} +0000\n\n${message}\n`,commit=await gitHash('commit',new TextEncoder().encode(text));
 try{await execute(`${git} commit-tree ${q(tree)} ${parents.map(parent=>`-p ${q(parent)}`).join(' ')} -m ${q(message)}`,env);}catch{/* Exact deterministic object readback below is mandatory. */}
 await ports.authorize();const written=await ports.readGitObject('commit',commit,262144);await ports.authorize();if(await gitHash('commit',written)!==commit||new TextDecoder('utf-8',{fatal:true}).decode(written)!==text)throw Error('Native conflict commit unconfirmed');
 try{await execute(`${git} reset --hard ${q(commit)}`,env);}catch{/* Reset ACK alone never proves completion. */}
 if((await execute(`${git} rev-parse HEAD`)).trim()!==commit||await execute(`${git} status --porcelain=v1 -z --untracked-files=all`)!=='')throw Error('Native conflict commit checkout unconfirmed');
 return{commit,tree,modelAttemptId:patch.attemptId};
}

/** Recreate only the original unmerged input. The mandatory fixed native inspector
 * must confirm the entire stored index/file inventory before any recorded patch runs. */
export async function reconstructProtectedNativeConflict(context:ProtectedConflictContext,snapshotInput:ProtectedConflictSnapshot,ports:ProtectedNativeRepairPorts&{inspectConflict():Promise<ProtectedConflictSnapshot>}):Promise<void>{
 const snapshot=validateProtectedConflictSnapshot(context,snapshotInput),git=`git -c core.hooksPath=/dev/null -c core.fsmonitor=false -C ${q(ports.directory)}`;
 await ports.authorize();const head=await ports.exec(`${git} rev-parse HEAD`);await ports.authorize();if(!head.success||head.stdout.trim()!==snapshot.head)throw Error('Original unverified conflict HEAD differs');
 const refs=snapshot.mergeHeads.map(commit=>{const ids=Object.entries(context.contributorCommits).filter(([,value])=>value===commit).map(([id])=>id);if(ids.length!==1)throw Error('Ambiguous original merge input requires explicit recovery');return `refs/flaregit/tasks/${ids[0]}`;});
 await ports.authorize();const merged=await ports.exec(`${git} merge --no-ff --no-commit -- ${refs.map(q).join(' ')}`);await ports.authorize();if(merged.success)throw Error('Original native text conflict did not recur');
 const observed=validateProtectedConflictSnapshot(context,await ports.inspectConflict());await ports.authorize();
 if(JSON.stringify(observed)!==JSON.stringify(snapshot))throw Error('Reconstructed native index or worktree digest differs from the original source');
}
