import {bindBrowserPolicy,type BrowserPolicy,type BrowserVerificationTransport} from './external-browser-verifier';
import {TrustedBrowserReceipts,type TrustedBrowserReceiptGuards} from './trusted-browser-receipts';
import {verifyBuildManifest,type BuildFile,type BuildManifest,type StaticBuildScope} from './static-build-artifact';
export interface C02BoundaryInventoryInput{
 storage:DurableObjectStorage;
 trusted:{scope:StaticBuildScope;source:BuildManifest;sourceFiles:BuildFile[];output:BuildManifest;outputFiles:BuildFile[];policy:BrowserPolicy;guards:TrustedBrowserReceiptGuards};
 submittedPolicy:BrowserPolicy;
 transport:BrowserVerificationTransport;
}
/** Runs the real production receipt guard with independently frozen inputs.
 * This proves guard refusal, never a repository publication or Git event. */
export async function refuseC02BoundaryInventory(input:C02BoundaryInventoryInput){
 const trusted={...input.trusted,scope:structuredClone(input.trusted.scope),source:structuredClone(input.trusted.source),output:structuredClone(input.trusted.output),sourceFiles:input.trusted.sourceFiles.map(file=>({...file,bytes:file.bytes.slice()})),outputFiles:input.trusted.outputFiles.map(file=>({...file,bytes:file.bytes.slice()})),policy:structuredClone(input.trusted.policy)};
 const submitted=structuredClone(input.submittedPolicy),expectedPolicy=await bindBrowserPolicy(trusted.policy),submittedPolicy=await bindBrowserPolicy(submitted);
 if(trusted.scope.policyDigest!==expectedPolicy.digest)throw Error('Independent trusted policy scope differs');
 await verifyBuildManifest(trusted.source,trusted.scope,trusted.sourceFiles);await verifyBuildManifest(trusted.output,trusted.scope,trusted.outputFiles,trusted.source.digest);
 const expected=structuredClone(await trusted.guards.expected(trusted.scope.attemptId));
 if(JSON.stringify(expected.scope)!==JSON.stringify(trusted.scope)||expected.sourceDigest!==trusted.source.digest||expected.buildDigest!==trusted.output.digest||expected.policyDigest!==expectedPolicy.digest||JSON.stringify(expected.cases)!==JSON.stringify(expectedPolicy.policy.cases.map(item=>({id:item.id,assertions:item.assertions.length}))))throw Error('Independent expected inventory differs');
 const receipts=new TrustedBrowserReceipts(input.storage);
 if(await receipts.getVerified(trusted.scope.attemptId,trusted.guards))throw Error('Boundary attempt already has verified evidence');
 if(submittedPolicy.digest===expectedPolicy.digest)return{receiptGuardRefused:false,untrustedOriginRefused:true,proof:'untrusted-origin-admission' as const,productionGitEvidence:false as const};
 try{await receipts.verifyAndRecord(trusted.scope.attemptId,{scope:trusted.scope,source:trusted.source,sourceFiles:trusted.sourceFiles,output:trusted.output,outputFiles:trusted.outputFiles,policy:submittedPolicy.policy,transport:input.transport,authorize:()=>trusted.guards.authorize(),budget:()=>trusted.guards.authorize()},trusted.guards);}
 catch(error){if(!(error instanceof Error)||error.message!=='Trusted browser input differs from required inventory')throw error;if(await receipts.getVerified(trusted.scope.attemptId,trusted.guards)!==null)throw Error('Fabricated inventory unexpectedly persisted');return{receiptGuardRefused:true,untrustedOriginRefused:true,proof:'production-receipt-inventory-guard' as const,productionGitEvidence:false as const};}
 throw Error('Fabricated inventory was not refused');
}
