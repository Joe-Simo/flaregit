interface AllocationRepository {info():Promise<unknown>;[Symbol.dispose]():void}
interface AllocationInspector {get(name:string):Promise<AllocationRepository>}
/** Cleanup-only provider allocation witness. This establishes no Git branch,
 * commit, history completeness, browsing readiness or contribution authority. */
export async function importedAllocationReady(binding:AllocationInspector,name:string):Promise<boolean>{
 let expired=false,repository:AllocationRepository|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new Error("Import allocation inspection timed out"));},5000);});
 try{
  repository=await Promise.race([binding.get(name).then(value=>{if(expired)value[Symbol.dispose]();return value;}),timeout]);
  const info=await Promise.race([repository.info(),timeout]);
  return typeof info==="object"&&info!==null;
 }catch{return false;}
 finally{if(timer!==undefined)clearTimeout(timer);repository?.[Symbol.dispose]();}
}
