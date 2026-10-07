import {z} from 'zod';
const workerId=z.uuid();
const sourceId=z.string().regex(/^[a-f0-9]{40}$/).refine(value=>value!=='0'.repeat(40));
export interface RuntimeReleaseEnvironment{CF_VERSION_METADATA?:{id?:unknown;tag?:unknown;timestamp?:unknown};FLAREGIT_SOURCE_VERSION?:unknown}
/** Call only with trusted server bindings. Expose exactly identified versions,
 * never spread binding objects, tags, timestamps or credential values. */
export function runtimeRelease(environment:RuntimeReleaseEnvironment){
 const worker=workerId.safeParse(environment.CF_VERSION_METADATA?.id),source=sourceId.safeParse(environment.FLAREGIT_SOURCE_VERSION);
 const workerVersion=worker.success?worker.data:null,sourceVersion=source.success?source.data:null;
 return{workerVersion,sourceVersion,releaseIdentified:workerVersion!==null&&sourceVersion!==null};
}

/** Optional exact-release request fence. Ordinary callers remain unchanged;
 * pinned acceptance clients cannot mutate through a different deployment. */
export function runtimeReleaseRequestMatches(request:Request,environment:RuntimeReleaseEnvironment){
 const worker=request.headers.get('X-FlareGit-Expected-Worker-Version'),source=request.headers.get('X-FlareGit-Expected-Source-Version');
 if(worker===null&&source===null)return true;
 const current=runtimeRelease(environment);
 return current.releaseIdentified&&workerId.safeParse(worker).success&&sourceId.safeParse(source).success&&worker===current.workerVersion&&source===current.sourceVersion;
}
