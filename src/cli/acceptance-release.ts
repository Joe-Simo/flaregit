import {z} from 'zod';

const workerVersion=z.uuid();
const sourceVersion=z.string().regex(/^[a-f0-9]{40}$/).refine(value=>value!=='0'.repeat(40));
/** Exact public /api/runtime shape. Missing identity is observable but cannot
 * establish an acceptance release pin. No extra server metadata is retained. */
export const acceptanceRuntimeReleaseSchema=z.object({workerVersion:workerVersion.nullable(),sourceVersion:sourceVersion.nullable(),releaseIdentified:z.boolean()}).strict().refine(value=>value.releaseIdentified===(value.workerVersion!==null&&value.sourceVersion!==null),{message:'Runtime release identity is inconsistent'});
export const acceptanceReleasePinSchema=z.object({workerVersion,sourceVersion,releaseIdentified:z.literal(true)}).strict();
export type AcceptanceReleasePin=z.infer<typeof acceptanceReleasePinSchema>;

/** Pin once; a later runtime read must identify the exact same deployment and
 * source. This function performs no fetch, environment lookup, or persistence. */
export function pinAcceptanceRelease(runtime:unknown,previous?:AcceptanceReleasePin|null):AcceptanceReleasePin{
 const observed=acceptanceRuntimeReleaseSchema.parse(runtime);
 if(!observed.releaseIdentified)throw Error('Acceptance release is not identified');
 const current=acceptanceReleasePinSchema.parse(observed);
 if(previous!==undefined&&previous!==null){const saved=acceptanceReleasePinSchema.parse(previous);if(saved.workerVersion!==current.workerVersion||saved.sourceVersion!==current.sourceVersion)throw Error('Acceptance release changed; original pin is retained');return previous;}
 return Object.freeze(current);
}

/** Git credentials and release pins are scoped to the configured core origin.
 * They stay out of argv/URLs, and redirects cannot forward them elsewhere. */
export function acceptanceCloneEnvironment(remote:string,origin:string,token:string,pin:AcceptanceReleasePin):Record<string,string>{
 const target=new URL(remote),expected=new URL(origin),fixed=acceptanceReleasePinSchema.parse(pin);
 if(target.protocol!=='https:'||expected.protocol!=='https:'||target.origin!==expected.origin||target.username||target.password||target.search||target.hash||expected.username||expected.password||expected.pathname!=='/'||expected.search||expected.hash||!target.pathname.startsWith('/git/')||!token||token.length>4096||/[\r\n\0]/.test(token))throw Error('Pinned clone origin or credential unavailable');
 const key=`http.${target.origin}/.extraHeader`;
 return{GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:key,GIT_CONFIG_VALUE_0:'Authorization: Bearer '+token,GIT_CONFIG_KEY_1:key,GIT_CONFIG_VALUE_1:'X-FlareGit-Expected-Worker-Version: '+fixed.workerVersion,GIT_CONFIG_KEY_2:key,GIT_CONFIG_VALUE_2:'X-FlareGit-Expected-Source-Version: '+fixed.sourceVersion,GIT_CONFIG_KEY_3:'http.followRedirects',GIT_CONFIG_VALUE_3:'false'};
}
