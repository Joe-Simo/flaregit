import { RepositoryController } from "../../src/server/durable-object";
export class ProfilePrivacyFixture extends RepositoryController {
  async cleanupRetainedName(): Promise<string> { return (await this.getState()).projectName; }
  seedUnsafeLegacyProfile() { this.ctx.storage.sql.exec("INSERT INTO profile VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc",JSON.stringify({handle:"legacy",displayName:"Owner",bio:"https://user:secret@example.com/repository",joinedAt:"2026-10-02"})); }
}
export default { async fetch(request: Request, env: { TEST: DurableObjectNamespace<ProfilePrivacyFixture> }) {
  const ledger = env.TEST.getByName("account");
  const url = new URL(request.url);
  if (url.pathname === "/repository-tombstone-proof") {
    const project = env.TEST.getByName("sealed-bootstrap");
    await project.beginRepositoryDeletion();
    await project.destroy();
    let rejected = false;
    try { await project.initialize({ projectId: "abcdef123456", projectName: "Revived", canonicalRepoName: "canonical", head: "a".repeat(40), verificationPolicy: {} }); } catch { rejected = true; }
    return Response.json({ sealed: await project.repositoryDeletionPending(), initializeRejected: rejected });
  }
  if (url.pathname === "/repository-delete-proof") {
    const project = env.TEST.getByName("deleting-project");
    await project.initialize({ projectId: "abcdef123456", projectName: "Retained", canonicalRepoName: "canonical", head: "a".repeat(40), verificationPolicy: {}, ownerId: "owner" });
    await project.setRepositoryVisibility("public", true, "owner");
    await project.beginRepositoryDeletion();
    await project.recordRepositoryArtifactDeleted("canonical");
    let mutationRejected = false;
    try { await project.addMember("other", "member"); } catch { mutationRejected = true; }
    return Response.json({ pending: await project.repositoryDeletionPending(), confirmed: await project.repositoryArtifactDeleted("canonical"), unconfirmed: await project.repositoryArtifactDeleted("fork"), name: await project.cleanupRetainedName(), gitAccess: await project.canGitAccess("owner", null, false), publicGrant: await project.publicGrant(), mutationRejected });
  }
  if(url.pathname === "/unsafe-legacy") { await ledger.seedUnsafeLegacyProfile(); return Response.json({ok:true}); }
  if (url.pathname === "/profile") return Response.json(await ledger.publicProfileState());
  if (url.pathname === "/profile-save") { await ledger.setProfile(await request.json(), Number(url.searchParams.get("version") ?? 0)); return Response.json({ok:true}); }
  if (url.pathname === "/profile-public") { try { await ledger.setPublicProfileVisibility("public",true,"owner", Number(url.searchParams.get("version") ?? 1)); } catch { return Response.json({error:"Profile publication not applied"},{status:409}); } return Response.json({ok:true}); }
  if (url.pathname === "/handle-reserve") return Response.json(await ledger.claimHandle(url.searchParams.get("handle")!,url.searchParams.get("account")!));
  if (url.pathname === "/handle-commit") { await ledger.commitHandle(url.searchParams.get("handle")!,url.searchParams.get("account")!); return Response.json({ok:true}); }
  if (url.pathname === "/handle-owner") return Response.json(await ledger.accountForHandle(url.searchParams.get("handle")!));
  if (url.pathname === "/claim") return Response.json(await ledger.claimImportHistoryOperation(await request.json()));
  return Response.json(await ledger.consumeRun(1, url.searchParams.get("key") ?? undefined));
} };
