/** Parse a complete native advertisement; a matched unborn HEAD symref is not a commit. */
export class UnbornSourceNotEmptyError extends Error { constructor(){super("Source has Git history or a different symbolic HEAD");this.name="UnbornSourceNotEmptyError";} }
export function parseUnbornAdvertisement(raw:string,defaultRef:string):{headSymref:string|null}{
 if(raw.length>1024*1024||!defaultRef.startsWith("refs/heads/"))throw new Error("Complete source advertisement unavailable");
 let headSymref:string|null=null;
 for(const line of raw.split("\n")){
  if(line==="")continue;
  if(line===`ref: ${defaultRef}\tHEAD`&&headSymref===null){headSymref=defaultRef;continue;}
  if(/^[a-f0-9]{40}\t(?:HEAD|refs\/[^\s]+)$/.test(line)||/^ref: refs\/[^\s]+\tHEAD$/.test(line))throw new UnbornSourceNotEmptyError();
  throw new Error("Complete native ref inventory is unavailable");
 }
 return{headSymref};
}
