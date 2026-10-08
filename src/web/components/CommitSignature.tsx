import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {apiJson,apiSessionIdentity} from '../api';
import type {CommitSignatureInspection} from '../../server/commit-signature-inspection';

/** Explicit inspection avoids allocating native work for every journal row. */
export function CommitSignature({projectId,commit,task,candidate,input}:{projectId:string;commit:string;task?:string;candidate?:string;input?:string}){
 const identity=apiSessionIdentity(),scope=JSON.stringify([identity,projectId,commit,task,candidate,input]),active=useRef(scope);active.current=scope;
 const [state,setState]=useState<{scope:string;busy?:boolean;result?:CommitSignatureInspection;error?:string}|null>(null),controller=useRef<AbortController|null>(null),busyScope=useRef<string|null>(null);
 useEffect(()=>{const invalidate=()=>{controller.current?.abort();busyScope.current=null;setState(null);};window.addEventListener('flaregit:signing-keys-changed',invalidate);return()=>{window.removeEventListener('flaregit:signing-keys-changed',invalidate);controller.current?.abort();};},[scope]);
 const current=state?.scope===scope?state:null;
 const inspect=async()=>{if(busyScope.current===scope)return;busyScope.current=scope;controller.current?.abort();const request=new AbortController();controller.current=request;setState({scope,busy:true});
  try{const query=new URLSearchParams({commit,...(task?{task}:{}),...(candidate?{candidate}:{}),...(input?{input}:{})});const result=await apiJson<CommitSignatureInspection>(`/p/${projectId}/commit-signature?${query}`,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(90000)])});if(request.signal.aborted||controller.current!==request||active.current!==scope||apiSessionIdentity()!==identity)return;if(result.commit!==commit||result.trust!=='viewer-registered-keys')throw Error('Signature response does not match this commit and trust scope');setState({scope,result});}
  catch(error){if(active.current===scope&&!request.signal.aborted&&apiSessionIdentity()===identity)setState({scope,error:error instanceof Error?error.message:'Signature inspection unavailable'});}
  finally{if(controller.current===request&&busyScope.current===scope)busyScope.current=null;}
 };
 return <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Commit signature"><Button type="button" size="sm" variant="ghost" disabled={current?.busy} onClick={()=>void inspect()}>{current?.busy?'Checking signature…':current?.result?'Check signature again':'Check signature'}</Button>{current?.result&&<span role="status" className="text-muted-foreground">{current.result.status==='verified'?'Signature verified with your registered key':current.result.status==='unsigned'?'Unsigned commit':current.result.status==='unsupported'?'Unsupported signature':current.result.status==='malformed'?'Malformed signature':'Signature unverified'}{current.result.format?` · ${current.result.format.toUpperCase()}`:''}{current.result.fingerprint&&<code className="ml-2 break-all">{current.result.fingerprint}</code>}{current.result.reason&&<span className="block">{current.result.reason}</span>}<time className="block" dateTime={current.result.checkedAt}>Checked {new Date(current.result.checkedAt).toLocaleString()}</time></span>}{current?.error&&<span role="alert" className="text-destructive">{current.error}</span>}</div>;
}
