import {z} from "zod";

/** These witnesses must be derived from repository preservation receipts, never from an advertisement. */
export const unbornPrivateRefSchema=z.object({kind:z.enum(["retained-input","candidate"]),ref:z.string().max(500),commit:z.string().regex(/^[a-f0-9]{40}$/).refine(value=>!/^0{40}$/.test(value)),receiptId:z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),projectId:z.string().min(1).max(128),incarnation:z.uuid(),canonicalRepoName:z.string().min(1).max(200)}).strict().superRefine((value,ctx)=>{
 const valid=value.kind==="retained-input"?value.ref.startsWith(`refs/flaregit/inputs/${value.incarnation}/`)&&value.ref.endsWith(`/${value.commit}`)&&/^refs\/flaregit\/inputs\/[a-f0-9-]{36}\/[A-Za-z0-9_-]+\/[a-f0-9]{40}$/.test(value.ref):value.ref===`refs/flaregit/candidates/${value.receiptId}`;
 if(!valid)ctx.addIssue({code:"custom",message:"Exact recorded private ref required"});
});
export const unbornPrivateRefsSchema=z.array(unbornPrivateRefSchema).max(1000).superRefine((values,ctx)=>{if(new Set(values.map(value=>value.ref)).size!==values.length)ctx.addIssue({code:"custom",message:"Private ref witness repeats"});});
export type UnbornPrivateRefProof=z.infer<typeof unbornPrivateRefSchema>;
export function validateUnbornPrivateRefs(proposed:readonly UnbornPrivateRefProof[],scope:{projectId:string;incarnation:string;sourceRepoName:string}):UnbornPrivateRefProof[]{
 const values=unbornPrivateRefsSchema.parse(proposed);
 if(values.some(value=>value.projectId!==scope.projectId||value.incarnation!==scope.incarnation||value.canonicalRepoName!==scope.sourceRepoName))throw new Error("Private preservation witness belongs to another repository scope");
 return values;
}
