import {isSafeRef} from "../core/sanitize";
import {proxyGitHttp} from "./git-http-gateway";
import {validateRecoveryRemote} from "./private-recovery-bundle";
const MAX_BYTES=1024*1024;
const exactRef=(ref:string)=>isSafeRef(ref)&&/^(?:refs\/heads\/|refs\/flaregit\/).+/.test(ref);
/** Strict Git v0/v1 advertisement, never branch/tag DWIM or a metadata fallback. */
export function advertisedGitHead(bytes:Uint8Array,ref:string):string|null {
 if(!exactRef(ref)||bytes.byteLength>MAX_BYTES)throw new Error("Git reference inspection unavailable");
 const decode=new TextDecoder("utf-8",{fatal:true});let offset=0,packet=0,ended=false,firstRef=true,versionSeen=false,head:string|null=null;
 while(offset<bytes.length){
  if(ended||offset+4>bytes.length||++packet>16384)throw new Error("Git reference inspection unavailable");
  const prefix=decode.decode(bytes.subarray(offset,offset+4));if(!/^[a-f0-9]{4}$/.test(prefix))throw new Error("Git reference inspection unavailable");
  const length=Number.parseInt(prefix,16);offset+=4;
  if(length===0){if(packet===2)continue;if(packet<3)throw new Error("Git reference inspection unavailable");ended=true;continue;}
  if(length<5||offset+length-4>bytes.length)throw new Error("Git reference inspection unavailable");
  const data=decode.decode(bytes.subarray(offset,offset+length-4));offset+=length-4;
  if(packet===1){if(data!=="# service=git-upload-pack\n")throw new Error("Git reference inspection unavailable");continue;}
  if(packet<3||!data.endsWith("\n"))throw new Error("Git reference inspection unavailable");
  if(data==="version 1\n"){if(packet!==3||versionSeen)throw new Error("Git reference inspection unavailable");versionSeen=true;continue;}
  const line=data.slice(0,-1),nul=line.indexOf("\0");if(nul!==-1&&!firstRef)throw new Error("Git reference inspection unavailable");
  const nameLine=nul===-1?line:line.slice(0,nul),match=/^([a-f0-9]{40}) ([^\0\r\n ]+)$/.exec(nameLine);
  if(!match)throw new Error("Git reference inspection unavailable");
  const name=match[2]!,plain=name.endsWith("^{}")?name.slice(0,-3):name;
  if(name!=="HEAD"&&name!=="capabilities^{}"&&(!plain.startsWith("refs/")||!isSafeRef(plain)))throw new Error("Git reference inspection unavailable");
  firstRef=false;
  if(name===ref){if(head!==null)throw new Error("Git reference inspection unavailable");head=match[1]!;}
 }
 if(!ended||packet<3||versionSeen&&firstRef)throw new Error("Git reference inspection unavailable");return head;
}
export async function observeExactGitHead(options:{remote:string;token:string;ref:string;authorize():Promise<void>;fund():Promise<void>;fetcher?:(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>Promise<Response>}):Promise<string|null>{
 validateRecoveryRemote(options.remote);if(!exactRef(options.ref))throw new Error("Git reference inspection unavailable");
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const active=()=>{if(controller.signal.aborted)throw new Error("Git reference inspection unavailable");};
 const authorize=async()=>{active();await options.authorize();active();};
 const run=async()=>{const remote=new URL(options.remote);await authorize();active();await options.fund();active();await authorize();
 const response=await proxyGitHttp(new Request("https://flaregit.internal/info/refs?service=git-upload-pack",{headers:{"Git-Protocol":"version=1"},signal:controller.signal}),{projectId:"inspection",taskId:"inspection",endpoint:"info/refs",service:"git-upload-pack",write:false},{remote:remote.href,providerOrigin:remote.origin,providerToken:options.token,writeAllowed:false,maxRequestBytes:1,maxResponseBytes:MAX_BYTES,timeoutMs:10000,finish:async()=>{},authorize:async()=>{try{await authorize();return true;}catch{return false;}},fetcher:options.fetcher});
 if(!response.ok)throw new Error("Git reference inspection unavailable");
 const bytes=new Uint8Array(await response.arrayBuffer());await authorize();return advertisedGitHead(bytes,options.ref);};
 try{return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("Git reference inspection unavailable"));},10000);})]);}finally{clearTimeout(timer);controller.abort();}
}

export type RerunGitHeadVerification={ok:true}|{ok:false;reason:"tip_unavailable"|"tip_differs"|"inspection_unavailable"|"cleanup_unconfirmed"};
/** Internal bounded classification; provider text never populates this value. */
export class ExactGitInspectionError extends Error {constructor(readonly reason:"inspection_unavailable"|"cleanup_unconfirmed"){super(reason);}}
