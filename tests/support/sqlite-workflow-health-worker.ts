import {RepositoryController,type WorkflowOutcome} from "../../src/server/durable-object";
export {RepositoryController};
export default {async fetch(request:Request,env:{TEST:DurableObjectNamespace<RepositoryController>}){const stub=env.TEST.get(env.TEST.idFromName("health"));const url=new URL(request.url);if(request.method==="POST")await stub.recordWorkflowOutcome("integration","run",url.searchParams.get("phase") as WorkflowOutcome);return Response.json(await stub.workflowCounts(0));}};
