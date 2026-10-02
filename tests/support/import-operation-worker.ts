import { RepositoryController } from "../../src/server/durable-object";
export { RepositoryController };
export default { async fetch(request: Request, env: { TEST: DurableObjectNamespace<RepositoryController> }) {
  const ledger = env.TEST.getByName("account");
  const url = new URL(request.url);
  if (url.pathname === "/claim") return Response.json(await ledger.claimImportHistoryOperation(await request.json()));
  return Response.json(await ledger.consumeRun(1, url.searchParams.get("key") ?? undefined));
} };
