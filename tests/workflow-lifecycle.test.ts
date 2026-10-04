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
function retainedFixture(base:string,commit:string,candidateId:string){
 const db=new Database(':memory:');const storage={sql:{exec(query:string,...bindings:Array<string|number>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}} as unknown as DurableObjectStorage;
 const pins=new RetainedInputs(storage),credentials=new RetainedCredentialIncidents(storage),funding=new CoreGitOperationLedger(storage);const issued=new Map<string,RetainedInput>();
 return {savedPins:()=>db.query<{doc:string},[]>("SELECT doc FROM retained_inputs").all().map(row=>JSON.parse(row.doc) as RetainedInput),pendingCredentials:()=>db.query<{n:number},[]>("SELECT COUNT(*) AS n FROM retained_credential_incidents WHERE status<>'revoked'").get()!.n,reserveCoreGitOperation:async(id:string,key:string)=>funding.reserve(id,key,{accountUsdMicros:10000000,globalUsdMicros:10000000}),
 prepareRetainedInput:async(taskId:string,workflowId:string,selectedCandidate:string,id:string)=>{if(taskId!=='one'||workflowId!=='registered-parent'||selectedCandidate!==candidateId)throw Error('Synthetic authority scope mismatch');const incarnation='11111111-1111-4111-8111-111111111111';const input=retainedInputSchema.parse({id,version:1,projectId:'p123456789abc',incarnation,taskId,commit,base,canonicalRepoName:'repo',workspaceRepoName:'repo',branch:'task/one',protectedRef:`refs/flaregit/inputs/${incarnation}/${taskId}/${commit}`,protectedBaseRef:`refs/flaregit/inputs/${incarnation}/${taskId}/${base}`,workflowId,candidateId,actorId:'fixture-human',ownerId:'fixture-human',accountKey:await accountKeyFor('fixture-human')});issued.set(id,input);return input;},
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
    expect(await git(["--git-dir", canonical, "rev-parse", "main"])).toBe(base);
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

test.each(["normal","evidence-failure","preview-failure"] as const)("candidate remains durable through optional storage state: %s", async (mode) => {
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
    await git(["-C", seed, "add", "."]); await git(["-C", seed, "commit", "-m", "base"]); await git(["-C", seed, "push", "origin", "main"]);
    const base = await git(["-C", seed, "rev-parse", "HEAD"]);
    await git(["-C", seed, "checkout", "-b", "task/one"]); await import("node:fs/promises").then(fs=>fs.mkdir(join(seed,"src"),{recursive:true})); await Bun.write(join(seed, "src/feature.ts"), "throw new Error('Functional source still must never execute');");
    await git(["-C", seed, "commit", "-am", "feature"]); await git(["-C", seed, "push", "origin", "task/one"]);
    const head = await git(["-C", seed, "rev-parse", "HEAD"]);
    const retention=retainedFixture(base,head,"external-one");
    let destroyed = 0, aiCalls = 0;
    const commands: string[] = [], stored: string[] = [];
    const env = {
      ...lifecycleFunding(retention),
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
    const task = { id: "one", baseCommit: base, currentCommit: head, allowedScope: ["src/feature.ts"], workspace: { repoName: "repo", branch: "task/one" }, contributor: { name: "Fixture", id: "one" } };
    const candidate: CandidateGeneration = { id: "external-one", attemptNumber: 1, frozenRequirements: [], repairAttempts: [], status: "composing", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expectedAcceptedBase: base, participatingTaskIds: ["one"], participatingCommits: { one: head }, frozenPolicyVersion: 1, frozenVerificationPolicy: { kind: "command", test: "touch CUSTOMER_COMMAND_EXECUTED", install: "touch CUSTOMER_INSTALL_EXECUTED", allowedScope: ["src/feature.ts"], protectedPaths: ["tests/"] }, frozenExternalChecksPolicy: { version: 1, mode: "external", checks: [{ id: "check", providerId: "provider", required: true }] }, frozenContributorProofs: [{ id: "one", commit: head, baseCommit: base, ref: "refs/flaregit/tasks/one", allowedScope: ["src/feature.ts"] }] };
    if(previewFails){delete candidate.frozenExternalChecksPolicy;candidate.frozenVerificationPolicy={};}
    const evidence: import("../src/core/types.js").VerificationEvidence[] = [];
    const activities:string[]=[];
    const ledger = {...retention,recordScopedEvidenceCopy:async()=>{},previewStorageScope:async(commit:string)=>({projectId:"p123456789abc",incarnation:"11111111-1111-4111-8111-111111111111",commit,accountKey:await accountKeyFor("fixture-human")}),getWorkflowRun:async()=>({actorId:"fixture-human"}),roleOf:async()=>"owner", logActivity:async(_actor:string,kind:string)=>{activities.push(kind);}, getState: async () => ({ canonicalRepoName: "repo", tasks: { one: task }, defaultBranch: "main" }), recordComposition: async () => {}, recordVerification: async (_id: string, _commit: string, proof: import("../src/core/types.js").VerificationEvidence) => { evidence.push(proof); } } as unknown as Ledger;
    const workflow = new FlareGitIntegrationWorkflow({} as ExecutionContext, env);
    Object.assign(workflow,{projectId:"p123456789abc",computeAccountKey:await accountKeyFor("fixture-human"),computeWorkflowId:"registered-parent"});
    const callable = workflow as unknown as { composeRepairVerify(candidate: CandidateGeneration, params: { projectId: string; taskIds: string[] }, ledger: Ledger,parentWorkflowId?:string): Promise<{ ok: boolean; commit?: string }> };
    const result = await callable.composeRepairVerify(candidate, { projectId: "p123456789abc", taskIds: ["one"],accountKey:await accountKeyFor("fixture-human") } as {projectId:string;taskIds:string[]}, ledger,"registered-parent");
    expect(result.ok).toBe(true); expect(destroyed).toBe(1); expect(aiCalls).toBe(0);expect(retention.pendingCredentials()).toBe(0);const savedPins=retention.savedPins();expect(savedPins).toHaveLength(1);expect(await git(["--git-dir",canonical,"rev-parse",savedPins[0]!.protectedRef])).toBe(head);expect(await git(["--git-dir",canonical,"rev-parse",savedPins[0]!.protectedBaseRef])).toBe(base);
    expect(evidence[0]?.verifierIdentity).toBe(previewFails?"synthetic-test-only":"flaregit-native-integrity-v1");
    expect(activities.includes("evidence.copy_failed")).toBe(uploadFails);
    expect(stored).toHaveLength(previewFails?2:1);
    if(previewFails){expect(stored.some(key=>key.endsWith("index.html"))).toBe(false);expect(activities).toContain("preview.failed");expect(await (env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName("global")) as unknown as Ledger).nativeComputeFailure(`build-p123456789abc-${result.commit}`)).toBe(true);}
    else expect(stored[0]).toMatch(/^evidence\//);
    expect(commands.some((command) => command.includes("--native-integrity"))).toBe(!previewFails);
    expect(commands.some((command) => command.includes("build-preview") || command.includes("verification/cli.ts custom "))).toBe(previewFails);
    expect(await git(["--git-dir", canonical, "rev-parse", "refs/flaregit/candidates/external-one"])).toBe(result.commit!);
    expect(await git(["--git-dir", canonical, "rev-parse", "main"])).toBe(base);
  } finally { await rm(root, { recursive: true, force: true }); }
});
