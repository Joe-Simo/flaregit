import React, {useEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {apiJson} from '../api';
import type {PinnedSearchResult, PinnedBlameResult} from '../../server/pinned-code-inspection';

export function CodeInspection({projectId,commit,path,onOpen}:{projectId:string;commit:string;path?:string;onOpen:(path:string,line?:number)=>void}){
  const [query,setQuery]=useState(''),[searched,setSearched]=useState(''),[search,setSearch]=useState<PinnedSearchResult|null>(null),[blame,setBlame]=useState<PinnedBlameResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const sequence=useRef(0),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{sequence.current++;controller.current?.abort();},[]);
  const inspect=async(kind:'search'|'blame',cursor?:string)=>{
    const request=++sequence.current;controller.current?.abort();const lifetime=new AbortController();controller.current=lifetime;setBusy(true);setError('');
    try{
      const text=cursor?searched:query.trim();
      if(kind==='search'){
        const result=await apiJson<PinnedSearchResult>(`/p/${projectId}/code-search?ref=${commit}&q=${encodeURIComponent(text)}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(20000)])});
        if(request!==sequence.current)return;if(result.commit!==commit)throw Error('Search returned a different revision');setSearch(result);setSearched(text);
      }else{
        const result=await apiJson<PinnedBlameResult>(`/p/${projectId}/blame?ref=${commit}&path=${encodeURIComponent(path??'')}`,{signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(20000)])});
        if(request!==sequence.current)return;if(result.commit!==commit||result.path!==path)throw Error('Blame returned a different file revision');setBlame(result);
      }
    }catch(cause){if(request===sequence.current&&!lifetime.signal.aborted)setError(cause instanceof Error?cause.message:'Inspection unavailable');}
    finally{if(request===sequence.current)setBusy(false);}
  };
  return <section className="space-y-3" aria-label="Inspect code"><form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();void inspect('search');}}><Input aria-label="Search this revision" placeholder="Search this revision" className="min-w-0 flex-1 basis-48" maxLength={200} value={query} onChange={event=>setQuery(event.target.value)}/><Button size="sm" variant="outline" disabled={busy||!query.trim()}>Search code</Button>{path&&<Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void inspect('blame')}>Line blame</Button>}</form>{busy&&<p role="status" className="text-xs text-muted-foreground">Inspecting revision {commit.slice(0,7)}…</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{search&&<div className="space-y-2"><p className="text-xs text-muted-foreground">Literal text search for “{searched}” · {search.scannedFiles} files inspected{search.reason?` · ${search.reason}`:''}</p>{!search.matches.length&&<p className="text-sm">No matches in the inspected text files.</p>}<ul className="space-y-1">{search.matches.map(match=><li key={`${match.path}:${match.line}`}><button className="w-full text-left rounded px-2 py-2 hover:bg-muted/40" onClick={()=>onOpen(match.path,match.line)}><span className="text-xs break-all text-muted-foreground">{match.path}:{match.line}</span><code className="block text-xs truncate">{match.text}</code></button></li>)}</ul>{search.nextCursor&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void inspect('search',search.nextCursor!)}>Next matches</Button>}</div>}{blame&&<div className="space-y-2"><p className="text-xs text-muted-foreground">First-parent attribution across {blame.scannedCommits} commits. Only unique unchanged renames are followed.</p><div className="max-h-[60vh] overflow-auto" tabIndex={0} aria-label={`Line blame for ${path}`}><table className="w-full text-xs"><tbody>{blame.lines.map(line=><tr key={line.line}><td className="pr-3 py-1 whitespace-nowrap text-muted-foreground">{line.sha.slice(0,7)} · {line.author}</td><td className="pr-3 text-muted-foreground">{line.line}</td><td><code className="whitespace-pre">{line.text}</code></td></tr>)}</tbody></table></div><Button size="sm" variant="ghost" onClick={()=>setBlame(null)}>Hide blame</Button></div>}</section>;
}
