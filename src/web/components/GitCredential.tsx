import {useState} from 'react';
import {Button} from '@/components/ui/button';
export function GitCredential({token}:{token:string}){
 const [revealed,setRevealed]=useState(false),[copied,setCopied]=useState(false),[error,setError]=useState(false);
 const copy=async()=>{
  setCopied(false);setError(false);
  try{await navigator.clipboard.writeText(token);setCopied(true);}
  catch{setError(true);}
 };
 return <section aria-label="Git credential" className="space-y-2 text-xs"><p>Git will ask for a username and password. Use <code>flaregit</code> as the username and this credential as the password. Use your system credential manager; do not paste the credential into a command or repository URL.</p><div className="flex flex-wrap items-center gap-2"><code className="break-all">{revealed?token:'Credential hidden'}</code><Button size="sm" variant="ghost" onClick={()=>setRevealed(value=>!value)}>{revealed?'Hide credential':'Reveal credential'}</Button><Button size="sm" variant="outline" onClick={()=>void copy()}>{copied?'Credential copied':'Copy credential'}</Button></div>{error&&<p role="alert">Credential could not be copied. Try again or reveal it privately.</p>}</section>;
}
