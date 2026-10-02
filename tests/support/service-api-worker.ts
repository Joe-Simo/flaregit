import { DurableObject } from "cloudflare:workers";
import worker from "../../src/server/worker";
import {RepositoryDeployments} from "../../src/server/deployments";
import { RepositoryPublicCommunity } from "../../src/server/public-community";
import { RepositoryConnections } from "../../src/server/connections";
import type { Env } from "../../src/server/env";
import type { IntegrationCallback } from "../../src/server/integration-auth";

export class ServiceApiFixture extends DurableObject {
  override async fetch(request: Request) {
    const repositoryId = "abcdef123456";
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT,subject TEXT,author TEXT,body TEXT,path TEXT,line INTEGER,"commit" TEXT,created_at TEXT)');
    const ledger = new RepositoryConnections(this.ctx.storage, repositoryId);
    const route = new URL(request.url).pathname;
    const community=new RepositoryPublicCommunity(this.ctx.storage,repositoryId);
    const deployments=new RepositoryDeployments(this.ctx.storage,repositoryId);
    const acceptedTarget={journalId:"accepted-journal",candidateId:"accepted-candidate",commit:"a".repeat(40),tree:"b".repeat(40),acceptedAt:"2026-10-02T00:00:00.000Z",recoverableRef:"refs/flaregit/deployments/accepted-journal"};
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS fixture_pin(id INTEGER PRIMARY KEY,pinned INTEGER);INSERT OR IGNORE INTO fixture_pin VALUES(1,0)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS fixture_public(id INTEGER PRIMARY KEY,enabled INTEGER,version INTEGER,revoke_during_read INTEGER);INSERT OR IGNORE INTO fixture_public VALUES(1,0,0,0)");
    if(route==="/community-setup"){this.ctx.storage.sql.exec("UPDATE fixture_public SET enabled=1,version=version+1,revoke_during_read=0");community.configure({enabled:true,scopes:["issues","contribution-requests"]},true,{userId:"fixture-user",accountKey:"fixture-account",displayName:"Verified unit actor"},"fixture-user");return Response.json({ready:true});}
    if(route==="/community-revoke-during-read"){this.ctx.storage.sql.exec("UPDATE fixture_public SET revoke_during_read=1");return Response.json({ready:true});}

    if (route === "/setup") {
      const created = ledger.create("Test company", ["read-candidate", "report-check", "comment", "report-deployment"]);
      const policy = { version: 2, mode: "augment" as const, checks: [{ id: "check-one", providerId: created.metadata.id, required: true }] };
      ledger.setPolicy(policy);
      ledger.freeze({ repositoryId, candidateId: "candidate-one", commit: "a".repeat(40), tree: "b".repeat(40), policy });
      ledger.registerRun("candidate-one", "check-one", "run-one");
      return Response.json(created);
    }
    if (route === "/expensive-count") return Response.json(this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM expensive_calls").toArray()[0]);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS expensive_calls(id INTEGER)");
    if (route === "/revoke") { const value = await request.json() as { id: string }; ledger.revoke(value.id); return Response.json({ ok: true }); }
    const env = {
      REPOSITORY_CONTROLLER: {
        idFromName: (name: string) => name,
        get: (name: string) => ({
          verifyApiToken: async (token: string) => token === `fgt_abcdef123456_${"x".repeat(32)}` ? { userId:"fixture-user",scope:"full",repo:null } : token === `fgt_abcdef123456_${"y".repeat(32)}` ? {userId:"fixture-member",scope:"full",repo:null} : null,
          roleOf: async(user:string) => user==="fixture-user"?"owner":"member",
          acceptedDeploymentTarget: async(journal:string)=>journal===acceptedTarget.journalId?{canonicalRepoName:"fixture",target:acceptedTarget}:null,
          acceptedDeploymentTargets: async()=>[acceptedTarget],
          listDeployments:async()=>deployments.list(),
          listWebhooks:async()=>[{active:1,events:"deployment.requested"}],
          requestDeployment:async(target:typeof acceptedTarget,serviceId:string,environment:string,key:string,actor:string)=>deployments.request(target,serviceId,environment,key,actor,()=>{}),
          getProfile: async()=>({displayName:"Verified unit actor"}),
          publicGrant: async()=>{const row=this.ctx.storage.sql.exec<{enabled:number;version:number}>("SELECT enabled,version FROM fixture_public").toArray()[0]!;return name===`project:${repositoryId}`&&row.enabled?{visibility:"public",confirmedByOwner:true,acceptedCommit:"a".repeat(40),name:"Fixture",version:row.version,canonicalRepoName:"fixture"}:null;},
          publicCommunity: async()=>{const result={policy:community.policy(),posts:community.listPublic()};if(this.ctx.storage.sql.exec<{revoke_during_read:number}>("SELECT revoke_during_read FROM fixture_public").toArray()[0]!.revoke_during_read)this.ctx.storage.sql.exec("UPDATE fixture_public SET enabled=0,version=version+1");return result;},
          createPublicPost: async(actor:Parameters<typeof community.createPost>[0],input:Parameters<typeof community.createPost>[1])=>community.createPost(actor,input),
          requestPublicContribution: async(actor:Parameters<typeof community.requestContribution>[0],input:Parameters<typeof community.requestContribution>[1])=>community.requestContribution(actor,input),
          publicContributionRequests: async(actor:Parameters<typeof community.requestsFor>[0])=>community.requestsFor(actor,"owner-distinct"),
          listProjects: async () => [],listImportJobs: async () => [],
          getState: async () => ({ verificationPolicy:{},acceptedState:{currentCommit:"a".repeat(40)},tasks:{"task-one":{id:"task-one",status:"working"}} }),
          connectionSigningConfig: async (id: string) => name === `project:${repositoryId}` ? ledger.signingConfig(id) : null,
          acceptIntegrationCallback: async (callback: IntegrationCallback) => ledger.accept(callback),
          serviceCandidateSnapshot: async (id: string, candidate: string, commit: string, nonce: string) => { try { return ledger.serviceCandidateSnapshot(id, candidate, commit, nonce); } catch { return null; } },
        }),
      },
      INTEGRATOR:{getByName:()=>({exec:async(args:string[])=>{const command=args[2]!;if(command.includes("push --quiet"))this.ctx.storage.sql.exec("UPDATE fixture_pin SET pinned=1");const pinned=this.ctx.storage.sql.exec<{pinned:number}>("SELECT pinned FROM fixture_pin").toArray()[0]!.pinned;return{success:true,stdout:command.includes("rev-parse")?acceptedTarget.tree:command.includes("ls-remote")&&pinned?`${acceptedTarget.commit}\t${acceptedTarget.recoverableRef}\n`:"",stderr:"",exitCode:0};},destroy:async()=>{}})},
      ARTIFACTS: {get:async()=>({info:async()=>({remote:"https://artifacts.example.com/fixture"}),createToken:async()=>({plaintext:"synthetic-token"}),revokeToken:async()=>true,[Symbol.dispose]:()=>{}}),create:async()=>{this.ctx.storage.sql.exec("INSERT INTO expensive_calls VALUES(1)");throw new Error("Unexpected creation");}},
      AGENT_WORKFLOW: {create:async()=>{this.ctx.storage.sql.exec("INSERT INTO expensive_calls VALUES(1)");throw new Error("Unexpected agent start");}},
      API_LIMITER: { limit: async () => ({ success: true }) },
    } as unknown as Env;
    return worker.fetch(request, env, this.ctx as unknown as ExecutionContext);
  }
}
export default { fetch: (request: Request, env: { TEST: DurableObjectNamespace<ServiceApiFixture> }) => env.TEST.getByName("one").fetch(request) };
