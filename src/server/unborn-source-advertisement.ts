/** Parse a complete native advertisement; a matched unborn HEAD symref is not a commit. */
export function parseUnbornAdvertisement(raw:string,defaultRef:string):{headSymref:string|null}{
 if(raw.length>1024*1024||!defaultRef.startsWith("refs/heads/"))throw new Error("Complete source advertisement unavailable");
 let headSymref:string|null=null;
 for(const line of raw.split("\n")){
  if(line==="")continue;
  if(line===`ref: ${defaultRef}\tHEAD`&&headSymref===null){headSymref=defaultRef;continue;}
  throw new Error("Source has Git objects or its HEAD/ref inventory differs");
 }
 return{headSymref};
}
