import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {apiJson} from '../api';
export function GitCredentialRevocation({projectId}:{projectId:string}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');const generation=useRef(0);
 useEffect(()=>{generation.current++;setBusy(false);setNotice('');setError('');return()=>{generation.current++;};},[projectId]);
 const revoke=async()=>{if(busy)return;const current=generation.current;setBusy(true);setNotice('');setError('');try{const result=await apiJson<{revoked:boolean}>(`/p/${projectId}/git-credentials`,{method:'DELETE',signal:AbortSignal.timeout(15000)});if(current!==generation.current)return;if(result.revoked!==true)throw Error('Unconfirmed');setNotice('Your Git credentials for this repository are revoked. Existing local Git commits remain available.');}catch{if(current===generation.current)setError('Revocation was not confirmed. Retry this same action; do not assume the credentials are disabled.');}finally{if(current===generation.current)setBusy(false);}};
 return <section aria-label="Git credential access" className="rounded-lg border border-border p-4 space-y-2"><h3 className="text-sm font-semibold">Your Git credentials</h3><p className="text-xs text-muted-foreground">Disable all Git clone and change credentials issued to your account for this repository. Create a new credential when you need Git access again.</p><Button size="sm" variant="outline" disabled={busy} onClick={()=>void revoke()}>{busy?'Revoking…':'Revoke my Git credentials'}</Button>{notice&&<p role="status" className="text-xs">{notice}</p>}{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}</section>;
}
