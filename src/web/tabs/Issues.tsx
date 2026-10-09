import {issueTransferPendingSchema,type IssueTransferPendingRecovery} from '../issue-transfer-intent';
import {IssueTransferMappingPanel} from '../components/IssueTransferMapping';
import {IssueTransfer} from '../components/IssueTransfer';
import {Dialog,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {z} from 'zod';
import {IssueFilters} from '../components/IssueFilters';
import type {IssueFilterCriteria} from '../../server/issue-feature-store';
import {IssueAttachments} from '../components/IssueAttachments';
import {IssueBulkControls} from '../components/IssueBulkControls';
import {Checkbox} from '@/components/ui/checkbox';
import {IssueTemplatePicker} from '../components/IssueTemplatePicker';
import {IssuePlanning} from '../components/IssuePlanning';
import {ImportedOrigin} from "../components/ImportedOrigin";
import type {ImportedConversationOrigin} from "../../server/migration-conversation-publication";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleDot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ApiError, apiFetch, apiJson, apiSessionIdentity } from "../api";
import {readIssueDraft,saveIssueDraft,clearIssueDraft,type IssueDraftScope} from "../issue-draft-recovery";
import {recoverIssueChange,persistIssueChange,type IssueChangeIntent} from "../issue-change-recovery";
import { navigate, timeAgo } from "../router";
import { changeCreationFollowup, type ChangeCreationResponse } from "../change-creation-followup";
import { Conversation } from "../components/Conversation";

interface Issue { discussionOrigin?:{discussionId:string;scope:'public'|'members';author:string;createdAt:string;convertedBy:string}; number: number; title: string; body: string; state: "open" | "closed"; author: string; created_at: string; updated_at: string; closed_by: string | null; comments: number; importedOrigin?:ImportedConversationOrigin|null }
interface IssueDetail extends Omit<Issue, "comments"> { stateRevision:number;canStateWrite?:boolean;canDeleteIssue?:boolean;transferPending?:boolean;pendingTransfer?:IssueTransferPendingRecovery;canMapTransferContext?:boolean;transferContext?:unknown; linked: Array<{ id: string; goal: string; status: string }> }
const stateChangeSchema=z.object({state:z.enum(['open','closed']),expectedRevision:z.number().int().nonnegative().safe(),requestId:z.uuid()}).strict();
type StateChangeIntent=z.infer<typeof stateChangeSchema>;
type StateChangeReceipt={issue:{number:number;state:'open'|'closed';stateRevision:number;updated_at:string;closed_by:string|null};requestId:string;replayed:boolean;changedSince:boolean;originalState:'open'|'closed';originalRevision:number};
const stateChangeKey=(identity:string,projectId:string,number:number)=>`flaregit.issue-draft.${JSON.stringify([identity,projectId,number,'state'])}`;
const deleteIssueSchema=z.object({expectedRevision:z.number().int().nonnegative().safe(),requestId:z.uuid(),confirmed:z.literal(true)}).strict();
type DeleteIssueIntent=z.infer<typeof deleteIssueSchema>;
const deleteIssueKey=(identity:string,projectId:string,number:number)=>`flaregit.issue-draft.${JSON.stringify([identity,projectId,number,'delete'])}`;
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";
const okCls = "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "issue";

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className={`${alertCls} flex flex-wrap items-center justify-between gap-2`}>
      <span className="break-words min-w-0">{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function IssuesTab({ projectId, issue }: { projectId: string; issue?: number }) {
  return issue ? <IssueView key={`${projectId}:${issue}`} projectId={projectId} number={issue} /> : <IssueList key={projectId} projectId={projectId} />;
}

function IssueList({ projectId }: { projectId: string }) {
  const [selected,setSelected]=useState<number[]>([]);
  const [state, setState] = useState<IssueFilterCriteria["state"]>("open");
  const [issues, setIssues] = useState<Omit<Issue,"body">[] | null>(null);
  const [criteria,setCriteria]=useState<Omit<IssueFilterCriteria,'state'>>({q:'',sort:'updated-desc'}),[cursor,setCursor]=useState<string|null>(null);
  type Page={nextCursor:string|null;version:string;complete:boolean;total:number;offset:number;limit:number;inspectedIssues:number;facets:{labels:string[];assignees:string[];milestones:Array<{id:number;title:string}>};members:Array<{user_id:string;label:string}>};
  const [page,setPage]=useState<Page|null>(null),[issuesIdentity,setIssuesIdentity]=useState<string|null>(null),identity=apiSessionIdentity();
  const filterPrincipal=useRef(identity);
  const applyFilter=(next:IssueFilterCriteria)=>{const {state:nextState,...filter}=next;setState(nextState);setCriteria(filter);setCursor(null);};
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const intent = useRef<{signature:string; key:string} | null>(null), savingLock = useRef(false);
  const recoveryScope=useRef<IssueDraftScope|null>(null);
  useEffect(()=>{const identity=apiSessionIdentity();recoveryScope.current=identity?{identity,projectId}:null;const scope=recoveryScope.current;if(!scope)return;try{const draft=readIssueDraft(sessionStorage,scope);if(draft){setTitle(draft.title);setBody(draft.body);intent.current=draft.intent;setComposing(true);}}catch{/* Draft restoration never grants write authority. */}},[projectId]);
  const persist=(nextTitle:string,nextBody:string,nextIntent:typeof intent.current)=>{const scope=recoveryScope.current;if(!scope||apiSessionIdentity()!==scope.identity)return false;try{return saveIssueDraft(sessionStorage,scope,{title:nextTitle,body:nextBody,intent:nextIntent});}catch{return false;}};
  const editDraft=(nextTitle:string,nextBody:string)=>{setTitle(nextTitle);setBody(nextBody);const signature=JSON.stringify({title:nextTitle.trim(),body:nextBody.trim()});if(intent.current?.signature!==signature)intent.current=null;if(!persist(nextTitle,nextBody,intent.current))setError("Your draft remains on this page, but browser recovery is unavailable. Saving requires a recoverable request.");else setError(null);};
  const discard=()=>{if(savingLock.current)return;const scope=recoveryScope.current;if(!scope||apiSessionIdentity()!==scope.identity)return;try{if(!clearIssueDraft(sessionStorage,scope)){setError("The browser draft could not be discarded. Your text is preserved.");return;}}catch{setError("The browser draft could not be discarded. Your text is preserved.");return;}intent.current=null;setTitle("");setBody("");setError(null);setComposing(false);};
  const lifetime = useRef(0), readSequence = useRef(0), readController = useRef<AbortController | null>(null);
  useEffect(() => { lifetime.current++; return () => { lifetime.current++; readSequence.current++; readController.current?.abort(); }; }, [projectId]);

  const load = useCallback(async () => {
    const generation=lifetime.current, sequence=++readSequence.current; readController.current?.abort(); const controller=new AbortController();readController.current=controller;
    setIssues(null);setPage(null);setSelected([]);
    setLoadError(null);
    if(filterPrincipal.current!==identity){filterPrincipal.current=identity;setState('open');setCriteria({q:'',sort:'updated-desc'});setCursor(null);return;}
    try {
      const query=new URLSearchParams();for(const [key,value] of Object.entries({...criteria,state,...(cursor?{cursor}:{})}))if(value!==undefined)query.set(key,String(value));
      const result=await apiJson<Page&{issues:Omit<Issue,'body'>[]}>(`/p/${projectId}/issues/query?${query}`,{signal:controller.signal});
      if(generation===lifetime.current&&sequence===readSequence.current&&identity===apiSessionIdentity()){const {issues:rows,...details}=result;setIssues(rows);setPage(details);setIssuesIdentity(identity);}
    } catch (e) {
      if(generation===lifetime.current && sequence===readSequence.current && !controller.signal.aborted)setLoadError(errText(e, "Could not load issues"));
    }
  }, [projectId,state,criteria,cursor,identity]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if(savingLock.current || !title.trim())return;
    const generation=lifetime.current; const input={title:title.trim(),body:body.trim()};const signature=JSON.stringify(input);
    if(intent.current?.signature!==signature)intent.current={signature,key:crypto.randomUUID()};
    if(!persist(title,body,intent.current)){setError("Browser recovery is unavailable. No issue request was sent; keep your draft and retry when storage is available.");return;}
    const idempotencyKey=intent.current.key;savingLock.current=true;
    setError(null);
    setSaving(true);
    try {
      const created = await apiJson<Issue>(`/p/${projectId}/issues`, { method: "POST", json: { ...input, idempotencyKey } });
      if(generation!==lifetime.current)return;
      const scope=recoveryScope.current;if(scope&&apiSessionIdentity()===scope.identity)try{clearIssueDraft(sessionStorage,scope);}catch{/* Confirmed save and original key remain safe to replay. */}
      intent.current=null;navigate(`/p/${projectId}/issues?n=${created.number}`);
    } catch (e) {
      if(generation===lifetime.current)setError(`Issue save could not be confirmed. Your draft is preserved; retrying unchanged content reuses the same request. ${errText(e, "")}`);
    } finally { savingLock.current=false;if(generation===lifetime.current)setSaving(false);
    }
  };

  return (
    <Tabs value={state} onValueChange={value => { if(value === "open" || value === "closed"||value === "all"){setState(value);setCursor(null);} }} className="space-y-3 min-w-0">
      <h2 className="sr-only">Issues</h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList aria-label="Issue state">
          {(["open", "closed","all"] as const).map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize">{s}</TabsTrigger>
          ))}
        </TabsList>
        <Button size="sm" variant="orange" disabled={saving} aria-expanded={composing} aria-controls="new-issue" onClick={() => setComposing((v) => !v)}><Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden /> New issue</Button>
      </div>
      <IssueFilters projectId={projectId} criteria={{...criteria,state}} facets={issuesIdentity===identity?page?.facets:undefined} members={issuesIdentity===identity?page?.members:undefined} onApply={applyFilter}/>
      {composing && (
        <form id="new-issue" className="rounded-lg border border-border p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (title.trim() && !saving) void create(); }}>
          <h3 className="text-sm font-semibold">New issue</h3>
          <label className="block text-sm"><span className="font-medium">Title</span>
            <Input className={field} value={title} disabled={saving} maxLength={200} onChange={(e) => editDraft(e.target.value,body)} />
          </label>
          <IssueTemplatePicker projectId={projectId} disabled={saving} onApply={nextBody=>editDraft(title,nextBody)}/>
          <label className="block text-sm"><span className="font-medium">Description</span>
            <Textarea className={field} rows={5} maxLength={20000} disabled={saving} value={body} onChange={(e) => editDraft(title,e.target.value)} placeholder="What should change, and why? Agents working on a linked change read this." />
          </label>
          {error && <div role="alert" className={alertCls}>{error}</div>}
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={saving || !title.trim()}>{saving ? "Opening…" : "Open issue"}</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={discard}>Discard draft</Button></div>
        </form>
      )}
      <TabsContent value={state}>
      {selected.length>0&&issuesIdentity===identity&&<IssueBulkControls key={`${projectId}:${state}`} projectId={projectId} numbers={selected} onSaved={()=>{setSelected([]);void load();}}/>}
      {loadError && <LoadError message={loadError} onRetry={()=>{if(cursor)setCursor(null);else void load();}} />}
      {!issues && !loadError && <p role="status" className="text-sm text-muted-foreground">Loading issues…</p>}
      {issues&&issuesIdentity===identity && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {issues.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No {state} issues.</li>}
          {issues.map((i) => (
            <li key={i.number}>
              <div className="flex items-start"><Checkbox className="m-3 shrink-0" aria-label={`Select issue ${i.number}`} checked={selected.includes(i.number)} disabled={!selected.includes(i.number)&&selected.length>=100} onCheckedChange={checked=>setSelected(previous=>checked===true?[...previous,i.number]:previous.filter(n=>n!==i.number))}/>
              <Button variant="ghost" className="h-auto w-full rounded-none text-left whitespace-normal px-3 py-2 items-start justify-start gap-2 hover:bg-muted/40" onClick={() => navigate(`/p/${projectId}/issues?n=${i.number}`)}>
                {i.state === "open" ? <CircleDot className="h-4 w-4 mt-0.5 text-emerald-400 shrink-0" aria-label="open" /> : <CircleCheck className="h-4 w-4 mt-0.5 text-purple-400 shrink-0" aria-label="closed" />}
                <span className="min-w-0">
                  <span className="block text-sm font-medium break-words">{i.title}</span>
                  <span className="block text-xs text-muted-foreground">#{i.number}{!i.importedOrigin&&<> by {i.author}</>} · updated {timeAgo(i.updated_at)}{i.comments ? ` · ${i.comments} comment${i.comments === 1 ? "" : "s"}` : ""}</span>
                </span>
              </Button>
              </div>
              {i.importedOrigin&&<div className="px-3 pb-2"><ImportedOrigin sourceUrl={i.importedOrigin.sourceUrl} login={i.importedOrigin.login} createdAt={i.importedOrigin.createdAt}/></div>}
            </li>
          ))}
        </ul>
      )}
      {page&&issuesIdentity===identity&&<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{page.total===0?'No matching issues':`${page.offset+1}–${page.offset+(issues?.length??0)} of ${page.total} matching issues`}</span><div className="flex gap-2">{cursor&&<Button size="sm" variant="ghost" onClick={()=>setCursor(null)}>First page</Button>}{page.nextCursor&&<Button size="sm" variant="outline" onClick={()=>setCursor(page.nextCursor)}>Next page</Button>}</div></div>}
      </TabsContent>
    </Tabs>
  );
}

function IssueView({ projectId, number }: { projectId: string; number: number }) {
  const activeIdentity=apiSessionIdentity();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "toggle" | "change" | "agent" | "delete">(null);
  const [transferLocked,setTransferLocked]=useState(false),[transferred,setTransferred]=useState(false),[transferDestination,setTransferDestination]=useState<{projectId:string;number:number}|null>(null),[tombstoneRecovery,setTombstoneRecovery]=useState<IssueTransferPendingRecovery|undefined>(undefined);const transferLock=useRef(false);

  const lifetime=useRef(0), readSequence=useRef(0), readController=useRef<AbortController | null>(null), actionLock=useRef(false);
  const [deleteIntent,setDeleteIntent]=useState<DeleteIssueIntent|null>(null),[deleteDialog,setDeleteDialog]=useState(false),[removedIdentity,setRemovedIdentity]=useState<string|null>(null);
  const deleteIntentRef=useRef<{identity:string;intent:DeleteIssueIntent}|null>(null);
  const [stateIntent,setStateIntent]=useState<StateChangeIntent|null>(null);
  const stateIntentRef=useRef<{identity:string;intent:StateChangeIntent}|null>(null),detailIdentity=useRef<string|null>(null);
  const creationIntent=useRef<{identity:string;projectId:string;issue:number;payload:IssueChangeIntent} | null>(null);
  const [savedChange,setSavedChange]=useState<string | null>(null);
  const [originalChange,setOriginalChange]=useState<IssueChangeIntent|null>(null);
  useEffect(()=>{lifetime.current++;return()=>{lifetime.current++;readSequence.current++;readController.current?.abort();};},[projectId,number]);
  const load = useCallback(async () => {
    const identity=apiSessionIdentity();
    const generation=lifetime.current,sequence=++readSequence.current;readController.current?.abort();const controller=new AbortController();readController.current=controller;
    setLoadError(null);setTransferDestination(null);setTombstoneRecovery(undefined);
    if(identity)try{const raw=sessionStorage.getItem(deleteIssueKey(identity,projectId,number));if(raw&&raw.length>1000)throw Error();const saved=raw?deleteIssueSchema.parse(JSON.parse(raw)):null;deleteIntentRef.current=saved?{identity,intent:saved}:null;setDeleteIntent(saved);}catch{setError('Saved issue removal could not be read. Restore browser storage before continuing.');}
    else{deleteIntentRef.current=null;setDeleteIntent(null);}
    try {
      const response=await apiFetch(`/api/p/${projectId}/issues/${number}`,{signal:controller.signal,redirect:'error'});
      if(response.status===410){
        if(generation!==lifetime.current||sequence!==readSequence.current||apiSessionIdentity()!==identity)return;
        detailIdentity.current=null;setIssue(null);setRemovedIdentity(identity);setTransferDestination(null);setTransferred(false);
        let raw:unknown;try{raw=await response.json();}catch{return;}
        if(generation!==lifetime.current||sequence!==readSequence.current||apiSessionIdentity()!==identity)return;
        const tombstone=z.object({number:z.literal(number),deleted:z.literal(true),transferred:z.literal(true).optional(),pendingTransfer:issueTransferPendingSchema.optional(),transfer:z.object({projectId:z.string().regex(/^[a-z0-9]{12,16}$/),number:z.number().int().positive().max(9999999)}).optional()}).safeParse(raw);
        if(tombstone.success&&tombstone.data.transferred){setTransferred(true);setTombstoneRecovery(tombstone.data.pendingTransfer);if(tombstone.data.transfer&&tombstone.data.transfer.projectId!==projectId)setTransferDestination(tombstone.data.transfer);}return;
      }
      if(!response.ok)throw new ApiError('Issue is unavailable',response.status,null);
      const next=await response.json() as IssueDetail;
      if(generation===lifetime.current && sequence===readSequence.current&&apiSessionIdentity()===identity){
        detailIdentity.current=identity;setRemovedIdentity(null);setIssue(next);setSavedChange(null);setOriginalChange(null);
        if(identity)try{const raw=sessionStorage.getItem(stateChangeKey(identity,projectId,number));if(raw&&raw.length>1000)throw Error('Saved status change is invalid.');const saved=raw?stateChangeSchema.parse(JSON.parse(raw)):null;stateIntentRef.current=saved?{identity,intent:saved}:null;setStateIntent(saved);}catch{setError('Your saved status change could not be read. Restore browser storage before changing this issue.');}
        else{stateIntentRef.current=null;setStateIntent(null);}
        if(identity)try{
          const scope={identity,projectId,issue:number},saved=recoverIssueChange(sessionStorage,scope);
          if(saved){creationIntent.current={...scope,payload:saved};setSavedChange(saved.taskId);setOriginalChange(saved);}
        }catch{/* Recovery errors must not block reading the issue. Dispatch validates again. */}
      }
    } catch (e) {
      if(generation===lifetime.current && sequence===readSequence.current && apiSessionIdentity()===identity && !controller.signal.aborted){if(e instanceof ApiError&&[401,403,404,410].includes(e.status)){detailIdentity.current=null;setIssue(null);if(e.status===410)setRemovedIdentity(identity);else{setRemovedIdentity(null);setTransferred(false);setTransferDestination(null);setTombstoneRecovery(undefined);}}setLoadError(errText(e, "Could not load the issue"));}
    }
  }, [projectId, number]);
  useEffect(() => { detailIdentity.current=null;setIssue(null);setRemovedIdentity(null);setTransferred(false);setTransferDestination(null);setDeleteDialog(false);void load(); }, [load,activeIdentity]);

  const discardStateIntent=()=>{
    const identity=apiSessionIdentity();if(actionLock.current||!identity||detailIdentity.current!==identity)return;
    try{const key=stateChangeKey(identity,projectId,number);sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null)throw Error();stateIntentRef.current=null;setStateIntent(null);setError(null);setNotice('Saved status change cleared.');detailIdentity.current=null;void load();}catch{setError('The saved status change could not be cleared.');}
  };
  const toggle = async () => {
    const identity=apiSessionIdentity();if(!issue||actionLock.current||!identity||detailIdentity.current!==identity||issue.canStateWrite===false||issue.transferPending||transferLock.current||deleteIntentRef.current!==null)return;
    const generation=lifetime.current;const current=()=>generation===lifetime.current&&apiSessionIdentity()===identity;
    try{
      let original=stateIntentRef.current;if(original&&original.identity!==identity)return;
      if(!original){const raw=sessionStorage.getItem(stateChangeKey(identity,projectId,number));if(raw&&raw.length>1000)throw Error('Saved status change is invalid.');const intent=raw?stateChangeSchema.parse(JSON.parse(raw)):stateChangeSchema.parse({state:issue.state==='open'?'closed':'open',expectedRevision:issue.stateRevision,requestId:crypto.randomUUID()});original={identity,intent};stateIntentRef.current=original;setStateIntent(intent);}
      const serialized=JSON.stringify(original.intent),key=stateChangeKey(identity,projectId,number);sessionStorage.setItem(key,serialized);if(sessionStorage.getItem(key)!==serialized)throw Error('Browser recovery is unavailable.');
    }catch(cause){setError(`No status change was sent. ${errText(cause,'Restore browser storage before retrying.')}`);return;}
    const savedIntent=stateIntentRef.current;if(!savedIntent||savedIntent.identity!==identity)return;const intent=savedIntent.intent;actionLock.current=true;setBusy('toggle');setError(null);setNotice(null);
    try{
      const receipt=await apiJson<StateChangeReceipt>(`/p/${projectId}/issues/${number}`,{method:'PATCH',json:intent});if(!current())return;
      if(receipt.requestId!==intent.requestId)throw Error('The original status change could not be confirmed.');
      setNotice(receipt.changedSince?'Your original status change was saved. The issue changed again afterward; its current status is shown below.':intent.state==='closed'?'Issue closed.':'Issue reopened.');
      const key=stateChangeKey(identity,projectId,number);sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null)throw Error('Saved status change remains available to check again.');stateIntentRef.current=null;setStateIntent(null);await load();
    }catch(cause){if(current())setError(`Status change could not be confirmed. Retry the saved change or refresh before choosing a new status. ${errText(cause,'')}`);}
    finally{actionLock.current=false;if(current())setBusy(null);}
  };
  const clearRemoval=()=>{const identity=apiSessionIdentity();if(actionLock.current||!identity||deleteIntentRef.current?.identity!==identity)return;try{const key=deleteIssueKey(identity,projectId,number);sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null)throw Error();deleteIntentRef.current=null;setDeleteIntent(null);detailIdentity.current=null;setIssue(null);setError(null);void load();}catch{setError('Saved removal could not be cleared.');}};
  const removeIssue=async()=>{
    const identity=apiSessionIdentity();if(actionLock.current||!identity||transferLock.current||issue?.transferPending||stateIntentRef.current||(!deleteIntentRef.current&&(!issue?.canDeleteIssue||detailIdentity.current!==identity)))return;
    const generation=lifetime.current,current=()=>generation===lifetime.current&&apiSessionIdentity()===identity;
    try{
      if(sessionStorage.getItem(stateChangeKey(identity,projectId,number)))throw Error('Clear the saved status change and refresh before removing this issue.');
      let original=deleteIntentRef.current;if(original&&original.identity!==identity)return;
      if(!original){if(!issue)return;const raw=sessionStorage.getItem(deleteIssueKey(identity,projectId,number));if(raw&&raw.length>1000)throw Error('Saved issue removal is invalid.');original={identity,intent:raw?deleteIssueSchema.parse(JSON.parse(raw)):deleteIssueSchema.parse({expectedRevision:issue.stateRevision,requestId:crypto.randomUUID(),confirmed:true})};deleteIntentRef.current=original;setDeleteIntent(original.intent);}
      const key=deleteIssueKey(identity,projectId,number),serialized=JSON.stringify(original.intent);sessionStorage.setItem(key,serialized);if(sessionStorage.getItem(key)!==serialized)throw Error('Browser recovery is unavailable.');
    }catch(cause){setError(`No removal was sent. ${errText(cause,'Restore browser storage before retrying.')}`);return;}
    const original=deleteIntentRef.current;if(!original||original.identity!==identity)return;actionLock.current=true;setBusy('delete');setError(null);setDeleteDialog(false);
    try{const receipt=await apiJson<{number:number;deleted:true;requestId:string;replayed:boolean}>(`/p/${projectId}/issues/${number}`,{method:'DELETE',json:original.intent});if(!current())return;if(receipt.number!==number||receipt.deleted!==true||receipt.requestId!==original.intent.requestId)throw Error('The original removal could not be confirmed.');detailIdentity.current=null;setIssue(null);setRemovedIdentity(identity);setLoadError(null);const key=deleteIssueKey(identity,projectId,number);sessionStorage.removeItem(key);if(sessionStorage.getItem(key)===null){deleteIntentRef.current=null;setDeleteIntent(null);}}
    catch(cause){if(current())setError(`Removal could not be confirmed. Retry the original removal. ${errText(cause,'')}`);}
    finally{actionLock.current=false;if(current())setBusy(null);}
  };
  const startChange = async (agent: boolean) => {
    if (!issue || actionLock.current || deleteIntentRef.current||transferLock.current||issue.transferPending) return;
    actionLock.current=true;const generation=lifetime.current;
    setBusy(agent ? "agent" : "change");
    setError(null);
    setNotice(null);
    try {
      const identity=apiSessionIdentity();
      if(!identity)throw new Error("Sign in again before starting a change.");
      const scope={identity,projectId,issue:number};
      let payload:IssueChangeIntent;
      try {
        const recovered=recoverIssueChange(sessionStorage,scope);
        const held=creationIntent.current;
        payload=recovered??(held&&held.identity===identity&&held.projectId===projectId&&held.issue===number?held.payload:{taskId:slug(issue.title)+"-"+crypto.randomUUID().replaceAll("-","").slice(0,12),goal:issue.title,issue:number});
        persistIssueChange(sessionStorage,scope,payload);
        creationIntent.current={...scope,payload};setOriginalChange(payload);setSavedChange(payload.taskId);
      } catch(cause) {throw new Error(`No change request was sent. Browser recovery must be available. ${errText(cause,"")}`);}
      if(apiSessionIdentity()!==identity||generation!==lifetime.current)throw new Error("Your session changed. No change request was sent.");
      const taskId=payload.taskId;
      const created=await apiJson<ChangeCreationResponse>(`/p/${projectId}/tasks`,{method:"POST",json:payload});
      if(generation!==lifetime.current||apiSessionIdentity()!==identity)return;
      // Keep the original request through agent startup and reload. Replaying it
      // asks the server for the same task instead of creating a second task.
      const followup=changeCreationFollowup(created,agent);setSavedChange(taskId);
      if(followup==="terminal")setNotice(`Change already ${created.status}. Its saved history is preserved; no agent was started.`);
      else if(followup==="existing-agent")setNotice("Change saved. Its existing agent run and checkpoints are available; no new run was started.");
      else if(followup==="start-agent"){
        try { if(apiSessionIdentity()!==identity)return;await apiJson(`/p/${projectId}/tasks/${taskId}/agent`,{method:"POST"});if(generation!==lifetime.current||apiSessionIdentity()!==identity)return;setNotice("Change saved and agent run requested. Open Changes to inspect its saved progress."); }
        catch(cause){if(generation!==lifetime.current||apiSessionIdentity()!==identity)return;setError(`Change saved, but agent startup could not be confirmed. Retry this request to inspect the same change, or open Changes for recovery. ${errText(cause,"")}`);}
      } else setNotice("Change saved. Open Changes for its Git commands, checkpoints and review.");
      await load();
    } catch (e) {
      if(generation===lifetime.current)setError(`Change save could not be confirmed. Retrying reuses the original saved request and issue purpose. ${errText(e,"")}`);
    } finally { actionLock.current=false;if(generation===lifetime.current)setBusy(null); }
  };

  if(removedIdentity&&removedIdentity===activeIdentity)return <div className="space-y-3"><h2 className="text-lg font-semibold">{transferred?"Issue transferred":"Issue removed"}</h2>{transferDestination&&<a className="text-sm font-medium hover:underline" href={`#/p/${transferDestination.projectId}/issues?n=${transferDestination.number}`}>Open transferred issue</a>}<IssueTransfer projectId={projectId} number={number} canTransfer={false} pendingTransfer={tombstoneRecovery} onLock={value=>{transferLock.current=value;setTransferLocked(value);}} onChanged={()=>void load()}/><Button size="sm" variant="ghost" onClick={()=>navigate(`/p/${projectId}/issues`)}>All issues</Button>{deleteIntent&&<Button size="sm" variant="outline" disabled={busy!==null} onClick={()=>void removeIssue()}>Retry original removal</Button>}{error&&<p role="alert" className={alertCls}>{error}</p>}</div>;
  if (loadError && !issue) return <LoadError message={loadError} onRetry={() => void load()} />;
  if (!issue||detailIdentity.current!==activeIdentity) return loadError?<LoadError message={loadError} onRetry={()=>void load()}/>:<p role="status" className="text-sm text-muted-foreground">Loading issue…</p>;
  return (
    <div className="space-y-4 max-w-3xl min-w-0">
      <Button size="sm" variant="link" className="h-auto p-0 justify-start text-muted-foreground" onClick={() => navigate(`/p/${projectId}/issues`)}>← All issues</Button>
      <div>
        <h2 className="text-lg font-semibold break-words">{issue.title} <span className="text-muted-foreground font-normal">#{issue.number}</span></h2>
        <div className="text-xs text-muted-foreground">
          <Badge variant={issue.state === "open" ? "success" : "purple"}>{issue.state}</Badge> {issue.importedOrigin?<ImportedOrigin sourceUrl={issue.importedOrigin.sourceUrl} login={issue.importedOrigin.login} createdAt={issue.importedOrigin.createdAt}/>:<>opened by {issue.author} {timeAgo(issue.created_at)}</>}
          {issue.discussionOrigin&&<p className="mt-2 text-xs text-muted-foreground">Converted by {issue.discussionOrigin.convertedBy} from a {issue.discussionOrigin.scope==='members'?'member':'public'} discussion. <a className="underline" href={issue.discussionOrigin.scope==='members'?`/#/p/${projectId}/discussions?topic=${encodeURIComponent(issue.discussionOrigin.discussionId)}`:`/#/community?repo=${encodeURIComponent(projectId)}&topic=${encodeURIComponent(issue.discussionOrigin.discussionId)}`}>View original discussion</a></p>}
          {issue.closed_by && issue.state === "closed" ? ` · closed by ${issue.closed_by}` : ""}
        </div>
      </div>
      {issue.body && <p className="text-sm whitespace-pre-wrap break-words rounded-md border border-border p-3">{issue.body}</p>}
      {loadError && <LoadError message={loadError} onRetry={()=>void load()} />}
      {originalChange && <p role="status" className="text-sm break-words">Saved request for issue #{originalChange.issue}: <code>{originalChange.taskId}</code> · {originalChange.goal}. Checking reuses this original purpose.</p>}
      {savedChange && <Button size="sm" variant="outline" onClick={()=>navigate(`/p/${projectId}/changes`)}>Open saved change</Button>}
      {error && <div role="alert" className={alertCls}>{error}</div>}
      {notice && <div role="status" className={okCls}>{notice}</div>}
      <div className="flex flex-wrap gap-2">
        {issue.state === "open" && <Button size="sm" variant="orange" disabled={busy !== null||transferLocked||issue.transferPending||deleteIntent!==null} onClick={() => void startChange(false)}>{busy === "change" ? "Checking…" : savedChange ? "Check saved change" : "Start a change"}</Button>}
        {issue.state === "open" && <Button size="sm" variant="outline" disabled={busy !== null||transferLocked||issue.transferPending||deleteIntent!==null} onClick={() => void startChange(true)}>{busy === "agent" ? "Checking…" : savedChange ? "Check or request agent" : "Ask an agent"}</Button>}
        <Button size="sm" variant="ghost" disabled={busy !== null||transferLocked||issue.transferPending||deleteIntent!==null||issue.canStateWrite===false||!apiSessionIdentity()} onClick={() => void toggle()}>{busy === "toggle" ? 'Saving…' : stateIntent ? 'Retry original status change' : issue.state === "open" ? "Close issue" : "Reopen"}</Button>
        {stateIntent&&<><Button size="sm" variant="ghost" disabled={busy!==null} onClick={()=>void load()}>Refresh issue</Button><Button size="sm" variant="ghost" disabled={busy!==null} onClick={discardStateIntent}>Clear saved status change</Button></>}
      </div>
      {(issue.canDeleteIssue||deleteIntent)&&<div className="flex flex-wrap gap-2"><Button size="sm" variant="destructive" disabled={busy!==null||transferLocked||issue.transferPending||stateIntent!==null} onClick={()=>deleteIntent?void removeIssue():setDeleteDialog(true)}>{busy==='delete'?'Removing…':deleteIntent?'Retry original removal':'Remove issue'}</Button>{deleteIntent&&<><Button size="sm" variant="ghost" disabled={busy!==null} onClick={()=>void load()}>Refresh issue</Button><Button size="sm" variant="ghost" disabled={busy!==null} onClick={clearRemoval}>Clear saved removal</Button></>}</div>}
      <Dialog open={deleteDialog} onOpenChange={open=>{if(busy===null)setDeleteDialog(open);}}><DialogHeader><DialogTitle>Remove issue #{number}?</DialogTitle><DialogDescription>This removes the issue from active workflows. Its audit history is retained.</DialogDescription></DialogHeader><DialogFooter><Button size="sm" variant="ghost" disabled={busy!==null} onClick={()=>setDeleteDialog(false)}>Cancel</Button><Button size="sm" variant="destructive" disabled={busy!==null||transferLocked||issue.transferPending||stateIntent!==null} onClick={()=>void removeIssue()}>Remove issue</Button></DialogFooter></Dialog>
      {issue.linked.length > 0 && (
        <div className="text-sm">
          <h3 className="font-semibold mb-1">Changes for this issue</h3>
          <ul className="space-y-1">{issue.linked.map((t) => <li key={t.id} className="break-words"><Button size="sm" variant="link" className="h-auto max-w-full p-0 text-left whitespace-normal" onClick={() => navigate(`/p/${projectId}/review?task=${t.id}`)}>{t.goal}</Button> <span className="text-xs text-muted-foreground">{t.status}</span></li>)}</ul>
        </div>
      )}
      <IssueTransferMappingPanel projectId={projectId} number={number} canMap={issue.canMapTransferContext===true} sourceContext={issue.transferContext} disabled={busy!==null||transferLocked||issue.transferPending===true} onChanged={()=>void load()}/>
      <IssueTransfer projectId={projectId} number={number} pendingTransfer={issue.pendingTransfer} canTransfer={issue.canDeleteIssue===true&&!issue.transferPending} disabled={busy!==null||stateIntent!==null||deleteIntent!==null} onLock={value=>{transferLock.current=value;setTransferLocked(value);}} onChanged={()=>void load()}/>
      {issue.transferPending&&!transferLocked&&<p role="status" className="text-sm text-muted-foreground">This issue is being transferred. Changes are paused until the transfer completes.</p>}
      <fieldset disabled={transferLocked||issue.transferPending} className="space-y-5 min-w-0">
      <IssuePlanning key={`${projectId}:${number}`} projectId={projectId} number={number}/>
      <IssueAttachments key={`${projectId}:attachments:${number}`} projectId={projectId} number={number}/>
      <Conversation key={`${projectId}:issue:${number}`} projectId={projectId} subject={`issue:${number}`} title="Conversation" />
      </fieldset>
    </div>
  );
}
