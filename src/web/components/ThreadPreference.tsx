import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {Button} from '@/components/ui/button';
import {apiJson,apiSessionIdentity} from '../api';
import type {ThreadMode} from '../../server/thread-notifications';
const preference=z.object({subject:z.string(),mode:z.enum(['subscribed','unsubscribed','muted']),version:z.number().int().nonnegative().safe()});
export function ThreadPreference({projectId,subject}:{projectId:string;subject:string}){
 const principal=apiSessionIdentity(),scope=JSON.stringify([principal,projectId,subject]),currentScope=useRef(scope);currentScope.current=scope;
 const controller=useRef<AbortController|null>(null),lock=useRef(false);
 const [state,setState]=useState<{scope:string;value?:z.infer<typeof preference>;busy?:boolean;error?:string}|null>(null);
 const url=`/p/${projectId}/thread-preference?subject=${encodeURIComponent(subject)}`;
 const current=(request:AbortController)=>currentScope.current===scope&&controller.current===request&&!request.signal.aborted&&apiSessionIdentity()===principal;
 const load=async(request:AbortController)=>{
  try{const value=preference.parse(await apiJson<unknown>(url,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])}));if(value.subject!==subject)throw Error('Thread preference belongs to another conversation');if(current(request))setState({scope,value});}
  catch(error){if(current(request))setState({scope,error:error instanceof Error?error.message:'Thread preference unavailable'});}
 };
 useEffect(()=>{const request=new AbortController();controller.current=request;lock.current=false;setState(null);if(principal)void load(request);return()=>request.abort();},[scope]);
 const save=async(mode:ThreadMode)=>{
  const request=controller.current,value=state?.scope===scope?state.value:undefined;if(!request||!value||lock.current||!current(request))return;
  lock.current=true;setState({scope,value,busy:true});
  try{const saved=preference.parse(await apiJson<unknown>(url,{method:'PUT',json:{mode,expectedVersion:value.version},signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])}));if(saved.subject!==subject||saved.mode!==mode||saved.version!==value.version+1)throw Error('Thread preference was not confirmed; reload before retrying');if(current(request))setState({scope,value:saved});}
  catch(error){if(current(request))setState({scope,value,error:error instanceof Error?error.message:'Thread preference was not confirmed'});}
  finally{if(current(request))lock.current=false;}
 };
 const selected=state?.scope===scope?state:null;
 if(!principal)return null;
 return <div className="space-y-2" aria-label="Thread notifications"><div className="flex flex-wrap items-center gap-1"><span className="text-xs text-muted-foreground mr-1">Thread notifications</span>{([['subscribed','Subscribe'],['unsubscribed','Unsubscribe'],['muted','Mute']] as const).map(([mode,label])=><Button type="button" key={mode} size="sm" variant={selected?.value?.mode===mode?'secondary':'ghost'} aria-pressed={selected?.value?.mode===mode} disabled={!selected?.value||selected.busy} onClick={()=>void save(mode)}>{label}</Button>)}</div><p className="text-xs text-muted-foreground">Unsubscribe stops replies. Mute also stops mentions.</p>{selected?.error&&<div className="flex flex-wrap items-center gap-2 text-xs"><p role="alert" className="text-destructive">{selected.error}</p><Button type="button" size="sm" variant="outline" disabled={selected.busy} onClick={()=>{const request=controller.current;if(request&&!lock.current)void load(request);}}>Reload thread preference</Button></div>}{selected?.busy&&<p role="status" className="text-xs text-muted-foreground">Saving thread preference…</p>}</div>;
}
