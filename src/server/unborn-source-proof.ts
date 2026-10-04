import { isSafeRef } from "../core/sanitize";
import type { Env } from "./env";
import { acceptedTargetSchema, type UnbornAcceptedTarget } from "../core/accepted-target";
import { accountKeyFor } from "./projects";
import { admitNativeCompute } from "./native-compute";
import { gitAuthEnv, q } from "./shell";
import { validateRecoveryRemote } from "./private-recovery-bundle";
import { parseUnbornAdvertisement, UnbornSourceNotEmptyError } from "./unborn-source-advertisement";
import { sealAndStopInitializer } from "./readme-repository";
import type { TaskSourceInspections } from "./task-source-inspections";

export interface UnbornSourceInput { eventId: string; attemptId?: string; expectedParentProviderRepoId?: string; purpose: "source" | "workspace"; repositoryName: string; expectedProviderRepoId?: string; expectedForkSource?: string; expectedMarker?: string; projectId: string; incarnation: string; sourceRepoName: string; acceptedTarget: UnbornAcceptedTarget; userId: string }
export interface UnbornSourceObservation { providerRepoId: string; purpose: "source" | "workspace"; repositoryName: string; sourceRepoName: string; defaultRef: string; inspectedDefaultRef?: string; expectedHead: null; visibleRefs: []; headSymref: string | null; nativeName: string }
/** Mandatory durable authority/issuance/native callbacks. Plaintext credentials never leave the server. */
export interface UnbornSourceJournal {
  beforeProvider(operation: "get" | "info" | "createToken" | "revokeToken" | "parentGet" | "parentInfo"): Promise<void>;
  authorize(input: UnbornSourceInput): Promise<void>;
  bindSource(metadata: { id: string; name: string; remote: string; defaultBranch: string; source: string | null; description: string | null }): Promise<void>;
  beforeCredential(): Promise<void>;
  credentialIssued(id: string, plaintext: string, expiresAt: string): Promise<void>;
  nativeIntent(name: string): Promise<void>;
  credentialRevoked(id: string): Promise<void>;
  nativeStopped(name: string): Promise<void>;
  failedObservation(kind: "nonempty" | "unavailable"): Promise<void>;
  pendingObservation(proof: UnbornSourceObservation): Promise<void>;
  observed(proof: UnbornSourceObservation): Promise<void>;
}

export function assertEmptyNativeAdvertisement(result: { success: boolean; stdout: string },defaultRef:string):{headSymref:string|null} {
  if(!result.success)throw new Error("Complete native advertisement unavailable");
  let output:unknown;try{output=JSON.parse(result.stdout);}catch{throw new Error("Complete native advertisement unavailable");}
  if(typeof output!=="object"||output===null||Array.isArray(output)||!("version" in output)||output.version!==1||!("advertisement" in output)||typeof output.advertisement!=="string")throw new Error("Complete native advertisement unavailable");
  return parseUnbornAdvertisement(output.advertisement,defaultRef);
}

export function unbornSourceAdvertisementCommand(remote:string):string {
  validateRecoveryRemote(remote);
  const inspect="const f=Bun.file('/workspace/unborn-source-proof/refs');if(f.size>1048576)process.exit(2);const advertisement=await f.text();console.log(JSON.stringify({version:1,advertisement}));";
  return `mkdir -p /workspace/unborn-source-proof && git --no-replace-objects -c core.hooksPath=/dev/null ls-remote --symref ${q(remote)} > /workspace/unborn-source-proof/refs && bun -e ${q(inspect)}`;
}

/** Staged source admission: prove the original canonical source empty before any fork is dispatched. */
export async function proveUnbornSource(env: Env, proposed: UnbornSourceInput, journal: UnbornSourceJournal): Promise<UnbornSourceObservation> {
  const input=structuredClone(proposed),target=acceptedTargetSchema.parse(input.acceptedTarget);
  if(target.kind!=="unborn"||target.projectId!==input.projectId||target.incarnation!==input.incarnation||target.canonicalRepoName!==input.sourceRepoName||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.eventId))throw new Error("Original unborn source scope required");
  const nativeName=`unborn-${input.purpose}-${input.attemptId??input.eventId}`;
  await journal.authorize(input);
  await journal.beforeProvider("get");using repository=await env.ARTIFACTS.get(input.repositoryName);
  await journal.authorize(input);await journal.beforeProvider("info");const metadata=await repository.info();await journal.authorize(input);
  if((input.expectedProviderRepoId&&metadata.id!==input.expectedProviderRepoId)||metadata.name!==input.repositoryName||!isSafeRef(`refs/heads/${metadata.defaultBranch}`)||(input.purpose==="source"&&`refs/heads/${metadata.defaultBranch}`!==target.ref)||!metadata.id)throw new Error("Source provider identity or default branch differs");
  if(input.purpose==="source"&&input.repositoryName!==input.sourceRepoName)throw new Error("Original source name differs");
  if(input.purpose==="workspace"&&(!input.expectedParentProviderRepoId||!input.expectedProviderRepoId||!input.expectedForkSource||!input.expectedMarker||metadata.id!==input.expectedProviderRepoId||metadata.source!==input.expectedForkSource||metadata.description!==input.expectedMarker))throw new Error("Fork workspace identity or lineage differs");
  if(input.purpose==="workspace"){await journal.authorize(input);await journal.beforeProvider("parentGet");using parent=await env.ARTIFACTS.get(input.sourceRepoName);await journal.authorize(input);await journal.beforeProvider("parentInfo");if((await parent.info()).id!==input.expectedParentProviderRepoId)throw new Error("Original parent provider identity changed");}
  validateRecoveryRemote(metadata.remote);
  await journal.bindSource({id:metadata.id,name:metadata.name,remote:metadata.remote,defaultBranch:metadata.defaultBranch,source:metadata.source,description:metadata.description});
  // Metadata reads have their own provider admission. Reserve native execution
  // only once its exact identity is bound, so an untouched lookup retry is safe.
  await journal.authorize(input);await admitNativeCompute(env,await accountKeyFor(input.userId),nativeName);
  await journal.authorize(input);await journal.beforeCredential();
  let credential:ArtifactsCreateTokenResult|undefined,nativeAllocated=false,revoked=false,stopped=false,observation:UnbornSourceObservation|undefined;
  try{
    await journal.beforeProvider("createToken");credential=await repository.createToken("read",900);
    await journal.credentialIssued(credential.id,credential.plaintext,credential.expiresAt);
    if(credential.scope!=="read"||!credential.id||!credential.plaintext||!Number.isFinite(Date.parse(credential.expiresAt))||Date.parse(credential.expiresAt)<=Date.now())throw new Error("Scoped source credential was not confirmed");
    await journal.authorize(input);await journal.nativeIntent(nativeName);
    const sandbox=env.INTEGRATOR.getByName(nativeName);nativeAllocated=true;
    await journal.authorize(input);
    const advertisement=await sandbox.exec(["sh","-c",unbornSourceAdvertisementCommand(metadata.remote)],{env:{...gitAuthEnv(credential.plaintext),GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_SYSTEM:"/dev/null",GIT_CONFIG_COUNT:"3",GIT_CONFIG_KEY_1:"http.followRedirects",GIT_CONFIG_VALUE_1:"false",GIT_CONFIG_KEY_2:"credential.helper",GIT_CONFIG_VALUE_2:""}});
    await journal.authorize(input);const inspectedDefaultRef=`refs/heads/${metadata.defaultBranch}`;const nativeProof=assertEmptyNativeAdvertisement(advertisement,inspectedDefaultRef);
    await journal.beforeProvider("info");const current=await repository.info();await journal.authorize(input);
    if(current.id!==metadata.id||current.name!==metadata.name||current.remote!==metadata.remote||current.defaultBranch!==metadata.defaultBranch||current.source!==metadata.source||current.description!==metadata.description)throw new Error("Source provider identity changed during native proof");
    if(input.purpose==="workspace"){await journal.authorize(input);await journal.beforeProvider("parentGet");using parent=await env.ARTIFACTS.get(input.sourceRepoName);await journal.authorize(input);await journal.beforeProvider("parentInfo");if((await parent.info()).id!==input.expectedParentProviderRepoId)throw new Error("Original parent provider identity changed");}
    observation={providerRepoId:metadata.id,purpose:input.purpose,repositoryName:input.repositoryName,sourceRepoName:input.sourceRepoName,defaultRef:target.ref,inspectedDefaultRef,expectedHead:null,visibleRefs:[],headSymref:nativeProof.headSymref,nativeName};
    await journal.pendingObservation(observation);
  }catch(error){await journal.failedObservation(error instanceof UnbornSourceNotEmptyError?"nonempty":"unavailable");throw error;}finally{
    if(credential)try{await journal.beforeProvider("revokeToken");if(await repository.revokeToken(credential.id||credential.plaintext)){await journal.credentialRevoked(credential.id);revoked=true;}}catch{/* Durable issuance stays unresolved. */}
    if(nativeAllocated)try{if(await sealAndStopInitializer(env.INTEGRATOR.getByName(nativeName))){await journal.nativeStopped(nativeName);stopped=true;}}catch{/* Durable native intent stays unresolved. */}
  }
  if(!observation||!revoked||!stopped)throw new Error("Source proof remains pending; credential and native cleanup must be confirmed before forking");
  await journal.authorize(input);await journal.observed(observation);
  return observation;
}

/** Resume saved observation/cleanup only; never issues another credential or executes another Git command. */
export async function recoverUnbornSource(env:Env,input:UnbornSourceInput,journal:UnbornSourceJournal,saved:NonNullable<ReturnType<TaskSourceInspections["recovery"]>>):Promise<UnbornSourceObservation|null>{
 if(saved.scope.eventId!==input.eventId||saved.scope.attemptId!==input.attemptId||saved.scope.purpose!==input.purpose||saved.scope.actorId!==input.userId||saved.scope.projectId!==input.projectId||saved.scope.incarnation!==input.incarnation||saved.scope.sourceRepoName!==input.sourceRepoName||saved.scope.repositoryName!==input.repositoryName||JSON.stringify(saved.scope.acceptedTarget)!==JSON.stringify(acceptedTargetSchema.parse(input.acceptedTarget)))throw new Error("Original saved inspection scope required");
 await journal.authorize(input);
 if(!saved.provider)throw new Error("Provider inspection identity remains unknown");
 await journal.beforeProvider("get");using repository=await env.ARTIFACTS.get(input.repositoryName);await journal.authorize(input);
 await journal.beforeProvider("info");const current=await repository.info();await journal.authorize(input);
 if(current.id!==saved.provider.id||current.name!==saved.provider.name||current.remote!==saved.provider.remote||current.defaultBranch!==saved.provider.defaultBranch||current.source!==saved.provider.source||current.description!==saved.provider.description)throw new Error("Saved provider identity changed; inspection remains held");
 if(input.purpose==="workspace"){await journal.beforeProvider("parentGet");using parent=await env.ARTIFACTS.get(input.sourceRepoName);await journal.authorize(input);await journal.beforeProvider("parentInfo");if((await parent.info()).id!==input.expectedParentProviderRepoId)throw new Error("Original parent provider identity changed");}
 if(saved.credential&&!saved.credentialRevoked){await journal.beforeProvider("revokeToken");if(!await repository.revokeToken(saved.credential.id||saved.credential.plaintext))throw new Error("Saved read credential revocation remains unconfirmed");await journal.credentialRevoked(saved.credential.id);}
 if(saved.nativeName&&!saved.nativeStopped){await journal.authorize(input);if(!await sealAndStopInitializer(env.INTEGRATOR.getByName(saved.nativeName)))throw new Error("Saved native workspace stop remains unconfirmed");await journal.nativeStopped(saved.nativeName);}
 if(!saved.pendingObservation)return null;
 await journal.authorize(input);await journal.observed(saved.pendingObservation);
 return structuredClone(saved.pendingObservation);
}
