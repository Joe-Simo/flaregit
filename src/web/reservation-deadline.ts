export class ReservationTimeout extends Error {constructor(){super("Reservation read timed out. Refresh to retry.");}}
/** Bounds this optional panel's complete read, including session-token and body awaits. */
export async function reservationDeadline<T>(operation:()=>Promise<T>,controller:AbortController,timeoutMs=15_000):Promise<T>{
 if(controller.signal.aborted)throw new DOMException("Reservation read cancelled","AbortError");
 let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
 try{return await Promise.race([new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new ReservationTimeout());controller.abort();},timeoutMs);}),new Promise<never>((_,reject)=>{abort=()=>reject(new DOMException("Reservation read cancelled","AbortError"));controller.signal.addEventListener("abort",abort,{once:true});}),operation()]);}
 finally{if(timer!==undefined)clearTimeout(timer);if(abort)controller.signal.removeEventListener("abort",abort);}
}
