import {isolatedExecutionContextSchema,type IsolatedExecutionContext} from "./isolated-execution-grants";
import type {CandidateBuildAttempt,CandidateBuildSnapshot} from "./candidate-build-attempts";
import {captureTrustedGitSource,type GitSourceObjectReader,type TrustedGitSource,type TrustedGitSourceProof} from "./trusted-git-source";
import {runIsolatedBuildJob,type IsolatedBuildGrantRpc,type IsolatedBuildArtifact} from "./isolated-build-job";
import type {UntrustedExecutionNamespace} from "./untrusted-execution";
import type {BuildFile,BuildManifest} from "./static-build-artifact";
import type {BrowserVerificationReceipt} from "./external-browser-verifier";

export type IsolatedGitVerificationStage="source"|"build"|"browser";
const messages={source:"Committed source or current authority could not be confirmed",build:"Isolated build or exact cleanup is unconfirmed",browser:"Trusted browser checks or exact session cleanup did not pass"} as const;
export class IsolatedGitVerificationError extends Error {
 constructor(readonly stage:IsolatedGitVerificationStage){super(messages[stage]);this.name="IsolatedGitVerificationError";}
}
export interface IsolatedGitVerificationLedger extends IsolatedBuildGrantRpc {
 prepareCandidateIsolatedBuild(context:IsolatedExecutionContext):Promise<CandidateBuildAttempt>;
 bindCandidateIsolatedSource(snapshot:CandidateBuildSnapshot,source:TrustedGitSource):Promise<IsolatedExecutionContext>;
 isolatedSourceProvider(context:IsolatedExecutionContext):Promise<{providerRepoId:string;canonicalRepoName:string}>;
 assertIsolatedSourceProvenance(context:IsolatedExecutionContext,proof:TrustedGitSourceProof):Promise<void>;
 verifyIsolatedCandidateBrowser(context:IsolatedExecutionContext,source:TrustedGitSource,output:BuildManifest,files:BuildFile[]):Promise<BrowserVerificationReceipt>;
}
export interface IsolatedGitVerificationDependencies {
 ledger:IsolatedGitVerificationLedger;
 reader:GitSourceObjectReader;
 namespace:UntrustedExecutionNamespace;
 /** Receives the exact static output only after independent browser verification. */
 verifiedOutput?(artifact:IsolatedBuildArtifact):void;
}

/** Complete production orchestration; trusted browser evidence is independent of untrusted build output. */
export async function verifyIsolatedGitCandidate(proposed:IsolatedExecutionContext,deps:IsolatedGitVerificationDependencies):Promise<BrowserVerificationReceipt>{
 let stage:IsolatedGitVerificationStage="source";
 try{
  const initial=isolatedExecutionContextSchema.parse(structuredClone(proposed));
  const attempt=structuredClone(await deps.ledger.prepareCandidateIsolatedBuild(initial));
  // Snapshot spreads reorder fields. Canonical schema parsing is required before identity comparisons.
  const pending=isolatedExecutionContextSchema.parse({...attempt.snapshot,scope:attempt.scope,sourceDigest:attempt.sourceDigest??"0".repeat(64)});
  const authorize=async()=>{const current=isolatedExecutionContextSchema.parse(await deps.ledger.isolatedExecutionSnapshot(structuredClone(pending)));if(JSON.stringify(current)!==JSON.stringify(pending))throw new Error("Source scope changed");};
  await authorize();const provider=structuredClone(await deps.ledger.isolatedSourceProvider(structuredClone(pending)));await authorize();
  const source=await captureTrustedGitSource({scope:attempt.scope,provider,reader:deps.reader,authorize});
  await authorize();
  const context=isolatedExecutionContextSchema.parse(await deps.ledger.bindCandidateIsolatedSource(attempt.snapshot,source));
  const expectedBound=isolatedExecutionContextSchema.parse({...pending,sourceDigest:source.sourceManifest.digest});
  if(JSON.stringify(context)!==JSON.stringify(expectedBound))throw new Error("Bound source context differs");
  const boundCurrent=isolatedExecutionContextSchema.parse(await deps.ledger.isolatedExecutionSnapshot(structuredClone(context)));
  if(JSON.stringify(boundCurrent)!==JSON.stringify(context))throw new Error("Bound source authority changed");
  stage="build";
  const artifact=await runIsolatedBuildJob(context,source,{namespace:deps.namespace,grants:deps.ledger,assertSourceProvenance:(current,proof)=>deps.ledger.assertIsolatedSourceProvenance(current,proof)});
  stage="browser";
  const receipt=await deps.ledger.verifyIsolatedCandidateBrowser(context,source,artifact.manifest,artifact.files);
  if(receipt.buildDigest!==artifact.manifest.digest)throw new Error("Verified browser output differs");
  deps.verifiedOutput?.(structuredClone(artifact));
  return receipt;
 }catch{throw new IsolatedGitVerificationError(stage);}
}
