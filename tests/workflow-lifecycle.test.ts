import {captureTrustedGitSource} from "../src/server/trusted-git-source";
import {bindBuildManifest} from "../src/server/static-build-artifact";
import type {IsolatedPreviewBuildLedger} from "../src/server/isolated-preview-build";
import type {UntrustedExecutionNamespace} from "../src/server/untrusted-execution";
import { nativeFunding } from "./support/native-funding.js";
import { accountKeyFor } from "../src/server/projects.js";
import { expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "../src/server/env.js";
import type { CandidateGeneration } from "../src/core/types.js";
import type { Ledger } from "../src/server/durable-object.js";

import {Database} from "bun:sqlite";
import {RetainedInputs,retainedInputSchema,type RetainedInput} from "../src/server/retained-inputs";
import {RetainedCredentialIncidents} from "../src/server/retained-credential-incidents";
import {CoreGitOperationLedger} from "../src/server/core-git-budget";
const fixtureRemote="https://"+"a".repeat(32)+".artifacts.cloudflare.net/repo";
/** Synthetic authority fixture; receipt and funding modules use real SQLite. Git refs use local bare repositories. */
function retainedFixture(base:string|null,commit:string,candidateId:string,acceptedTarget?:import("../src/core/accepted-target").UnbornAcceptedTarget,additional:Record<string,string>={},stackedChild?:{taskId:string;parentTaskId:string;base:string}){
 const db=new Database(':memory:');const storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}} as unknown as DurableObjectStorage;
 const pins=new RetainedInputs(storage),credentials=new RetainedCredentialIncidents(storage),funding=new CoreGitOperationLedger(storage);const issued=new Map<string,RetainedInput>();
 return {savedPins:()=>db.query<{doc:string},[]>("SELECT doc FROM retained_inputs").all().map(row=>JSON.parse(row.doc) as RetainedInput),pendingCredentials:()=>db.query<{n:number},[]>("SELECT COUNT(*) AS n FROM retained_credential_incidents WHERE status<>'revoked'").get()!.n,reserveCoreGitOperation:async(id:string,key:string)=>funding.reserve(id,key,{accountUsdMicros:10000000,globalUsdMicros:10000000}),
 prepareRetainedInput:async(taskId:string,workflowId:string,selectedCandidate:string,id:string)=>{if((taskId!=='one'&&!additional[taskId])||workflowId!=='registered-parent'||selectedCandidate!==candidateId)throw Error('Synthetic authority scope mismatch');const incarnation='11111111-1111-4111-8111-111111111111';const selectedCommit=additional[taskId]??commit,selectedBase=stackedChild?.taskId===taskId?stackedChild.base:base;const input=retainedInputSchema.parse({id,version:1,projectId:'p123456789abc',incarnation,taskId,commit:selectedCommit,base:selectedBase,canonicalRepoName:'repo',workspaceRepoName:'repo',branch:`task/${taskId}`,protectedRef:`refs/flaregit/inputs/${incarnation}/${taskId}/${selectedCommit}`,protectedBaseRef:selectedBase===null?null:`refs/flaregit/inputs/${incarnation}/${taskId}/${selectedBase}`,...(stackedChild?.taskId===taskId?{dependsOn:stackedChild.parentTaskId,stackedOn:{taskId:stackedChild.parentTaskId,commit:stackedChild.base,ref:`refs/flaregit/inputs/${incarnation}/${stackedChild.parentTaskId}/${stackedChild.base}`}}:{}),...(acceptedTarget?{acceptedTarget}:{}),workflowId,candidateId,actorId:'fixture-human',ownerId:'fixture-human',accountKey:await accountKeyFor('fixture-human')});issued.set(id,input);return input;},
 assertRetainedInput:async(input:RetainedInput)=>JSON.stringify(issued.get(input.id))===JSON.stringify(retainedInputSchema.parse(input)),
 beginRetainedCredential:async(...args:Parameters<RetainedCredentialIncidents['begin']>)=>credentials.begin(...args),recordRetainedCredential:async(...args:Parameters<RetainedCredentialIncidents['record']>)=>credentials.record(...args),
 revokeRetainedCredential:async(id:string,purpose:'workspace'|'canonical')=>{const receipt=credentials.credentialForRevocation(id,purpose);if(!receipt)return false;credentials.markAttempt(id,purpose);await credentials.markRevoked(id,purpose,receipt.token);return true;},
 markRetainedCredentialRevoked:async(...args:Parameters<RetainedCredentialIncidents['markRevoked']>)=>credentials.markRevoked(...args),recordRetainedInput:async(...args:Parameters<RetainedInputs['record']>)=>pins.record(...args),
 accountLifecycle:async()=>"active",getWorkflowRun:async()=>({actorId:'fixture-human'}),roleOf:async()=>"owner",logActivity:async()=>{},getBilling:async()=>({plan:'free'})};
}
function lifecycleFunding(retention:ReturnType<typeof retainedFixture>){const funding=nativeFunding();return {...funding,CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS:'10000000',CORE_GIT_GLOBAL_MONTHLY_USD_MICROS:'10000000',REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:(name:string)=>name==='global'?{...funding.REPOSITORY_CONTROLLER.get(funding.REPOSITORY_CONTROLLER.idFromName('global')),reserveCoreGitOperation:retention.reserveCoreGitOperation}:retention}};}

mock.module("cloudflare:workers", () => ({
  WorkflowEntrypoint: class { constructor(_ctx: unknown, public env: Env) {} },
  DurableObject: class {},
}));
const { FlareGitIntegrationWorkflow } = await import("../src/server/workflow.js");

// Four sequential publication/recovery attempts spawn real local Git processes.
// Keep a bounded integration deadline without inheriting runner Git hooks/config.
test("publication releases its ephemeral checkout while preserving the reviewed immutable Git ref", async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-lifecycle-"));
  const canonical = join(root, "canonical.git"), seed = join(root, "seed"), workspace = join(root, "publish");
  const git = async (args: string[]) => {
    const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_TERMINAL_PROMPT:"0", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@localhost", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@localhost" } });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode) throw new Error(stderr);
    return stdout.trim();
  };
  try {
    await git(["init", "--bare", "--initial-branch=main", canonical]);
    await git(["clone", canonical, seed]);
    await Bun.write(join(seed, "feature.txt"), "base");
    await git(["-C", seed, "add", "."]); await git(["-C", seed, "commit", "-m", "base"]);
    await git(["-C", seed, "push", "origin", "main"]);
    const base = await git(["-C", seed, "rev-parse", "HEAD"]);
    await Bun.write(join(seed, "feature.txt"), "reviewed feature");
    await git(["-C", seed, "commit", "-am", "candidate"]);
    const commit = await git(["-C", seed, "rev-parse", "HEAD"]);
    await git(["-C", seed, "push", "origin", `${commit}:refs/flaregit/candidates/test`]);
    const retention=retainedFixture(base,commit,"test");
    let destroyed = 0,publicationReadbackObserved=false,withdrawAfterFunding=false;
    const env = {
      ...lifecycleFunding(retention),
      ARTIFACTS: { get: async () => ({ info: async () => ({ remote: fixtureRemote }), createToken: async (scope:string) => ({ plaintext: "fixture-token",scope,expiresAt:new Date(Date.now()+900000).toISOString() }),revokeToken:async()=>true,[Symbol.dispose]:()=>{} }) },
      INTEGRATOR: { getByName: () => ({
        exec: async (argv: string[]) => {
          const command = argv[2]!.replaceAll(fixtureRemote,canonical).replaceAll("/workspace/publish", workspace);
          if(command.includes("merge-base --is-ancestor"))publicationReadbackObserved=true;
          const child = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe",env:{...process.env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_TERMINAL_PROMPT:"0"} });
          const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
          return { success: exitCode === 0, stdout, stderr, exitCode };
        },
        destroy: async () => { destroyed++; await rm(workspace, { recursive: true, force: true }); },
      }) },
    } as unknown as Env;
    const workflow = new FlareGitIntegrationWorkflow({} as ExecutionContext, env);
    Object.assign(workflow,{projectId:"p123456789abc",computeAccountKey:await accountKeyFor("fixture-human"),computeWorkflowId:"registered-parent"});
    const callable = workflow as unknown as { casPush(candidate: CandidateGeneration, commit: string, stub: Ledger, branch: string): Promise<{ ok: boolean }> };
    let authorized = false, authorizationCalls = 0;
    const ledger = { ...retention,getState: async () => ({ canonicalRepoName: "repo" }), authorizeCandidatePublication: async () => { authorizationCalls++; return authorized; } } as unknown as Ledger;
    const funded=workflow as unknown as{fundedRetainedCommand(input:RetainedInput,stub:Ledger):Promise<void>};const originalFunded=funded.fundedRetainedCommand.bind(workflow);
    funded.fundedRetainedCommand=async(input,stub)=>{await originalFunded(input,stub);if(withdrawAfterFunding&&publicationReadbackObserved)authorized=false;};
    const publication = { id: "test", expectedAcceptedBase: base,participatingTaskIds:["one"] } as CandidateGeneration;
    const denied = await callable.casPush(publication, commit, ledger, "main");
    expect(denied.ok).toBe(false);
    if(base===null)expect(await git(["--git-dir",canonical,"for-each-ref","--format=%(refname)","refs/heads/main"])).toBe("");else expect(await git(["--git-dir", canonical, "rev-parse", "main"])).toBe(base);
    authorized=true;withdrawAfterFunding=true;publicationReadbackObserved=false;
    const withdrawn=await callable.casPush(publication,commit,ledger,"main");expect(withdrawn.ok).toBe(false);expect(await git(["--git-dir",canonical,"rev-parse","main"])).toBe(base);expect(retention.pendingCredentials()).toBe(0);
    withdrawAfterFunding=false;
    authorized = true;
    const result = await callable.casPush(publication, commit, ledger, "main");
    expect(result.ok).toBe(true);
    authorized = false;
    // Lost-ACK recovery proves the already committed SHA before checking new-dispatch authority.
    const recovered = await callable.casPush(publication, commit, ledger, "main");
    expect(recovered.ok).toBe(true);
    expect(authorizationCalls).toBe(4);
    expect(destroyed).toBe(4);expect(retention.pendingCredentials()).toBe(0);
    expect(await Bun.file(join(workspace, ".git", "HEAD")).exists()).toBe(false);
    expect(await git(["--git-dir", canonical, "rev-parse", "refs/flaregit/candidates/test"])).toBe(commit);
    expect(await git(["--git-dir", canonical, "rev-parse", "main"])).toBe(commit);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

test("operation error survives failed shutdown and cleanup failure becomes durable activity", async () => {
  const activities: string[] = [];
  let destroyCalls = 0;
  const original = new Error("Original fetch failure");
  const retention=retainedFixture("a".repeat(40),"b".repeat(40),"test");
  const funding=lifecycleFunding(retention);
  const env = {
    ...funding,
    ARTIFACTS: { get: async () => ({ info: async () => ({ remote:fixtureRemote }), createToken: async (scope:string) => ({ plaintext: "fixture-token",scope,expiresAt:new Date(Date.now()+900000).toISOString() }),revokeToken:async()=>true,[Symbol.dispose]:()=>{} }) },
    INTEGRATOR: { getByName: () => ({ exec: async () => { throw original; }, destroy: async () => { destroyCalls++; throw new Error("Shutdown failed"); } }) },
    REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: (name: string) => name === "global" ? funding.REPOSITORY_CONTROLLER.get(funding.REPOSITORY_CONTROLLER.idFromName("global")) : ({...retention, accountLifecycle:async()=>"active",getWorkflowRun:async()=>({actorId:"fixture-human"}),roleOf:async()=>"owner",logActivity: async (_actor: string, kind: string) => { activities.push(kind); } }) },
  } as unknown as Env;
  const workflow = new FlareGitIntegrationWorkflow({} as ExecutionContext, env);
    Object.assign(workflow,{projectId:"p123456789abc",computeAccountKey:await accountKeyFor("fixture-human"),computeWorkflowId:"registered-parent"});
  const callable = workflow as unknown as { casPush(candidate: CandidateGeneration, commit: string, stub: Ledger, branch: string): Promise<unknown> };
  await expect(callable.casPush({ id: "test", expectedAcceptedBase: "a".repeat(40),participatingTaskIds:["one"] } as CandidateGeneration, "b".repeat(40), {...retention, getState: async () => ({ canonicalRepoName: "repo" }) } as unknown as Ledger, "main")).rejects.toBe(original);
  expect(destroyCalls).toBe(1);expect(retention.pendingCredentials()).toBe(0);
  expect(activities).toEqual(["container.cleanup_failed"]);
});

test.each(["normal","evidence-failure","preview-failure","git-integrity","git-integrity-no-optional","unborn-one","unborn-batch","unborn-conflict","unborn-stack"] as const)("candidate remains durable through optional storage state: %s", async (mode) => {
  const uploadFails=mode==="evidence-failure",previewFails=mode==="preview-failure";
  const root = await mkdtemp(join(tmpdir(), "external-workflow-"));
  const canonical = join(root, "canonical.git"), seed = join(root, "seed"), work = join(root, "integration");
  const git = async (args: string[]) => {
    const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@localhost", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@localhost" } });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode) throw new Error(stderr); return stdout.trim();
  };
  try {
    await git(["init", "--bare", "--initial-branch=main", canonical]); await git(["clone", canonical, seed]);
    await import("node:fs/promises").then(fs=>fs.mkdir(join(seed,"src"),{recursive:true})); await Bun.write(join(seed, "src/feature.ts"), "throw new Error('Customer code must never execute');");
    if(previewFails)await Bun.write(join(seed,"index.html"),"<main>fixture static entry</main>");
    await git(["-C", seed, "add", "."]); await git(["-C", seed, "commit", "-m", "base"]); await git(["-C", seed, "push", "origin", "main"]);
    const base = mode.startsWith("unborn")?null:await git(["-C", seed, "rev-parse", "HEAD"]);
    if(mode.startsWith("unborn"))await git(["--git-dir",canonical,"update-ref","-d","refs/heads/main"]);
    await git(["-C", seed, "checkout", "-b", "task/one"]); await import("node:fs/promises").then(fs=>fs.mkdir(join(seed,"src"),{recursive:true})); await Bun.write(join(seed, "src/feature.ts"), "throw new Error('Functional source still must never execute');");
    await git(["-C", seed, "commit", "-am", "feature"]); await git(["-C", seed, "push", "origin", "task/one"]);
    const head = await git(["-C", seed, "rev-parse", "HEAD"]);
    const unbornTarget:import("../src/core/accepted-target").UnbornAcceptedTarget|undefined=mode.startsWith("unborn")?{kind:"unborn",projectId:"p123456789abc",incarnation:"11111111-1111-4111-8111-111111111111",canonicalRepoName:"repo",ref:"refs/heads/main",branch:"main",acceptedCommit:null,acceptedVersion:0,requirements:[],policyVersion:1,policy:{kind:"git-integrity",allowedScope:["*"],protectedPaths:[".flaregit/"],landing:"merge"}}:undefined;
    let secondHead:string|undefined;
    if(mode==="unborn-stack"){await git(["-C",seed,"checkout","-b","task/two"]);await Bun.write(join(seed,"second.txt"),"Actual stacked child\n");await git(["-C",seed,"add","."]);await git(["-C",seed,"commit","-m","Actual child checkpoint"]);secondHead=await git(["-C",seed,"rev-parse","HEAD"]);await git(["-C",seed,"push","origin","task/two"]);}
    if(mode==="unborn-batch"||mode==="unborn-conflict"){await git(["-C",seed,"checkout","--orphan","task/two"]);await git(["-C",seed,"rm","-rf","."]);const secondPath=mode==="unborn-conflict"?"src/feature.ts":"second.txt";await import("node:fs/promises").then(fs=>fs.mkdir(join(seed,"src"),{recursive:true}));await Bun.write(join(seed,secondPath),"Actual second independent contributor\n");await git(["-C",seed,"add","."]);await git(["-C",seed,"commit","-m","Second independent contributor"]);secondHead=await git(["-C",seed,"rev-parse","HEAD"]);await git(["-C",seed,"push","origin","task/two"]);}
    const retention=retainedFixture(base,head,"external-one",unbornTarget,secondHead?{two:secondHead}:{},mode==="unborn-stack"?{taskId:"two",parentTaskId:"one",base:head}:undefined);
    let destroyed = 0, aiCalls = 0;
    const commands: string[] = [], stored: string[] = [];
    let previewStops=0,previewSeals=0,previewRuns=0;
    const previewLedger:IsolatedPreviewBuildLedger={
      preparePreviewExecution:async request=>{const tree=await git(['--git-dir',canonical,'rev-parse',`${request.commit}^{tree}`]),scope={attemptId:crypto.randomUUID(),projectId:request.projectId,incarnation:'11111111-1111-4111-8111-111111111111',commit:request.commit,tree,policyDigest:'c'.repeat(64)};if(!request.nativeCandidate)throw Error('Synthetic preview requires native candidate');return {snapshot:{kind:'preview-execution',projectId:scope.projectId,incarnation:scope.incarnation,commit:scope.commit,tree:scope.tree,policyDigest:scope.policyDigest,actorId:'fixture-human',accountKey:await accountKeyFor('fixture-human'),canonicalRepoName:'repo',providerRepoId:'synthetic-provider-id',target:{kind:'native-candidate',...request.nativeCandidate,evidenceId:'ev_12345678-123'},generation:null,image:`registry.cloudflare.com/${'d'.repeat(32)}/synthetic-untrusted@sha256:${'e'.repeat(64)}`},scope,sourceDigest:null};},
      claimPreviewExecutionInvocation:async(context,invocationId)=>({status:'owned',context,invocationId}),finishPreviewExecutionInvocation:async()=>{},previewExecutionDispatchState:async()=> 'not_dispatched',previewExecutionSnapshot:async context=>structuredClone(context),
      capturePreviewExecutionSource:async context=>captureTrustedGitSource({scope:context.scope,provider:{providerRepoId:context.snapshot.providerRepoId,canonicalRepoName:'repo'},reader:{readObject:async(kind,hash)=>{const child=Bun.spawn(['git','--git-dir',canonical,'cat-file',kind,hash],{stdout:'pipe',stderr:'pipe'});const [bytes,stderr,code]=await Promise.all([new Response(child.stdout).arrayBuffer(),new Response(child.stderr).text(),child.exited]);if(code)throw Error(stderr);return new Uint8Array(bytes);}},authorize:async()=>{}}),
      bindPreviewExecutionSource:async(context,source)=>({...context,sourceDigest:source.sourceManifest.digest}),assertPreviewExecutionSource:async()=>{},preparePreviewExecutionGrant:async()=>{},authorizePreviewExecution:async()=>true,claimPreviewExecutionDispatch:async context=>({context,phase:'dispatched'}),sealPreviewExecution:async()=>{previewSeals++;},
    };
    // Explicit synthetic execution RPC returns immutable output; actual Git capture and storage orchestration remain exercised.
    const previewNamespace:UntrustedExecutionNamespace={getByName:()=>({outputArtifact:async()=>null,prepare:async()=>{},run:async(scope,source)=>{previewRuns++;const files=[{path:'app.js',kind:'file' as const,bytes:new TextEncoder().encode('synthetic isolated static output')},{path:'index.html',kind:'file' as const,bytes:new TextEncoder().encode('<main>synthetic isolated page</main>')}];return {manifest:await bindBuildManifest('static',scope,files,source.digest),files,acceptanceEvidence:false};},stop:async()=>{previewStops++;return{stopped:true};}})};
    if(previewFails)Object.assign(retention,previewLedger,{previewStorageScope:async(commit:string)=>({projectId:'p123456789abc',incarnation:'11111111-1111-4111-8111-111111111111',commit,accountKey:await accountKeyFor('fixture-human')})});

    const env = {
      ...lifecycleFunding(retention),
      ...(previewFails?{UNTRUSTED_EXECUTION:previewNamespace}:{}),
      ...(mode==="git-integrity-no-optional"?{MANAGED_ACCOUNT_MONTHLY_USD_MICROS:"1000000",MANAGED_GLOBAL_MONTHLY_USD_MICROS:"2000000"}:{}),
      ARTIFACTS: { get: async () => ({ info: async () => ({ remote: fixtureRemote }), createToken: async (scope:string) => ({ plaintext: "fixture-token",scope,expiresAt:new Date(Date.now()+900000).toISOString() }),revokeToken:async()=>true,[Symbol.dispose]:()=>{} }) },
      EVIDENCE_BUCKET: { head:async()=>null, put: async (key: string) => { stored.push(key); if(uploadFails || (previewFails && key.endsWith("app.js")))throw new Error("R2 unavailable"); return {etag:"confirmed-fixture"}; } }, AI: { run: async () => { aiCalls++; throw new Error("AI must not run"); } },
      INTEGRATOR: { getByName: () => ({ exec: async (argv: string[]) => {
        const original = argv[2]!; commands.push(original);
        // Synthetic verifier/build output isolates storage failure; Git refs remain real.
        if(previewFails && original.includes("verification/cli.ts ticket-booking"))return {success:true,stderr:"",stdout:JSON.stringify({id:"ev_12345678-123",status:"passed",candidateTree:"a".repeat(40),verifierIdentity:"synthetic-test-only"})};
        if(previewFails && original.includes("test -f") && original.includes("index.html"))return {success:true,stderr:"",stdout:""};
        if(previewFails && original.includes("build-preview.ts"))return {success:true,stderr:"",stdout:""};
        if(previewFails && original.includes("const root="))return {success:true,stderr:"",stdout:JSON.stringify(["index.html","app.js"].map(path=>({path,size:15,sha256:new Bun.CryptoHasher("sha256").update("synthetic asset").digest("hex")})))};
        const command = original.replaceAll(fixtureRemote,canonical).replaceAll("/workspace/integration", work).replaceAll("/opt/flaregit", process.cwd());
        const child = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        return { success: exitCode === 0, stdout, stderr, exitCode };
      }, readFileBytes:async()=>new TextEncoder().encode("synthetic asset"), destroy: async () => { destroyed++; await rm(work, { recursive: true, force: true }); } }) },
    } as unknown as Env;
    const task = { ...(unbornTarget?{acceptedTarget:unbornTarget}:{}),id: "one", baseCommit: base, currentCommit: head, allowedScope: ["src/feature.ts"], workspace: { repoName: "repo", branch: "task/one" }, contributor: { name: "Fixture", id: "one" } };
    const candidate: CandidateGeneration = { ...(unbornTarget?{acceptedTarget:unbornTarget}:{}),id: "external-one", attemptNumber: 1, frozenRequirements: [], repairAttempts: [], status: "composing", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expectedAcceptedBase: base, participatingTaskIds: ["one"], participatingCommits: { one: head }, frozenPolicyVersion: 1, frozenVerificationPolicy: { kind: "command", test: "touch CUSTOMER_COMMAND_EXECUTED", install: "touch CUSTOMER_INSTALL_EXECUTED", allowedScope: ["src/feature.ts"], protectedPaths: ["tests/"] }, frozenExternalChecksPolicy: { version: 1, mode: "external", checks: [{ id: "check", providerId: "provider", required: true }] }, frozenContributorProofs: [{ id: "one", commit: head, baseCommit: base, ref: "refs/flaregit/tasks/one", allowedScope: ["src/feature.ts"] }] };
    if(previewFails){delete candidate.frozenExternalChecksPolicy;candidate.frozenVerificationPolicy={};}
    if(mode.startsWith("git-integrity")||mode.startsWith("unborn")){delete candidate.frozenExternalChecksPolicy;candidate.frozenVerificationPolicy={kind:"git-integrity",allowedScope:["*"],protectedPaths:[".flaregit/"],landing:"merge"};}
    if(secondHead){candidate.participatingTaskIds.push("two");candidate.participatingCommits.two=secondHead;candidate.frozenContributorProofs!.push({id:"two",commit:secondHead,baseCommit:mode==="unborn-stack"?head:null,...(mode==="unborn-stack"?{stackedOn:{taskId:"one",commit:head,ref:"refs/flaregit/tasks/one"}}:{}),ref:"refs/flaregit/tasks/two",allowedScope:[mode==="unborn-conflict"?"src/feature.ts":"second.txt"]});}
    if(mode==="unborn-stack")candidate.participatingTaskIds.reverse();
    const evidence: import("../src/core/types.js").VerificationEvidence[] = [];
    const activities:string[]=[],candidatePins:Array<{ref:string;observedCommit:string;workflowId:string}>=[];
    const ledger = {...retention,recordCandidateProtectedPin:async(_candidateId:string,_commit:string,proof:{ref:string;observedCommit:string;workflowId:string})=>{candidatePins.push(proof);},recordScopedEvidenceCopy:async()=>{},previewStorageScope:async(commit:string)=>({projectId:"p123456789abc",incarnation:"11111111-1111-4111-8111-111111111111",commit,accountKey:await accountKeyFor("fixture-human")}),getWorkflowRun:async()=>({actorId:"fixture-human"}),roleOf:async()=>"owner", logActivity:async(_actor:string,kind:string)=>{activities.push(kind);}, getState: async () => ({ projectId:"p123456789abc",projectName:"Synthetic lifecycle fixture",canonicalRepoName: "repo", candidates:{[candidate.id]:structuredClone(candidate)}, evidence:Object.fromEntries(evidence.map(proof=>[proof.id,structuredClone(proof)])), decisions:{},journal:[],policyVersion:1,verificationPolicy:structuredClone(candidate.frozenVerificationPolicy),acceptedState:{currentCommit:base,acceptedAt:"2026-10-04",buildDigest:"synthetic",activeRequirements:[],history:[]}, tasks: { one: task,...(secondHead?{two:{...task,id:"two",baseCommit:mode==="unborn-stack"?head:null,...(mode==="unborn-stack"?{dependsOn:"one"}:{}),currentCommit:secondHead,allowedScope:[mode==="unborn-conflict"?"src/feature.ts":"second.txt"],workspace:{repoName:"repo",branch:"task/two"}}}:{}) }, defaultBranch: "main" }), recordComposition: async () => {}, requirementGatePlan: async () => [], recordRequirementChecks: async () => null, recordVerification: async (_id: string, _commit: string, proof: import("../src/core/types.js").VerificationEvidence) => { evidence.push(proof); } } as unknown as Ledger;
    const workflow = new FlareGitIntegrationWorkflow({} as ExecutionContext, env);
    Object.assign(workflow,{projectId:"p123456789abc",computeAccountKey:await accountKeyFor("fixture-human"),computeWorkflowId:"registered-parent"});
    const callable = workflow as unknown as { composeRepairVerify(candidate: CandidateGeneration, params: { projectId: string; taskIds: string[] }, ledger: Ledger,parentWorkflowId?:string): Promise<{ ok: boolean; commit?: string }> };
    const result = await callable.composeRepairVerify(candidate, { projectId: "p123456789abc", taskIds: ["one"],accountKey:await accountKeyFor("fixture-human") } as {projectId:string;taskIds:string[]}, ledger,"registered-parent");
    if(mode==="unborn-conflict"){expect(result.ok).toBe(false);expect(retention.savedPins()).toHaveLength(2);expect(evidence).toHaveLength(0);expect(await git(["--git-dir",canonical,"rev-parse","refs/heads/task/one"])).toBe(head);expect(await git(["--git-dir",canonical,"rev-parse","refs/heads/task/two"])).toBe(secondHead!);expect(await git(["--git-dir",canonical,"for-each-ref","--format=%(refname)","refs/heads/main"])).toBe("");expect(retention.pendingCredentials()).toBe(0);expect(destroyed).toBe(1);return;}
    expect(result.ok).toBe(true); expect(destroyed).toBe(1); expect(aiCalls).toBe(0);expect(retention.pendingCredentials()).toBe(0);const savedPins=retention.savedPins();expect(savedPins).toHaveLength(secondHead?2:1);expect(await git(["--git-dir",canonical,"rev-parse",savedPins[0]!.protectedRef])).toBe(head);const protectedBase=savedPins[0]!.protectedBaseRef;if(base===null){expect(protectedBase).toBeNull();expect(await git(["--git-dir",canonical,"rev-list","--max-parents=0",head])).toMatch(/^[a-f0-9]{40}$/);}else{if(protectedBase===null)throw Error("Committed fixture needs a retained base ref");expect(await git(["--git-dir",canonical,"rev-parse",protectedBase])).toBe(base);}
    if(mode==="unborn-stack"){const childPin=savedPins.find(pin=>pin.taskId==="two")!;expect(childPin.base).toBe(head);expect(childPin.stackedOn).toMatchObject({taskId:"one",commit:head,ref:savedPins[0]!.protectedRef});if(childPin.protectedBaseRef===null)throw Error("Stacked contribution requires actual parent base pin");expect(await git(["--git-dir",canonical,"rev-parse",childPin.protectedBaseRef])).toBe(head);}
    if(secondHead){expect((await git(["--git-dir",canonical,"rev-list","--max-parents=0",result.commit!] )).split("\n")).toHaveLength(mode==="unborn-stack"?1:2);expect(await git(["--git-dir",canonical,"ls-tree","--name-only",result.commit!])).toContain("second.txt");}
    expect(candidatePins).toEqual([{ref:"refs/flaregit/candidates/external-one",observedCommit:result.commit!,workflowId:"registered-parent"}]);
    expect(evidence[0]?.verifierIdentity).toBe(previewFails?"synthetic-test-only":"flaregit-native-integrity-v1");
    expect(activities.includes("evidence.copy_failed")).toBe(uploadFails);
    expect(stored).toHaveLength(previewFails?2:1);
    if(previewFails){expect(previewStops).toBe(1);expect(previewSeals).toBe(1);expect(stored.some(key=>key.endsWith("index.html"))).toBe(false);expect(activities).toContain("preview.failed");expect(await (env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName("global")) as unknown as Ledger).nativeComputeFailure(`build-p123456789abc-${result.commit}`)).toBe(true);expect(await (env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName("global")) as unknown as Ledger).previewStorageWriterState(`builds/p123456789abc/${result.commit}`)).toMatchObject({unfinished:true});}
    else expect(stored[0]).toMatch(/^evidence\//);
    expect(commands.some((command) => command.includes("--native-integrity"))).toBe(!previewFails);
    expect(previewRuns>0).toBe(previewFails);
    expect(commands.some((command) => command.includes("build-preview") || command.includes("verification/cli.ts custom "))).toBe(false);
    expect(await git(["--git-dir", canonical, "rev-parse", "refs/flaregit/candidates/external-one"])).toBe(result.commit!);
    if(base===null)expect(await git(["--git-dir",canonical,"for-each-ref","--format=%(refname)","refs/heads/main"])).toBe("");else expect(await git(["--git-dir", canonical, "rev-parse", "main"])).toBe(base);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("optional mirror sandbox cannot consume the reserved floor while core verification can",async()=>{
 const funding=nativeFunding(),key=await accountKeyFor("fixture-human");let allocations=0;
 const env={...funding,INTEGRATOR:{getByName:()=>{allocations++;return{destroy:async()=>{}};}}} as unknown as Env;
 const global=env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName("global")) as unknown as Ledger;
 const budget=(await import("../src/server/projects")).managedBudget(env);
 for(const [runId,accountKey] of [["optional-a",key],["optional-b","other-account"]])expect((await global.reserveManagedSpend({runId:runId!,accountKey:accountKey!,resourceKind:"managed-agent",usdMicros:4000000,maxInputBytes:100,maxOutputTokens:10,maxCalls:1,maxContainerSeconds:30},budget)).allowed).toBe(true);
 const workflow=new FlareGitIntegrationWorkflow({} as ExecutionContext,env);Object.assign(workflow,{projectId:"p123456789abc",computeAccountKey:key,computeWorkflowId:"registered-parent"});
 const callable=workflow as unknown as {sandbox:(id:string,kind?:import("../src/server/managed-spend-ledger").NativeComputeKind)=>Promise<{destroy():Promise<void>}>};
 await expect(callable.sandbox("mirror-explicit","native-optional")).rejects.toThrow("Native compute budget unavailable");expect(allocations).toBe(0);
 const core=await callable.sandbox("verification-core");expect(allocations).toBe(1);await core.destroy();
});

// Actual workflow orchestration; compose output and controller ports are local fixtures.
test.each([false,true])("plain native Git workflow closes verification before review; cleanup failure=%s",async(failCleanup)=>{
 const events:string[]=[],candidate={id:'native-candidate',frozenVerificationPolicy:{kind:'git-integrity'},participatingTaskIds:['one']} as unknown as CandidateGeneration;
 const ledger={claimLanding:async()=>({candidate}),declareIntegrationNativeRuntime:async()=>{events.push('coverage');},closeIntegrationVerification:async(workflow:string,id:string,commit:string,evidence:string)=>{expect([workflow,id,commit,evidence]).toEqual(['native-workflow','native-candidate','b'.repeat(40),'exact-evidence']);events.push('cleanup');if(failCleanup)throw Error('Credential or native cleanup remains unconfirmed');},awaitReview:async()=>{events.push('review');},candidateAcceptance:async()=>({mode:'human-review-required'}),recordIntegrationDispatchOutcome:async()=>{},recordWorkflowOutcome:async()=>{},abortPublish:async()=>{events.push('review-rejected');}};
 const env={REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:()=>ledger}} as unknown as Env,workflow=new FlareGitIntegrationWorkflow({} as ExecutionContext,env);
 Object.assign(workflow,{composeRepairVerify:async()=>({ok:true,commit:'b'.repeat(40),evidenceId:'exact-evidence'})});
 const step={do:async(_name:string,...args:unknown[])=>await(args.at(-1) as ()=>Promise<unknown>)(),waitForEvent:async()=>({payload:{approved:false,by:'Synthetic reviewer'}})};
 const execute=workflow as unknown as {execute(event:unknown,step:unknown,accepted:()=>Promise<void>):Promise<unknown>},run=execute.execute({instanceId:'native-workflow',payload:{projectId:'p123456789abc',taskIds:['one'],accountKey:'account',nativeRuntimeProtocolVersion:1}},step,async()=>{});
 if(failCleanup){await expect(run).rejects.toThrow('cleanup remains unconfirmed');expect(events).toEqual(['coverage','cleanup']);}else{await expect(run).resolves.toMatchObject({status:'rejected'});expect(events).toEqual(['coverage','cleanup','review','review-rejected']);}
});

test.each(['accepted','missing-review','wrong-invocation','missing-grant'] as const)('prepared publication workflow never composes and refuses unavailable authority: %s',async mode=>{
 const journalId='jrnl_11111111-1111-4111-8111-111111111111',commit='b'.repeat(40),candidate={id:'candidate',workflowInstanceId:'original-integration',candidateCommit:commit,evidenceId:'evidence',acceptedTarget:{incarnation:'22222222-2222-4222-8222-222222222222',ref:'refs/heads/main'},status:mode==='accepted'?'accepted':'verified',review:{approved:mode!=='missing-review',commit,actor:{userId:'owner'}}},journal={id:journalId,candidateId:'candidate',newHead:commit,candidateTree:'d'.repeat(40),state:mode==='accepted'?'ACCEPTED':'PREPARED',publicationAuthority:{kind:'human-review',actor:{userId:'owner'}}};
 let dispatch=0;const state={projectId:'p123456789abc',candidates:{candidate},journal:[journal],evidence:{evidence:{candidateTree:journal.candidateTree}},acceptedState:{history:[{candidateId:'candidate',commit}]}},ledger={getState:async()=>state,acceptedPublicationReceipt:async()=>({commit,ref:'refs/heads/main'}),getWorkflowRun:async()=>({kind:'integration',actorId:'owner'}),admitIntegrationDispatch:async()=>{dispatch++;throw Error('No composition dispatch expected');}},env={REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:()=>ledger}} as unknown as Env;
 const workflow=new FlareGitIntegrationWorkflow({} as ExecutionContext,env),event={instanceId:mode==='wrong-invocation'?'other':`pub-${journalId}`,workflowName:'fixture-publication',timestamp:new Date(),payload:{mode:'prepared-publication' as const,projectId:state.projectId,candidateId:'candidate',journalId}},step={} as import('cloudflare:workers').WorkflowStep;
 if(mode==='accepted')await expect(workflow.run(event,step)).resolves.toMatchObject({status:'accepted',duplicate:true,commit});else await expect(workflow.run(event,step)).rejects.toThrow();expect(dispatch).toBe(0);
});
test.each([true,false])('framework-native prepared publisher derives original authority; local publisher acknowledged=%s',async acknowledged=>{
 const journalId='jrnl_11111111-1111-4111-8111-111111111111',commit='b'.repeat(40),incarnation='22222222-2222-4222-8222-222222222222',actorId='fixture-owner',accountKey=await accountKeyFor(actorId),source='c'.repeat(40),worker='33333333-3333-4333-8333-333333333333';
 const candidate={id:'candidate',workflowInstanceId:'original-integration',candidateCommit:commit,evidenceId:'evidence',acceptedTarget:{incarnation,branch:'main'},status:'verified',review:{approved:true,commit,actor:{userId:actorId}}},journal={id:journalId,candidateId:candidate.id,newHead:commit,candidateTree:'d'.repeat(40),state:'PREPARED',publicationAuthority:{kind:'human-review',actor:{userId:actorId}}},state={projectId:'p123456789abc',candidates:{candidate},journal:[journal],evidence:{evidence:{candidateTree:journal.candidateTree}},acceptedState:{history:[]}};
 const events:string[]=[],ledger={getState:async()=>state,getWorkflowRun:async()=>({kind:'integration',actorId}),accountLifecycle:async()=> 'active',authorizeCandidatePublication:async()=>true,completePublish:async(id:string)=>{expect(id).toBe(journalId);events.push('complete');},recordIntegrationDispatchOutcome:async(id:string,status:string)=>{expect([id,status]).toEqual(['original-integration','accepted']);events.push('record');}};
 const now=Date.now(),phase={projectId:state.projectId,incarnation,workflowId:'original-integration',candidateId:candidate.id,actorId,accountKey,journalId,commit,tree:journal.candidateTree,evidenceId:'evidence',reviewActorId:actorId,sourceVersion:source,image:'registry.cloudflare.com/'+'a'.repeat(32)+'/verifier@sha256:'+'b'.repeat(64),activatedAt:now-1000,admissionExpiresAt:now+60000,nativeStopAt:now+120000,maxAllocations:1,maxContainerSeconds:1200,maxCommands:64,kind:'native-essential'},env={FLAREGIT_SOURCE_VERSION:source,CF_VERSION_METADATA:{id:worker},PUBLICATION_NATIVE_PHASE_JSON:JSON.stringify(phase),REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:()=>ledger}} as unknown as Env;
 const workflow=new FlareGitIntegrationWorkflow({} as ExecutionContext,env);Object.assign(workflow,{casPush:async(_candidate:unknown,passedCommit:string,_ledger:unknown,branch:string)=>{expect([passedCommit,branch]).toEqual([commit,'main']);events.push('cas');return acknowledged?{ok:true}:{ok:false,error:'Unknown physical outcome'};}});
 const step={do:async(_name:string,...args:unknown[])=>await(args.at(-1) as ()=>Promise<unknown>)()} as unknown as import('cloudflare:workers').WorkflowStep;
 const result=await workflow.run({instanceId:`pub-${journalId}`,workflowName:'fixture-publication',timestamp:new Date(),payload:{mode:'prepared-publication',projectId:state.projectId,candidateId:candidate.id,journalId}},step);expect(result.status).toBe(acknowledged?'accepted':'blocked');expect(events).toEqual(acknowledged?['cas','complete','record']:['cas']);expect(journal.state).toBe('PREPARED');
});
