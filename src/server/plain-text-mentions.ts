/** Comments currently render literal text. This parser makes no Markdown claims
 * and consumes complete handle tokens instead of notifying a truncated prefix. */
export function plainTextMentions(body:string):string[]{
 if(body.length>10000)throw Error('Comment body exceeds the mention inspection limit');
 const handles=new Set<string>();
 const token=/(^|[^\p{L}\p{N}_@.+%/\-])@([A-Za-z0-9-]+)(?![\p{L}\p{N}_@\-])/gu;
 for(const match of body.matchAll(token)){
  const handle=match[2]!.toLowerCase();
  if(!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(handle))continue;
  handles.add(handle);if(handles.size>20)throw Error('A comment can mention at most 20 distinct handles');
 }
 return [...handles];
}
export interface MentionRecipient{userId:string;handle:string;accountKey:string;profileVersion:number;authoritySource:string}
