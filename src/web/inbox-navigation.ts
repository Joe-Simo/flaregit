/** Discussion events carry a validated topic identity in their event type.
 * Other events retain repository scope; never infer identities from notification prose. */
export function inboxDestination(item:{project_id:string;type:string}):string{
 const thread=/^thread\.comment\.[a-f0-9-]{36}\.(issue|change|candidate)\.([a-z0-9_-]+)\.[1-9][0-9]{0,15}\.[1-9][0-9]{0,4}$/.exec(item.type);
 if(thread){const id=thread[2]!;if(thread[1]==='issue'&&/^[1-9][0-9]{0,6}$/.test(id))return `/p/${encodeURIComponent(item.project_id)}/issues?issue=${id}`;if(thread[1]==='change'&&/^[a-z0-9][a-z0-9-]{2,100}$/.test(id))return `/p/${encodeURIComponent(item.project_id)}/changes?task=${id}`;if(thread[1]==='candidate'&&/^[a-z0-9_-]{3,60}$/.test(id))return `/p/${encodeURIComponent(item.project_id)}/review?candidate=${id}`;}
 const discussion=/^discussion\.reply\.(public|members)\.(discussion_[a-f0-9-]{36})(?:\.discussion_[a-f0-9-]{36})?$/.exec(item.type);
 if(discussion)return discussion[1]==='members'?`/p/${encodeURIComponent(item.project_id)}/discussions?topic=${discussion[2]}`:`/community?repo=${encodeURIComponent(item.project_id)}&topic=${discussion[2]}`;
 const section=item.type.startsWith('issue.')?'issues':item.type.startsWith('review.')||item.type.startsWith('integration')||item.type.startsWith('stack')||item.type==='task.ready'?'changes':'activity';
 return `/p/${encodeURIComponent(item.project_id)}/${section}`;
}
export const INBOX_INTERACTIVE_TARGETS='input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"],[role="combobox"],[role="dialog"]';
export function inboxShortcutAllowed(modifiers:{metaKey:boolean;ctrlKey:boolean;altKey:boolean},interactive:boolean):boolean{return !interactive&&!modifiers.metaKey&&!modifiers.ctrlKey&&!modifiers.altKey;}
