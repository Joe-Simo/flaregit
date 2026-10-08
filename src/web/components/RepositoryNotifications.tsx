import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogClose,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {apiJson} from '../api';
import type {InboxPreference,InboxDeliveryMode} from '../../server/inbox-preferences';
export function RepositoryNotifications({projectId,projectName}:{projectId:string;projectName:string}){
  const [preferenceTarget,setPreferenceTarget]=useState<{project_id:string;project_name:string}|null>(null);
  const [preference,setPreference]=useState<InboxPreference|null>(null);
  const [preferenceError,setPreferenceError]=useState<string|null>(null);
  const [preferenceBusy,setPreferenceBusy]=useState(false);
  const preferenceSequence=useRef(0),preferenceController=useRef<AbortController|null>(null);
  useEffect(()=>()=>{preferenceSequence.current++;preferenceController.current?.abort();},[]);
  const closePreferences=()=>{preferenceSequence.current++;preferenceController.current?.abort();setPreferenceTarget(null);setPreference(null);setPreferenceBusy(false);};
  const openPreferences=async(item:{project_id:string;project_name:string})=>{const sequence=++preferenceSequence.current;preferenceController.current?.abort();const controller=new AbortController();preferenceController.current=controller;setPreferenceTarget(item);setPreference(null);setPreferenceError(null);setPreferenceBusy(true);try{const result=await apiJson<InboxPreference>(`/inbox/preferences/${encodeURIComponent(item.project_id)}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});if(sequence===preferenceSequence.current&&result.projectId===item.project_id)setPreference(result);}catch(error){if(sequence===preferenceSequence.current&&!controller.signal.aborted)setPreferenceError(error instanceof Error?error.message:"Preferences could not be loaded");}finally{if(sequence===preferenceSequence.current)setPreferenceBusy(false);}};
  const savePreference=async(mode:InboxDeliveryMode)=>{if(!preference||!preferenceTarget||preferenceBusy)return;const sequence=preferenceSequence.current;setPreferenceBusy(true);setPreferenceError(null);try{const result=await apiJson<InboxPreference>(`/inbox/preferences/${encodeURIComponent(preference.projectId)}`,{method:"POST",json:{mode,expectedVersion:preference.version},signal:AbortSignal.timeout(15000)});if(sequence===preferenceSequence.current)setPreference(result);}catch(error){if(sequence===preferenceSequence.current)setPreferenceError(error instanceof Error?error.message:"Preference was not confirmed");}finally{if(sequence===preferenceSequence.current)setPreferenceBusy(false);}};

  return <><Button size="sm" variant="ghost" aria-label={`Notification delivery for ${projectName}`} onClick={event=>{event.stopPropagation();void openPreferences({project_id:projectId,project_name:projectName});}}>Notifications</Button>
      <Dialog open={preferenceTarget!==null} onOpenChange={open=>{if(!open)closePreferences();}}><DialogClose onClick={closePreferences}/><DialogHeader className="pr-6"><DialogTitle className="break-words leading-snug">Notifications for {preferenceTarget?.project_name}</DialogTitle></DialogHeader><div className="space-y-3">
        <p className="text-sm text-muted-foreground">Controls new repository notifications. Existing inbox items stay available.</p>
        {preferenceBusy&&!preference&&<p role="status" className="text-sm">Loading saved preference…</p>}
        {preferenceError&&<p role="alert" className="text-sm text-destructive">{preferenceError}</p>}
        {preference&&<div className="grid gap-2">{([["watching","All activity","Receive activity and requests that need you."],["unsubscribed","Needs you only","Receive direct requests; skip general activity."],["muted","Muted","Stop new notifications from this repository."]] as const).map(([mode,label,description])=><Button key={mode} variant={preference.mode===mode?"secondary":"outline"} className="h-auto py-3 text-left justify-start flex-col items-start whitespace-normal" aria-pressed={preference.mode===mode} disabled={preferenceBusy} onClick={()=>void savePreference(mode)}><span>{label}</span><span className="text-xs font-normal text-muted-foreground">{description}</span></Button>)}</div>}
        {preference&&<p role="status" className="text-xs text-muted-foreground">{preferenceBusy?"Saving…":`Saved: ${preference.mode==="watching"?"All activity":preference.mode==="unsubscribed"?"Needs you only":"Muted"}`}</p>}
        {preferenceError&&preferenceTarget&&<Button variant="outline" onClick={()=>void openPreferences(preferenceTarget)}>Reload saved preference</Button>}
      </div></Dialog>
</>;
}
