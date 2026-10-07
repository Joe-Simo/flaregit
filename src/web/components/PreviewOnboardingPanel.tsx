import {useEffect,useRef,useState} from 'react';
import {previewOnboardingViewSchema as viewSchema,type PreviewOnboardingView as PreviewView} from '@/core/preview-onboarding-view';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {apiJson,apiSessionIdentity} from '../api';
import {readPreviewRequest,savePreviewRequest,type PreviewRequest} from '../preview-onboarding-recovery';
const label:Record<PreviewView['status'],string>={disabled:'Preview provisioning unavailable',unconfigured:'No isolated preview configured',reserved:'Preview allocation reserved',dispatch_unknown:'Provisioning outcome unconfirmed',deployed:'Worker deployed · registration pending',active:'Isolated preview ready',retired:'Preview allocation retired'};
export function PreviewOnboardingPanel({projectId,isOwner=false}:{projectId:string;isOwner?:boolean}){
 const identity=apiSessionIdentity(),scope=JSON.stringify([identity,projectId,isOwner]);
 const active=useRef(scope);active.current=scope;
 const generation=useRef(0),controller=useRef<AbortController|null>(null),lock=useRef(false),original=useRef<PreviewRequest|null>(null);
 const [data,setData]=useState<PreviewView|null>(null),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[unknown,setUnknown]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{const current=++generation.current,captured=scope,abort=new AbortController();controller.current=abort;original.current=null;lock.current=true;setBusy(true);setConfirmed(false);setUnknown(false);setData(null);setError('');
  if(identity&&isOwner)try{original.current=readPreviewRequest(sessionStorage,identity,projectId);}catch{setError('Browser recovery data is unavailable. Check the original server request before continuing.');}
  void apiJson<unknown>(`/p/${projectId}/preview-onboarding`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])}).then(raw=>{if(current!==generation.current||active.current!==captured)return;const view=viewSchema.parse(raw);setData(view);setConfirmed(true);if(isOwner&&identity&&view.requestId){try{original.current=savePreviewRequest(sessionStorage,identity,projectId,{requestId:view.requestId});setError('');}catch{setError('The original server request was found, but browser recovery could not be saved. No provisioning request was sent.');setConfirmed(false);}}else setError('');}).catch(()=>{if(current===generation.current&&!abort.signal.aborted)setError('Preview status could not be confirmed. Repository browsing and review remain available.');}).finally(()=>{if(current===generation.current){lock.current=false;setBusy(false);}});
  return()=>{generation.current++;abort.abort();controller.current?.abort();};
 },[scope,projectId,identity,isOwner,revision]);
 const submit=async()=>{if(lock.current||!identity||!isOwner||!confirmed||!data)return;const action=data.status==='unconfigured'?'prepare':'resume';if(action==='prepare'&&!data.canPrepare)return;if(action==='resume'&&(!data.canRetry||data.nextAction==='owner_reconciliation_required'))return;const captured=scope,current=generation.current,abort=new AbortController();controller.current=abort;lock.current=true;setBusy(true);setError('');let dispatched=false;
  try{if(action==='resume'&&!original.current)throw Error('Original request identity is unavailable.');const request=savePreviewRequest(sessionStorage,identity,projectId,original.current??{requestId:crypto.randomUUID()});original.current=request;setUnknown(true);
   dispatched=true;const raw=await apiJson<unknown>(`/p/${projectId}/preview-onboarding`,{method:'POST',body:JSON.stringify({...request,action}),headers:{'Content-Type':'application/json'},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(30000)])});
   if(current!==generation.current||active.current!==captured)return;const view=viewSchema.parse(raw);if(view.requestId&&view.requestId!==request.requestId)throw Error('Original preview request identity changed.');setData(view);setUnknown(false);setConfirmed(true);
  }catch(cause){if(current===generation.current&&active.current===captured){setError(dispatched?'Provisioning outcome unconfirmed. Check server status, then resume the original request.':'Browser recovery could not be saved. No provisioning request was sent.');setConfirmed(false);if(!dispatched)setUnknown(false);void cause;}}
  finally{if(current===generation.current){lock.current=false;setBusy(false);}}
 };
 const canAct=isOwner&&identity&&confirmed&&data&&(data.status==='unconfigured'&&data.canPrepare||data.canRetry)&&!['disabled','active','retired'].includes(data.status)&&data.nextAction!=='owner_reconciliation_required';
 return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Isolated previews</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
  <p className="text-xs text-muted-foreground">A repository gets its own preview origin. Provisioning does not accept changes or deploy the accepted repository.</p>
  {data&&<p role="status" className="font-medium">{label[data.status]}{!confirmed?' · last recorded':''}</p>}
  {data?.status==='disabled'&&<p className="text-xs text-muted-foreground">Platform preview configuration or its allocation limit is unavailable. Browsing and review remain available.</p>}
  {data?.reason&&<p className="text-xs text-muted-foreground">{data.reason==='dispatch_unconfirmed'?'The original dispatch needs reconciliation before another deployment can be attempted.':data.reason==='registration_unavailable'?'The Worker exists; exclusive origin registration needs recovery.':data.reason==='capacity_exhausted'?'The platform preview allocation limit has been reached.':data.reason==='configuration_unavailable'?'Platform preview configuration is unavailable.':data.reason==='provisioning_disabled'?'Platform preview provisioning is disabled.':'The provider response could not be confirmed.'}</p>}
  {data?.nextAction==='owner_reconciliation_required'&&<p className="text-xs text-muted-foreground">The original preview allocation belongs to an earlier owner. Owner reconciliation is required before provisioning can resume.</p>}
  {data?.status==='active'&&data.origin&&<p className="text-xs break-all">Preview origin: {data.origin}</p>}
  {unknown&&<p className="text-xs">The original request is saved in this browser session. Check status before continuing.</p>}
  {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  {canAct&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void submit()}>{busy?'Saving preview request…':data.status==='unconfigured'?'Prepare isolated preview':'Resume original preview request'}</Button>}
  <Button size="sm" variant="ghost" disabled={busy} onClick={()=>setRevision(value=>value+1)}>{busy?'Checking preview…':'Check preview status'}</Button>
 </CardContent></Card>;
}
