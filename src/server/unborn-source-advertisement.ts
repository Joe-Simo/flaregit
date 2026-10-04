/** Parse a complete native advertisement; a matched unborn HEAD symref is not a commit. */
export class UnbornSourceNotEmptyError extends Error { constructor(){super("Source has Git history or a different symbolic HEAD");this.name="UnbornSourceNotEmptyError";} }
export function parseUnbornAdvertisement(raw:string,defaultRef:string,allowedPrivateRefs:readonly {ref:string;commit:string}[]=[],requireAll=false):{headSymref:string|null;privateRefs:Array<{ref:string;commit:string}>}{
 if(raw.length>1024*1024||!defaultRef.startsWith("refs/heads/"))throw new Error("Complete source advertisement unavailable");
 let headSymref:string|null=null;const allowed=new Map(allowedPrivateRefs.map(value=>[value.ref,value.commit])),observed=new Map<string,string>();
 if(allowedPrivateRefs.some(value=>!/^refs\/flaregit\/(?:inputs\/[a-f0-9-]{36}\/[A-Za-z0-9_-]+\/[a-f0-9]{40}|candidates\/[A-Za-z0-9_-]+)$/.test(value.ref)||! /^[a-f0-9]{40}$/.test(value.commit)||(value.ref.startsWith("refs/flaregit/inputs/")&&!value.ref.endsWith(`/${value.commit}`))))throw new Error("Only exact private preservation refs may be admitted");
 if(allowed.size!==allowedPrivateRefs.length)throw new Error("Private preservation witness repeats");
 for(const line of raw.split("\n")){
  if(line==="")continue;
  if(line===`ref: ${defaultRef}\tHEAD`&&headSymref===null){headSymref=defaultRef;continue;}
  const match=/^([a-f0-9]{40})\t(refs\/[^\s]+)$/.exec(line);
  if(match&&allowed.get(match[2]!)===match[1]){if(observed.has(match[2]!))throw new Error("Native ref inventory repeats");observed.set(match[2]!,match[1]!);continue;}
  if(/^[a-f0-9]{40}\t(?:HEAD|refs\/[^\s]+)$/.test(line)||/^ref: refs\/[^\s]+\tHEAD$/.test(line))throw new UnbornSourceNotEmptyError();
  throw new Error("Complete native ref inventory is unavailable");
 }
 if(requireAll&&observed.size!==allowed.size)throw new Error("Recorded private preservation refs are missing from the source");
 return{headSymref,privateRefs:[...observed].map(([ref,commit])=>({ref,commit})).sort((a,b)=>a.ref.localeCompare(b.ref))};
}
