import { useCallback, useEffect, useRef } from "react";
import { VisiblePolling, type PollingEnvironment, type VisiblePollingOptions } from "./visible-polling";
export interface UseVisiblePollingOptions<T> extends VisiblePollingOptions<T> {
  /** Include every repository, candidate revision and other input that changes the read. */
  scope: string;
  enabled?: boolean;
}
const browserEnvironment: PollingEnvironment = {
  visible:()=>document.visibilityState!=="hidden",
  subscribe(listener){
    const visibility=()=>listener();
    const focus=()=>{if(document.visibilityState!=="hidden")listener();};
    document.addEventListener("visibilitychange",visibility);window.addEventListener("focus",focus);
    return()=>{document.removeEventListener("visibilitychange",visibility);window.removeEventListener("focus",focus);};
  },
  schedule:(callback,delay)=>setTimeout(callback,delay),
  cancel:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>),
};
/** Return data from read; publish UI state only through the guarded callbacks. */
export function useVisiblePolling<T>(options: UseVisiblePollingOptions<T>): () => Promise<void> {
  const latest=useRef(options);latest.current=options;
  const controller=useRef<VisiblePolling<T> | null>(null);
  useEffect(()=>{
    if(options.enabled===false){controller.current=null;return;}
    const scope=options.scope;
    const polling=new VisiblePolling<T>({intervalMs:options.intervalMs,maxBackoffMs:options.maxBackoffMs,
      read:signal=>{
        if(latest.current.scope!==scope || latest.current.enabled===false)throw new DOMException("Polling scope changed","AbortError");
        return latest.current.read(signal);
      },
      onValue:value=>{if(latest.current.scope===scope && latest.current.enabled!==false)latest.current.onValue(value);},
      onError:error=>{if(latest.current.scope===scope && latest.current.enabled!==false)latest.current.onError(error);},
    },browserEnvironment);
    controller.current=polling;polling.start();
    return()=>{polling.stop();if(controller.current===polling)controller.current=null;};
  },[options.scope,options.enabled,options.intervalMs,options.maxBackoffMs]);
  return useCallback(()=>controller.current?.refresh() ?? Promise.resolve(),[]);
}
