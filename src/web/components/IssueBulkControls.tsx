import React,{useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {apiJson,apiSessionIdentity} from '../api';
export function IssueBulkControls({projectId,numbers,onSaved}:{projectId:string;numbers:number[];onSaved:()=>void}){
 const [label,setLabel]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),lock=useRef(false);
 const apply=async()=>{if(lock.current||!numbers.length||!label.trim())return;lock.current=true;setBusy(true);setError(null);const identity=apiSessionIdentity();try{const snapshot=await apiJson<{revision:number}>(`/p/${projectId}/issue-features`);if(identity!==apiSessionIdentity())return;await apiJson(`/p/${projectId}/issue-features`,{method:'PATCH',json:{expectedRevision:snapshot.revision,action:{kind:'bulk-label',numbers,label}}});if(identity===apiSessionIdentity())onSaved();}catch(e){setError(`Bulk update could not be confirmed. Existing labels are preserved; retrying adds each label once. ${e instanceof Error?e.message:''}`);}finally{lock.current=false;setBusy(false);}};
 return <div className="flex flex-col gap-2"><div className="flex flex-wrap items-center gap-2"><span className="text-sm">{numbers.length} selected</span><Input aria-label="Label for selected issues" className="w-48" maxLength={50} disabled={busy} value={label} onChange={e=>setLabel(e.target.value)}/><Button size="sm" variant="outline" disabled={busy||!label.trim()} onClick={()=>void apply()}>Label selected issues</Button></div>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
