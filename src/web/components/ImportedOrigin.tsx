/** External authors remain source identities; this never links them to a native profile. */
export function ImportedOrigin({sourceUrl,login,createdAt}:{sourceUrl:string;login:string;createdAt:string}){
 let safe=false;try{const url=new URL(sourceUrl);safe=url.protocol==='https:'&&url.hostname==='github.com'&&!url.port&&!url.username&&!url.password&&!url.search&&/^\/[^/]+\/[^/]+\/(?:issues|pull)\/[1-9][0-9]*$/.test(url.pathname)&&(!url.hash||/^#issuecomment-[1-9][0-9]*$/.test(url.hash));}catch{/* Unknown origins render no external link. */}
 return <span className="text-xs text-muted-foreground break-words">Imported from GitHub · external author {login} (unclaimed){safe&&<> · <a className="underline underline-offset-4" href={sourceUrl} target="_blank" rel="noopener noreferrer">Original conversation</a></>}{Number.isFinite(Date.parse(createdAt))&&<> · <time dateTime={createdAt} title={createdAt}>{new Date(createdAt).toLocaleDateString()}</time></>}</span>;
}
