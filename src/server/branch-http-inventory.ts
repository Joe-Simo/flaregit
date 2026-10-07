import {advertisedGitHead} from './exact-git-ref';
import {proxyGitHttp} from './git-http-gateway';
import {validateRecoveryRemote} from './private-recovery-bundle';
import {parseBranchInventory} from './branch-git';
const maximumBytes=1024*1024;
/** Validate the entire native v0/v1 advertisement before projecting branch refs. */
export function advertisedBranches(bytes:Uint8Array,defaultRef:string){
 advertisedGitHead(bytes,defaultRef);
 const decode=new TextDecoder('utf-8',{fatal:true}),rows:string[]=[];let offset=0;
 while(offset<bytes.length){const length=Number.parseInt(decode.decode(bytes.subarray(offset,offset+4)),16);offset+=4;if(!length)continue;const packet=decode.decode(bytes.subarray(offset,offset+length-4));offset+=length-4;const line=packet.split('\0',1)[0]!.replace(/\n$/,'');const match=/^([a-f0-9]{40}) (refs\/heads\/.+)$/.exec(line);if(match){if(/^0{40}$/.test(match[1]!))throw Error('Branch advertisement unavailable');rows.push(`${match[1]}\t${match[2]}`);}}
 return parseBranchInventory(rows.join('\n'));
}
export async function inspectHttpBranches(options:{remote:string;token:string;defaultRef:string;authorize():Promise<void>;fund():Promise<void>;stage?(stage:'http_transport'|'packet_validation'):void;fetcher?:(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>Promise<Response>}){
 validateRecoveryRemote(options.remote);const remote=new URL(options.remote),controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const authorize=async()=>{if(controller.signal.aborted)throw Error('Branch advertisement unavailable');await options.authorize();if(controller.signal.aborted)throw Error('Branch advertisement unavailable');};
 const run=async()=>{await authorize();await options.fund();await authorize();options.stage?.('http_transport');const response=await proxyGitHttp(new Request('https://flaregit.internal/info/refs?service=git-upload-pack',{headers:{'Git-Protocol':'version=1'},signal:controller.signal}),{projectId:'inspection',taskId:'inspection',endpoint:'info/refs',service:'git-upload-pack',write:false},{remote:remote.href,providerOrigin:remote.origin,providerToken:options.token,writeAllowed:false,maxRequestBytes:1,maxResponseBytes:maximumBytes,timeoutMs:10000,finish:async()=>{},authorize:async()=>{try{await authorize();return true;}catch{return false;}},fetcher:options.fetcher});if(!response.ok)throw Error('Branch advertisement unavailable');const bytes=new Uint8Array(await response.arrayBuffer());await authorize();options.stage?.('packet_validation');return advertisedBranches(bytes,options.defaultRef);};
 try{return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Branch advertisement unavailable'));},10000);})]);}finally{clearTimeout(timer);controller.abort();}
}
