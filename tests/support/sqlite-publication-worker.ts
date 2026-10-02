import { RepositoryController } from "../../src/server/durable-object.js";
import { RepositoryConnections } from "../../src/server/connections";
import type { PublicCommunityActor,PublicCommunityPolicy } from "../../src/server/public-community";
import type {AcceptedDeploymentTarget} from "../../src/server/deployments";
import type { AgentRunInput } from "../../src/server/agent-run-ledger";
import type { ExternalCheckState, ExternalCheckPolicy } from "../../src/core/external-checks";
import type { FlareGitProjectState } from "../../src/core/types.js";

/** Test-only fixture injection; all acceptance/abort transitions execute production methods. */
export class PublicationFixture extends RepositoryController {
  seed(state: FlareGitProjectState, holder: string) {
    this.ctx.storage.sql.exec("INSERT INTO project (id, doc) VALUES (1, ?)", JSON.stringify(state));
    this.ctx.storage.sql.exec("INSERT INTO lease (id, holder, expires_at) VALUES (1, ?, ?)", holder, Date.now() + 60_000);
    this.ctx.storage.sql.exec("INSERT INTO webhooks (id,url,secret,events,active,created_at) VALUES ('hook','https://example.com/hook','test-secret','change.accepted,change.ready,change.blocked,decision.needed',1,'now')");
  }
  failMembership(enabled:boolean) { if(enabled)this.ctx.storage.sql.exec("CREATE TRIGGER fail_member BEFORE INSERT ON members BEGIN SELECT RAISE(ABORT,'synthetic membership failure'); END"); else this.ctx.storage.sql.exec("DROP TRIGGER fail_member"); }
  failRegistry(enabled:boolean) {if(enabled)this.ctx.storage.sql.exec("CREATE TRIGGER fail_registry BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT,'synthetic registry failure'); END");else this.ctx.storage.sql.exec("DROP TRIGGER fail_registry");}
  async fixtureAlarm(){await this.alarm();}
  async visibilitySnapshot() { return { visibility: await this.repositoryVisibility(), grant: await this.publicGrant(), rows: this.ctx.storage.sql.exec("SELECT version FROM repository_visibility WHERE id=1").toArray() }; }
  fixtureDeploymentService(){return new RepositoryConnections(this.ctx.storage,"test").create("Deployment provider",["report-deployment"]);}
  fixtureConnection() { return new RepositoryConnections(this.ctx.storage, "test").create("External test provider", ["report-check"]); }
  fixturePolicy(policy: ExternalCheckPolicy) { new RepositoryConnections(this.ctx.storage, "test").setPolicy(policy); }
  injectExternal(state: ExternalCheckState) {
    new RepositoryConnections(this.ctx.storage, "test");
    this.ctx.storage.sql.exec("INSERT INTO connection_candidates VALUES (?,?)", "candidate", JSON.stringify(state));
  }
  failSave(enabled: boolean) {
    if (enabled) this.ctx.storage.sql.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON project BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END");
    else this.ctx.storage.sql.exec("DROP TRIGGER fail_save");
  }
  expireLease() { this.ctx.storage.sql.exec("DELETE FROM lease"); }
  async snapshot() {
    return {
      state: JSON.parse(String(this.ctx.storage.sql.exec("SELECT doc FROM project").toArray()[0]?.doc)),
      lease: this.ctx.storage.sql.exec("SELECT holder FROM lease").toArray(),
      deliveries: this.ctx.storage.sql.exec("SELECT id, payload FROM deliveries").toArray(),
      events: this.ctx.storage.sql.exec("SELECT id FROM events").toArray(),
      webhooks: this.ctx.storage.sql.exec("SELECT id FROM webhooks").toArray(),
      alarm: await this.ctx.storage.getAlarm(),
    };
  }
}

export default {
  async fetch(request: Request, env: { TEST: DurableObjectNamespace<PublicationFixture>;REPOSITORY_CONTROLLER:DurableObjectNamespace<PublicationFixture> }) {
    const url = new URL(request.url);
    const stub = env.TEST.get(env.TEST.idFromName(url.searchParams.get("name") ?? "test"));
    try {
      if (url.pathname === "/seed") { const body = await request.json() as { state: FlareGitProjectState; holder: string }; await stub.seed(body.state, body.holder); }
      if (url.pathname === "/fail") await stub.failSave(url.searchParams.get("enabled") === "true");
      if (url.pathname === "/complete") await stub.completePublish("journal");
      if (url.pathname === "/abort") await stub.abortPublish("candidate", "journal", "late abort", "failed");
      if (url.pathname === "/checkpoint") await stub.ingestCheckpoint({ eventId: "checkpoint-event", taskId: "task", commit: "checkpoint-tip", ready: true });
      if (url.pathname === "/subscribe") await stub.addWebhook("https://example.com/hook", await request.json() as string[]);
      if (url.pathname === "/expire") await stub.expireLease();
      if (url.pathname === "/claim") await stub.claimLanding({ holder: "claim-holder", taskIds: (url.searchParams.get("tasks") ?? "task").split(",") });
      const communityActors:Record<string,PublicCommunityActor>={owner:{userId:"community-owner",accountKey:"owner-key",displayName:"Maintainer"},author:{userId:"community-author",accountKey:"author-key",displayName:"Public author"},other:{userId:"community-other",accountKey:"other-key",displayName:"Other author"}};
      const actor=communityActors[url.searchParams.get("actor")??"author"]!;
      if(url.pathname==="/community-configure"){const value=await request.json() as {policy:PublicCommunityPolicy;confirmed:boolean};return Response.json(await stub.configurePublicCommunity(value.policy,value.confirmed,actor));}
      if(url.pathname==="/community-post")return Response.json(await stub.createPublicPost(actor,await request.json() as Parameters<typeof stub.createPublicPost>[1]));
      if(url.pathname==="/community-signed-posts")return Response.json(await stub.signedPublicPosts(actor));
      if(url.pathname==="/community-edit"){const value=await request.json() as {id:string;title:string;body:string;expectedVersion:number};return Response.json(await stub.editPublicPost(actor,value.id,{title:value.title,body:value.body,expectedVersion:value.expectedVersion}));}
      if(url.pathname==="/community-remove"){const value=await request.json() as {id:string;expectedVersion:number};await stub.removePublicPost(actor,value.id,value.expectedVersion);return Response.json({removed:true});}
      if(url.pathname==="/community-request")return Response.json(await stub.requestPublicContribution(actor,await request.json() as Parameters<typeof stub.requestPublicContribution>[1]));
      if(url.pathname==="/community-requests")return Response.json(await stub.publicContributionRequests(actor));
      if(url.pathname==="/community-public")return Response.json(await stub.publicCommunity());
      if(url.pathname==="/community-decide"){const value=await request.json() as {id:string;decision:"approved"|"rejected";confirmed:boolean};return Response.json(await stub.decidePublicContribution(actor,value.id,value.decision,value.confirmed));}
      if(url.pathname==="/registration-reconcile"){await stub.reconcileContributorRegistrations();return Response.json(await stub.publicContributionRequests(actor));}
      if(url.pathname==="/registration-alarm"){await stub.fixtureAlarm();return Response.json(await stub.publicContributionRequests(actor));}
      if(url.pathname==="/registration-fail"){await env.REPOSITORY_CONTROLLER.getByName("account:author-key").failRegistry(url.searchParams.get("enabled")==="true");return Response.json({ok:true});}
      if(url.pathname==="/registry")return Response.json(await env.REPOSITORY_CONTROLLER.getByName("account:author-key").listProjects());
      if(url.pathname==="/account-delete-start"){await env.REPOSITORY_CONTROLLER.getByName("account:author-key").beginAccountDeletion();return Response.json({ok:true});}
      if(url.pathname==="/account-delete-finish"){await env.REPOSITORY_CONTROLLER.getByName("account:author-key").finishAccountDeletion();return Response.json(await env.REPOSITORY_CONTROLLER.getByName("account:author-key").accountLifecycle());}
      if(url.pathname==="/remove-member")await stub.removeMember(url.searchParams.get("user")!);
      if(url.pathname==="/member-role")return Response.json(await stub.roleOf(url.searchParams.get("user")!));
      if(url.pathname==="/fail-membership")await stub.failMembership(url.searchParams.get("enabled")==="true");
      if(url.pathname==="/deployment-service")return Response.json(await stub.fixtureDeploymentService());
      if(url.pathname==="/deployment-target")return Response.json(await stub.acceptedDeploymentTarget(url.searchParams.get("journal")??"accepted-journal"));
      if(url.pathname==="/deployment-request"){const input=await request.json() as {target:AcceptedDeploymentTarget;serviceId:string;environment:string;key:string;actorId:string};return Response.json(await stub.requestDeployment(input.target,input.serviceId,input.environment,input.key,input.actorId));}
      if(url.pathname==="/deployment-list")return Response.json(await stub.listDeployments());
      if (url.pathname === "/agent-resume") { const input = await request.json() as { runId:string;taskId:string;previousRunId:string }; return Response.json(await stub.resumeAgentRun(input.runId,input.taskId,input.previousRunId)); }
      if (url.pathname === "/verification-policy") await stub.setVerificationPolicy(await request.json() as Record<string,unknown>);
      if (url.pathname === "/agent-claim") return Response.json(await stub.claimAgentRun(await request.json() as AgentRunInput));
      if (url.pathname === "/agent-proposal") { const input = await request.json() as { runId: string; taskId: string; files: Record<string,string> }; return Response.json(await stub.saveAgentProposal(input.runId,input.taskId,input.files)); }
      if (url.pathname === "/agent-push") { const input = await request.json() as { runId: string; taskId: string; commit: string }; return Response.json(await stub.markAgentPushed(input.runId,input.taskId,input.commit)); }
      if (url.pathname === "/agent-checkpoint") { const input = await request.json() as { runId: string; taskId: string; commit: string; eventId: string }; await stub.ingestCheckpoint({ ...input, ready: true }); return Response.json(await stub.checkpointAgentRun(input.runId,input.taskId,input.eventId,input.commit)); }
      if (url.pathname === "/agent-fail") { const input = await request.json() as { runId: string; taskId: string }; return Response.json(await stub.failAgentRun(input.runId,input.taskId)); }
      if (url.pathname === "/agent-run") return Response.json(await stub.getAgentRun(url.searchParams.get("run") ?? "run-one"));
      if (url.pathname === "/agent-state") return Response.json(await stub.getState());
      if (url.pathname === "/member") await stub.addMember(url.searchParams.get("user") ?? "owner", url.searchParams.get("role") === "owner" ? "owner" : "member");
      if (url.pathname === "/visibility") { const value = await request.json() as { visibility: "public" | "private"; confirmed: boolean; by: string }; await stub.setRepositoryVisibility(value.visibility, value.confirmed, value.by); }
      if (url.pathname === "/visibility-status") return Response.json(await stub.visibilitySnapshot());
      if (url.pathname === "/connection") return Response.json(await stub.fixtureConnection());
      if (url.pathname === "/external-policy") await stub.fixturePolicy(await request.json() as ExternalCheckPolicy);
      if (url.pathname === "/await-review") await stub.awaitReview("candidate", url.searchParams.get("commit") ?? "landed", "old-holder");
      if (url.pathname === "/checks") return Response.json(await stub.externalChecks("candidate"));
      if (url.pathname === "/external") await stub.injectExternal(await request.json() as ExternalCheckState);
      if (url.pathname === "/review") return Response.json(await stub.recordReview("candidate", { approved: true, by: "test-reviewer" }, url.searchParams.get("expected") ?? "b".repeat(40)));
      if (url.pathname === "/prepare") return Response.json(await stub.preparePublish("candidate"));
      return Response.json(await stub.snapshot());
    } catch (error) { return Response.json({ error: String(error) }, { status: 500 }); }
  },
};
