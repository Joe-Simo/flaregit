/** Discussion events carry a validated topic identity in their event type.
 * Other events retain repository scope; never infer identities from notification prose. */
export function inboxDestination(item:{project_id:string;type:string}):string{
 const discussion=/^discussion\.reply\.(public|members)\.(discussion_[a-f0-9-]{36})$/.exec(item.type);
 if(discussion)return discussion[1]==='members'?`/p/${encodeURIComponent(item.project_id)}/discussions?topic=${discussion[2]}`:`/community?repo=${encodeURIComponent(item.project_id)}&topic=${discussion[2]}`;
 const section=item.type.startsWith('issue.')?'issues':item.type.startsWith('review.')||item.type.startsWith('integration')||item.type.startsWith('stack')||item.type==='task.ready'?'changes':'activity';
 return `/p/${encodeURIComponent(item.project_id)}/${section}`;
}
export const INBOX_INTERACTIVE_TARGETS='input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"],[role="combobox"],[role="dialog"]';
export function inboxShortcutAllowed(modifiers:{metaKey:boolean;ctrlKey:boolean;altKey:boolean},interactive:boolean):boolean{return !interactive&&!modifiers.metaKey&&!modifiers.ctrlKey&&!modifiers.altKey;}
