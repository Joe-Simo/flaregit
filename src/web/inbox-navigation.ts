/** Inbox events currently carry repository scope, not issue or candidate IDs.
 * Do not infer a private resource identity from notification prose. */
export function inboxDestination(item:{project_id:string;type:string}):string{
 const section=item.type.startsWith('issue.')?'issues':item.type.startsWith('review.')||item.type.startsWith('integration')||item.type.startsWith('stack')||item.type==='task.ready'?'changes':'activity';
 return `/p/${encodeURIComponent(item.project_id)}/${section}`;
}
export const INBOX_INTERACTIVE_TARGETS='input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"],[role="combobox"],[role="dialog"]';
export function inboxShortcutAllowed(modifiers:{metaKey:boolean;ctrlKey:boolean;altKey:boolean},interactive:boolean):boolean{return !interactive&&!modifiers.metaKey&&!modifiers.ctrlKey&&!modifiers.altKey;}
