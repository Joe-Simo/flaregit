import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiJson, apiSessionIdentity } from '../api';

const lifecycleSchema=z.object({state:z.enum(['active','archived']),archivedAt:z.iso.datetime().nullable(),version:z.number().int().positive().safe()}).refine(value=>(value.state==='active')===(value.archivedAt===null));
export function RepositoryArchiveCard({projectId,onChange}:{projectId:string;onChange:()=>void}) {
  const {userId}=useAuth();
  const identity=apiSessionIdentity();
  const [lifecycle,setLifecycle]=useState<z.infer<typeof lifecycleSchema>|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState<string|null>(null);
  const alive=useRef(false),sequence=useRef(0),lock=useRef(false);
  const current=(generation:number)=>alive.current&&generation===sequence.current&&identity!==null&&apiSessionIdentity()===identity;
  const load=async(refreshParent=false,signal?:AbortSignal)=>{
    if(lock.current||!alive.current||identity===null||apiSessionIdentity()!==identity)return;
    const generation=++sequence.current;
    setBusy(true);setError(null);
    try{
      const observed=lifecycleSchema.parse(await apiJson<unknown>(`/p/${encodeURIComponent(projectId)}/lifecycle`,{signal}));
      if(current(generation)){setLifecycle(observed);setUncertain(false);if(refreshParent)onChange();}
    }catch(cause){if(current(generation))setError(cause instanceof Error?cause.message:'Repository archive state could not be loaded.');}
    finally{if(current(generation))setBusy(false);}
  };
  useEffect(()=>{
    alive.current=true;setLifecycle(null);setUncertain(false);lock.current=false;
    const controller=new AbortController();void load(false,controller.signal);
    return()=>{alive.current=false;sequence.current++;controller.abort();};
  },[projectId,userId,identity]);
  const transition=async()=>{
    if(lock.current||busy||uncertain||!lifecycle||!alive.current||identity===null||apiSessionIdentity()!==identity)return;
    const original=lifecycle,action=original.state==='active'?'archive':'unarchive',expectedState=action==='archive'?'archived':'active',generation=++sequence.current;
    lock.current=true;setBusy(true);setError(null);
    try{
      const receipt=lifecycleSchema.parse(await apiJson<unknown>(`/p/${encodeURIComponent(projectId)}/lifecycle`,{method:'POST',json:{action,expectedVersion:original.version}}));
      if(receipt.state!==expectedState||receipt.version!==original.version+1)throw new Error('Repository archive transition was not confirmed.');
      if(current(generation)){setLifecycle(receipt);setUncertain(false);onChange();}
    }catch(cause){if(current(generation)){setUncertain(true);setError(`${cause instanceof Error?cause.message:'Repository archive transition was not confirmed.'} Refresh archive state before another action.`);}}
    finally{if(current(generation)){lock.current=false;setBusy(false);}}
  };
  return <Card><CardHeader><CardTitle className="text-sm">Repository archive</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">{lifecycle?.state==='archived'?'This repository is archived. Unarchive it to resume contributions.':'Archiving makes this repository read-only and preserves its history.'}</p>
    {lifecycle?.archivedAt&&<p className="text-xs text-muted-foreground">Archived {new Date(lifecycle.archivedAt).toLocaleString()}</p>}
    {!lifecycle&&!error&&<p role="status" className="text-sm text-muted-foreground">Loading archive state…</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">{lifecycle&&<Button variant="outline" disabled={busy||uncertain} onClick={()=>void transition()}>{busy?'Updating…':lifecycle.state==='active'?'Archive repository':'Unarchive repository'}</Button>}{(error||uncertain)&&<Button variant="outline" disabled={busy} onClick={()=>void load(true)}>Refresh archive state</Button>}</div>
  </CardContent></Card>;
}
