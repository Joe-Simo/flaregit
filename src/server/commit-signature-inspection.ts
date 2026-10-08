import {z} from 'zod';
import {parseCommitSignature,type CommitSignatureFormat} from '../core/commit-signature';
import {verifySshSignature} from '../core/ssh-signature';
import {verifyGpgSignature} from '../core/gpg-signature';
import type {TrustedKey} from '../core/trusted-keys';
import type {TrustedGpgKey} from '../core/trusted-gpg-keys';
import type {BranchGitExecutor} from './branch-git';
import {validateRecoveryRemote} from './private-recovery-bundle';
import {gitAuthEnv,q} from './shell';
import {READ_GIT_OBJECT} from './git-object-read-command';

const sha=z.string().regex(/^[a-f0-9]{40}$/).refine(value=>value!=='0'.repeat(40));
const identity=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/);
export const commitSignatureRequest=z.object({commit:sha,task:identity.optional(),candidate:identity.optional(),input:identity.optional()}).strict().refine(value=>!(value.task&&(value.candidate||value.input))&&(!value.input||Boolean(value.candidate)));
export type CommitSignatureRequest=z.infer<typeof commitSignatureRequest>;
export interface CommitSignatureInspection{commit:string;status:'unsigned'|'verified'|'unverified'|'unsupported'|'malformed';format?:CommitSignatureFormat;fingerprint?:string;reason?:string;trust:'viewer-registered-keys';checkedAt:string;trustRevision?:number}
export interface SigningTrustSnapshot{ssh:TrustedKey[];gpg:TrustedGpgKey[];revision:number;observedAt:string}
const MAX_COMMIT_BYTES=256*1024;
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');

/** The raw commit hash is verified before its signature. Binary strings preserve
 * every payload byte, including legacy encodings, without UTF-8 replacement. */
export async function inspectCommitSignature(commit:string,bytes:Uint8Array,keys:{ssh:readonly TrustedKey[];gpg:readonly TrustedGpgKey[]}):Promise<CommitSignatureInspection>{
 sha.parse(commit);if(bytes.length>MAX_COMMIT_BYTES||keys.ssh.length>20||keys.gpg.length>20)throw Error('Commit signature inspection limit reached');
 const header=new TextEncoder().encode(`commit ${bytes.length}\0`),object=new Uint8Array(header.length+bytes.length);object.set(header);object.set(bytes,header.length);
 if(hex(await crypto.subtle.digest('SHA-1',object))!==commit)throw Error('Raw commit hash differs from the requested commit');
 const base={commit,trust:'viewer-registered-keys' as const,checkedAt:new Date().toISOString()},raw=Array.from(bytes,byte=>String.fromCharCode(byte)).join(''),parsed=parseCommitSignature(raw);
 if(!parsed.ok)return {...base,status:'malformed',reason:parsed.error};
 if(!parsed.value.signed)return {...base,status:'unsigned'};
 const {format,signature,signedPayload}=parsed.value,payload=Uint8Array.from(signedPayload,character=>character.charCodeAt(0));
 if(format==='x509'||format==='unknown')return {...base,status:'unsupported',format,reason:format==='x509'?'No X.509 trust-root policy is configured':'Signature format is unsupported'};
 if(format==='gpg'){
  const result=await verifyGpgSignature({armored:signature,payload,trustedKeys:keys.gpg.map(key=>key.armored)});
  return result.ok?{...base,status:'verified',format,fingerprint:result.fingerprint}:{...base,status:'unverified',format,reason:result.error};
 }
 for(const key of keys.ssh){
  const result=await verifySshSignature({armored:signature,payload,namespace:'git',trustedKeys:[`${key.type} ${key.blob}`]});
  if(result.ok){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(atob(key.blob),character=>character.charCodeAt(0))));return {...base,status:'verified',format,fingerprint:'SHA256:'+btoa(Array.from(digest,byte=>String.fromCharCode(byte)).join('')).replace(/=+$/,'')};}
 }
 return {...base,status:'unverified',format,reason:keys.ssh.length?'Signature does not verify for a registered SSH key':'No trusted SSH keys are registered'};
}

/** A bare fetch and object read only: no checkout, hooks, filters or customer
 * commands. A guessed object must be reachable from the frozen authorized head. */
export async function readCommitSignatureObject(executor:BranchGitExecutor,input:{remote:string;token:string;anchor:string;commit:string;operationId:string}):Promise<Uint8Array>{
 validateRecoveryRemote(input.remote);sha.parse(input.anchor);sha.parse(input.commit);z.uuid().parse(input.operationId);
 const directory=`/workspace/signature-${input.operationId}`,run=async(command:string)=>{await executor.beforeCommand('before');const result=await executor.exec(command,gitAuthEnv(input.token));await executor.beforeCommand('after');if(!result.success)throw Error('Pinned commit signature object is unavailable');return result.stdout;};
 await run(`git init --quiet --bare ${q(directory)} && git -C ${q(directory)} fetch --quiet --no-tags ${q(input.remote)} ${q(input.anchor)} && git -C ${q(directory)} merge-base --is-ancestor ${q(input.commit)} ${q(input.anchor)}`);
 const script=READ_GIT_OBJECT.replace('/workspace/integration',directory).replace('await Bun.write(Bun.stdout,bytes);',"console.log(Buffer.from(bytes).toString('base64'));");
 const output=(await run(`/usr/local/bin/bun -e ${q(script)} commit ${q(input.commit)} ${MAX_COMMIT_BYTES}`)).trim();
 if(output.length>Math.ceil(MAX_COMMIT_BYTES/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(output))throw Error('Pinned commit byte response is malformed');
 return Uint8Array.from(atob(output),character=>character.charCodeAt(0));
}
