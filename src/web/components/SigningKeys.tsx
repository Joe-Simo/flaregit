import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@clerk/clerk-react';
import {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {apiJson,apiSessionIdentity} from '../api';

type KeyKind='ssh'|'gpg';
type RegisteredKey={id:string;label:string;publicText:string};
const sshKeys=z.object({keys:z.array(z.object({type:z.literal('ssh-ed25519'),blob:z.string().max(500),comment:z.string().max(131072)})).max(20)});
const gpgKeys=z.object({keys:z.array(z.object({fingerprint:z.string().regex(/^[A-F0-9]{40,64}$/),armored:z.string().max(20001)})).max(20)});
function registeredKeys(kind:KeyKind,value:unknown):RegisteredKey[]{
  return kind==='ssh'
    ? sshKeys.parse(value).keys.map(key=>({id:key.blob,label:key.comment.length>200?key.comment.slice(0,200)+'…':key.comment||'Ed25519 public key',publicText:`${key.type} ${key.blob}`}))
    : gpgKeys.parse(value).keys.map(key=>({id:key.fingerprint,label:'GPG public key',publicText:key.fingerprint}));
}
/** Public material only. The server remains the authority for key parsing. */
export function publicSigningKeyInput(kind:KeyKind,value:string):string{
  const key=value.trim();
  if(/PRIVATE KEY/i.test(key))throw Error('Paste only the public key. Private keys cannot be registered.');
  if(kind==='ssh'){
    if(key.length>500||!/^ssh-ed25519[ \t]+[A-Za-z0-9+/]+={0,2}(?:[ \t]+[^\s]{1,200})?$/.test(key))throw Error('Use one ssh-ed25519 public key line with an optional single-word comment.');
  }else if(key.length>20000||!key.startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----')||!key.endsWith('-----END PGP PUBLIC KEY BLOCK-----')){
    throw Error('Use an armored GPG public key block, up to 20,000 characters.');
  }
  return key;
}

function KeyRegistry({kind,principal,disabled}:{kind:KeyKind;principal:string;disabled:boolean}){
  const endpoint=kind==='ssh'?'/signing-keys':'/signing-keys/gpg';
  const [keys,setKeys]=useState<RegisteredKey[]|null>(null),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const controller=useRef<AbortController|null>(null),lock=useRef(false),activePrincipal=useRef(principal),blocked=useRef(disabled);
  activePrincipal.current=principal;blocked.current=disabled;
  const current=(operation:AbortController)=>controller.current===operation&&!operation.signal.aborted&&activePrincipal.current===principal&&apiSessionIdentity()===principal;
  const refresh=async(operation:AbortController)=>{
    if(!current(operation))throw Error('The signed-in session changed.');
    const value=await apiJson<unknown>(endpoint,{signal:AbortSignal.any([operation.signal,AbortSignal.timeout(15000)])});
    if(current(operation))setKeys(registeredKeys(kind,value));
  };
  useEffect(()=>{
    const operation=new AbortController();controller.current=operation;
    void refresh(operation).catch(cause=>{if(current(operation))setError(cause instanceof Error?cause.message:'Registered keys could not be loaded.');});
    return()=>{operation.abort();if(controller.current===operation)controller.current=null;};
  },[principal,kind]);
  const run=async(action:(operation:AbortController)=>Promise<void>)=>{
    const operation=controller.current;if(!operation||lock.current||blocked.current||!current(operation))return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try{await action(operation);}catch(cause){if(current(operation))setError(cause instanceof Error?cause.message:'The change was not confirmed. Reload registered keys before retrying.');}
    finally{if(current(operation)){lock.current=false;setBusy(false);}}
  };
  const add=()=>run(async operation=>{
    const key=publicSigningKeyInput(kind,draft);
    if(!current(operation)||blocked.current)return;
    const value=await apiJson<unknown>(endpoint,{method:'POST',json:{key},signal:AbortSignal.any([operation.signal,AbortSignal.timeout(15000)])});
    if(!current(operation))return;
    setKeys(registeredKeys(kind,value));setDraft('');setNotice('Public key registered.');
    window.dispatchEvent(new Event('flaregit:signing-keys-changed'));
  });
  const remove=(key:RegisteredKey)=>run(async operation=>{
    if(!current(operation)||blocked.current)return;
    const value=await apiJson<unknown>(endpoint,{method:'DELETE',json:kind==='ssh'?{blob:key.id}:{fingerprint:key.id},signal:AbortSignal.any([operation.signal,AbortSignal.timeout(15000)])});
    if(!current(operation))return;
    const remaining=registeredKeys(kind,value);if(remaining.some(item=>item.id===key.id))throw Error('Removal was not confirmed. Reload registered keys before retrying.');
    setKeys(remaining);setNotice('Public key removed.');
    window.dispatchEvent(new Event('flaregit:signing-keys-changed'));
  });
  const title=kind==='ssh'?'SSH':'GPG',inputId=`signing-${kind}`;
  return <section className="space-y-3 min-w-0" aria-label={`${title} signing keys`}>
    <h3 className="text-sm font-medium">{title}</h3>
    {keys===null&&!error&&<p role="status" className="text-xs text-muted-foreground">Loading registered keys…</p>}
    {keys?.length===0&&<p className="text-xs text-muted-foreground">No {title} public keys registered.</p>}
    {keys&&keys.length>0&&<ul className="space-y-3">{keys.map(key=><li key={key.id} className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="text-sm break-words">{key.label}</p><p className="font-mono text-xs text-muted-foreground break-all">{key.publicText}</p></div><Button size="sm" variant="outline" disabled={disabled||busy} aria-label={`Remove ${title} key ${key.id}`} onClick={()=>void remove(key)}>Remove</Button></li>)}</ul>}
    <div className="space-y-2"><Label htmlFor={inputId}>{title} public key</Label><Textarea id={inputId} rows={kind==='ssh'?3:5} className="font-mono text-xs" value={draft} maxLength={kind==='ssh'?500:20000} disabled={disabled||busy||keys===null} onChange={event=>setDraft(event.target.value)} placeholder={kind==='ssh'?'ssh-ed25519 AAAA… optional-comment':'-----BEGIN PGP PUBLIC KEY BLOCK-----'}/><div className="flex flex-wrap gap-2"><Button size="sm" disabled={disabled||busy||keys===null||!draft.trim()||keys.length>=20} onClick={()=>void add()}>{busy?'Saving…':'Add public key'}</Button><Button size="sm" variant="ghost" disabled={disabled||busy} onClick={()=>void run(refresh)}>Reload keys</Button></div></div>
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}{notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}
  </section>;
}

export function SigningKeys({disabled=false}:{disabled?:boolean}){
  const {isLoaded,isSignedIn,userId,sessionId}=useAuth();
  if(!isLoaded||!isSignedIn||!userId||!sessionId)return null;
  return <Card><CardHeader><CardTitle className="text-sm">Commit signing keys</CardTitle></CardHeader><CardContent className="space-y-5"><p className="text-xs text-muted-foreground">Register public keys to check commit signatures against your own key list. A matching signature does not verify an author’s identity.</p><KeyRegistry key={`ssh:${userId}:${sessionId}`} kind="ssh" principal={`${userId}:${sessionId}`} disabled={disabled}/><div className="border-t border-border pt-4"><KeyRegistry key={`gpg:${userId}:${sessionId}`} kind="gpg" principal={`${userId}:${sessionId}`} disabled={disabled}/></div></CardContent></Card>;
}
