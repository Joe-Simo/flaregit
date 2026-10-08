import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {apiFetch, apiJson, apiSessionIdentity} from '../api';

type AttachmentView = {id:string;name:string;sha256:string;size:number;phase:'pending'|'verified'|'removed';authorId:string;author:string;canRemove:boolean;canReconcile:boolean;createdAt:string};
type Upload = {id:string;file:File;sha256:string;identity:string};
const maxSize = 5 * 1024 * 1024;
const message = (error:unknown) => error instanceof Error ? error.message : 'Attachment request failed.';
function safeFilename(value:string):string {return value.replace(/[\\/\u0000-\u001f\u007f]/g,'_').trim().slice(0,200) || 'attachment';}
function downloadFilename(header:string|null, fallback:string):string {
 const encoded=header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
 if(encoded)try{return safeFilename(decodeURIComponent(encoded));}catch{/* Use the original name when the header is invalid. */}
 const quoted=header?.match(/filename="([^"\r\n]*)"/i)?.[1];
 return safeFilename(quoted || fallback);
}
export function IssueAttachments({projectId,number}:{projectId:string;number:number}) {
 const path=`/p/${encodeURIComponent(projectId)}/issues/${number}/attachments`;
 const [rows,setRows]=useState<AttachmentView[]|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[selected,setSelected]=useState<File|null>(null),[canUpload,setCanUpload]=useState(false);
 const rowsIdentity=useRef<string|null>(null);
 const upload=useRef<Upload|null>(null),lock=useRef(false),generation=useRef(0),input=useRef<HTMLInputElement>(null);
 const activeSessionIdentity=apiSessionIdentity();
 const current=(version:number,identity:string|null)=>version===generation.current&&apiSessionIdentity()===identity;
 const load=useCallback(async(signal?:AbortSignal)=>{
  const version=generation.current,identity=apiSessionIdentity();
  try{const result=await apiJson<{attachments:AttachmentView[];canUpload:boolean}>(path,{signal});if(current(version,identity)){rowsIdentity.current=identity;setRows(result.attachments);setCanUpload(result.canUpload);setError(null);}}
  catch(cause){if(current(version,identity)&&!signal?.aborted)setError(message(cause));}
 },[path]);
 useEffect(()=>{generation.current++;const controller=new AbortController();rowsIdentity.current=null;setRows(null);setBusy(false);setCanUpload(false);setSelected(null);upload.current=null;void load(controller.signal);return()=>{generation.current++;controller.abort();};},[load,activeSessionIdentity]);
 const assertCurrent=(version:number,identity:string)=>{if(!current(version,identity))throw new DOMException('Your signed-in session changed.','AbortError');};
 const attach=async()=>{
  if(lock.current||!selected||!canUpload||!activeSessionIdentity||rowsIdentity.current!==activeSessionIdentity)return;
  const version=generation.current,identity=activeSessionIdentity;lock.current=true;setBusy(true);setError(null);
  try{
   assertCurrent(version,identity);
   if(selected.size>maxSize)throw new Error('Choose a file up to 5 MB.');
   if(!upload.current){const bytes=await selected.arrayBuffer();assertCurrent(version,identity);const hash=await crypto.subtle.digest('SHA-256',bytes);assertCurrent(version,identity);upload.current={id:crypto.randomUUID(),file:selected,sha256:Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join(''),identity};}
   const intent=upload.current;if(intent.identity!==identity)throw new Error('Select the file again from the current account.');
   const view=await apiJson<AttachmentView>(path,{method:'POST',json:{id:intent.id,name:intent.file.name,sha256:intent.sha256,size:intent.file.size}});assertCurrent(version,identity);
   if(view.phase!=='verified'){
    const response=await apiFetch(`/api${path}/${encodeURIComponent(intent.id)}/content`,{method:'PUT',body:intent.file,headers:{'Content-Type':'application/octet-stream'}});assertCurrent(version,identity);
    if(!response.ok)throw new Error(await response.text() || 'Upload could not be confirmed.');
    await response.body?.cancel();assertCurrent(version,identity);
    const confirmation=await apiJson<AttachmentView & {reconciled:boolean}>(`${path}/${encodeURIComponent(intent.id)}/reconcile`,{method:'POST'});assertCurrent(version,identity);
    if(confirmation.phase!=='verified')throw new Error('The upload is still pending. Check the upload or retry this file.');
   }
   await load();assertCurrent(version,identity);upload.current=null;setSelected(null);if(input.current)input.current.value='';
  }catch(cause){if(current(version,identity))setError(`Attachment could not be confirmed. Retry to resume the same file. ${message(cause)}`);}
  finally{lock.current=false;if(current(version,identity))setBusy(false);}
 };
 const act=async(row:AttachmentView,action:'download'|'reconcile'|'remove')=>{
  if(lock.current||!activeSessionIdentity||rowsIdentity.current!==activeSessionIdentity||(action==='remove'&&!row.canRemove)||(action==='reconcile'&&!row.canReconcile))return;const version=generation.current,identity=activeSessionIdentity;lock.current=true;setBusy(true);setError(null);
  try{
   assertCurrent(version,identity);const itemPath=`${path}/${encodeURIComponent(row.id)}`;
   if(action==='download'){
    const response=await apiFetch(`/api${itemPath}/content`);assertCurrent(version,identity);if(!response.ok)throw new Error(await response.text() || 'Download unavailable.');
    if(!Number.isSafeInteger(row.size)||row.size<0||row.size>maxSize){await response.body?.cancel();throw new Error('Attachment exceeds the download limit.');}
    const reader=response.body?.getReader();const parts:ArrayBuffer[]=[];let received=0;
    if(reader)try{while(true){assertCurrent(version,identity);const next=await reader.read();assertCurrent(version,identity);if(next.done)break;received+=next.value.byteLength;if(received>row.size||received>maxSize)throw new Error('Attachment size did not match.');parts.push(new Uint8Array(next.value).buffer);}}catch(cause){await reader.cancel().catch(()=>undefined);throw cause;}finally{reader.releaseLock();}
    if(received!==row.size)throw new Error('Attachment download was incomplete.');
    const blob=new Blob(parts,{type:'application/octet-stream'});const bytes=await blob.arrayBuffer();assertCurrent(version,identity);const digest=await crypto.subtle.digest('SHA-256',bytes);assertCurrent(version,identity);
    const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');if(sha256!==row.sha256)throw new Error('Attachment verification failed.');
    const url=URL.createObjectURL(blob);try{const link=document.createElement('a');link.href=url;link.download=downloadFilename(response.headers.get('Content-Disposition'),row.name);link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
   }else{await apiJson(action==='reconcile'?`${itemPath}/reconcile`:itemPath,{method:action==='reconcile'?'POST':'DELETE'});assertCurrent(version,identity);await load();}
  }catch(cause){if(current(version,identity))setError(message(cause));}
  finally{lock.current=false;if(current(version,identity))setBusy(false);}
 };
 return <section aria-label="Issue attachments" className="space-y-2 min-w-0">
  <h3 className="text-sm font-medium">Attachments</h3>
  {rows===null&&!error&&<p role="status" className="text-sm text-muted-foreground">Loading attachments…</p>}
  {rows&&<ul className="space-y-2">{rows.filter(row=>row.phase!=='removed').map(row=><li key={row.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 break-all">{row.name}</span><span className="text-xs text-muted-foreground">{(row.size/1024).toFixed(1)} KB{row.phase==='pending'?' · Upload pending':''}</span>{row.phase==='verified'?<Button size="sm" variant="ghost" disabled={busy||!activeSessionIdentity} onClick={()=>void act(row,'download')}>Download</Button>:row.canReconcile?<Button size="sm" variant="ghost" disabled={busy||!activeSessionIdentity} onClick={()=>void act(row,'reconcile')}>Check upload</Button>:null}{row.canRemove&&<Button size="sm" variant="ghost" disabled={busy||!activeSessionIdentity} onClick={()=>void act(row,'remove')}>Remove</Button>}</li>)}</ul>}
  {activeSessionIdentity&&canUpload&&<div className="flex flex-wrap items-center gap-2"><label className="min-w-0 flex-1 text-sm"><span className="sr-only">Attach one file, up to 5 MB</span><Input ref={input} type="file" disabled={busy} onChange={event=>{const files=event.target.files;if(!files||files.length!==1){setSelected(null);return;}const file=files[0]!;if(file.size>maxSize){setError('Choose a file up to 5 MB.');event.target.value='';setSelected(null);return;}upload.current=null;setSelected(file);setError(null);}}/></label><Button size="sm" variant="outline" disabled={busy||!selected} onClick={()=>void attach()}>{busy?'Working…':upload.current?'Retry attachment':'Attach file'}</Button><span className="text-xs text-muted-foreground">Up to 5 MB</span></div>}
  {error&&<div role="alert" className="text-sm text-destructive">{error}{rows===null&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void load()}>Retry</Button>}</div>}
 </section>;
}
