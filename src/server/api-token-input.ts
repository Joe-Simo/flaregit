import {z} from 'zod';
const schema=z.object({label:z.string().max(60).optional(),scope:z.enum(['full','read','write']).optional(),repo:z.string().regex(/^[a-z0-9]{12,16}$/).optional(),ttlSeconds:z.number().int().positive().safe().max(365*86400).optional()}).strict();
/** Omitted legacy session defaults remain explicit. Invalid supplied values
 * never silently broaden scope or turn an expiring token into a permanent one. */
export function parseApiTokenInput(input:unknown,viaToken:boolean){const parsed=schema.safeParse(input);if(!parsed.success)return{ok:false as const,error:'Invalid token label, scope, repository or expiry'};const value={...parsed.data,scope:parsed.data.scope??'full'};if(viaToken&&(value.scope==='full'||value.ttlSeconds===undefined||value.ttlSeconds>86400))return{ok:false as const,error:'Tokens minted from a token must have scope read|write and a ttl of at most 24 hours'};return{ok:true as const,value};}
