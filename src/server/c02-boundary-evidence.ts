import {z} from 'zod';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),digest=z.string().regex(/^[a-f0-9]{64}$/),time=z.number().int().positive().safe();
const task=z.object({taskId:z.uuid(),instanceId:id}).strict();
const refusal=z.object({source:z.literal('registered-native-boundary'),scope:task,operation:z.enum(['foreign-task','supervisor','credential-operation']),decision:z.literal('refused'),observedAt:time}).strict();
const marker=z.object({source:z.literal('trusted-marker-store'),owner:z.enum(['task-a','supervisor']),initialDigest:digest,finalDigest:digest,readAt:time}).strict();
const native=z.object({source:z.literal('native-container-api'),scope:task,commandId:z.uuid(),exitCode:z.literal(0),commandSettledAt:time,inspection:z.literal('absent'),inspectedAt:time}).strict();
const inspection=z.object({source:z.literal('trusted-native-inspector'),scope:task,commandId:z.uuid(),phase:z.enum(['initial-a','final-a','final-b']),exitCode:z.literal(0),observedAt:time,taskMarkerDigest:digest.nullable(),rootMarkerDigest:digest.nullable(),credentialDigest:digest.nullable(),credentialPresent:z.boolean()}).strict();
const environment=z.object({source:z.literal('trusted-worker-environment-audit'),scope:task,approvedNativeEnvDigest:digest,syntheticCredentialDigest:digest,credentialValueTransmitted:z.boolean(),observedAt:time}).strict();
const inventory=z.object({source:z.literal('trusted-acceptance-policy'),scope:task,commandId:z.uuid(),origin:z.literal('untrusted-native-stdout'),reason:z.literal('untrusted-authority-source'),expectedInventoryDigest:digest,submittedInventoryDigest:digest,decision:z.literal('refused'),receiptGuard:z.literal('TrustedBrowserReceipts.verifyAndRecord').optional(),receiptGuardRefused:z.literal(true).optional(),verifiedReceiptAbsent:z.literal(true).optional(),publicationBefore:digest,publicationAfter:digest,observedAt:time}).strict();
export const c02BoundaryPlanSchema=z.object({requestId:z.uuid(),taskA:task,taskB:task,taskAMarkerDigest:digest,supervisorMarkerDigest:digest,syntheticCredentialDigest:digest,expectedInventoryDigest:digest,createdAt:time,deadlineAt:time}).strict().superRefine((value,ctx)=>{if(value.taskA.taskId===value.taskB.taskId||value.taskA.instanceId===value.taskB.instanceId)ctx.addIssue({code:'custom',message:'Distinct actual native tasks required'});if(value.deadlineAt<=value.createdAt||value.deadlineAt-value.createdAt>240000)ctx.addIssue({code:'custom',message:'Bounded native batch lifetime required'});if(new Set([value.taskAMarkerDigest,value.supervisorMarkerDigest,value.syntheticCredentialDigest]).size!==3)ctx.addIssue({code:'custom',message:'Independent synthetic markers required'});});
export type C02BoundaryPlan=z.infer<typeof c02BoundaryPlanSchema>;
export const c02BoundaryEvidenceSchema=z.object({markers:z.array(marker).max(2),refusals:z.array(refusal).max(3),native:z.array(native).max(2),inspections:z.array(inspection).max(3),environments:z.array(environment).max(2),inventory:inventory.nullable()}).strict();
export type C02BoundaryEvidence=z.infer<typeof c02BoundaryEvidenceSchema>;
/** Diagnostic bytes are never admitted by deriveC02BoundaryEvidence. */
export interface C02UntrustedAttackerOutput{source:'untrusted-native-stdout';bytes:Uint8Array}
const same=(a:z.infer<typeof task>,b:z.infer<typeof task>)=>a.taskId===b.taskId&&a.instanceId===b.instanceId;
/** Supply only independent trusted ledgers. Tags are not authentication. */
export function deriveC02BoundaryEvidence(input:C02BoundaryPlan,observations:unknown){
 const plan=c02BoundaryPlanSchema.parse(input),parsed=c02BoundaryEvidenceSchema.safeParse(observations);
 const unconfirmed={crossTask:'unconfirmed',supervisor:'unconfirmed',credentialOperation:'unconfirmed',credentialDisclosure:'unconfirmed',fabricatedInventory:'unconfirmed'} as const;
 if(!parsed.success)return unconfirmed;
 const evidence=parsed.data,inTime=(value:number)=>value>=plan.createdAt&&value<=plan.deadlineAt;
 const commands=[plan.taskA,plan.taskB].map(scope=>evidence.native.filter(receipt=>same(receipt.scope,scope)&&inTime(receipt.commandSettledAt)&&inTime(receipt.inspectedAt)&&receipt.inspectedAt>=receipt.commandSettledAt));
 if(commands.some(rows=>rows.length!==1))return unconfirmed;
 const attack=commands[1]![0]!,aCommand=commands[0]![0]!;
 const inspect=(phase:z.infer<typeof inspection>['phase'],scope:z.infer<typeof task>)=>{const rows=evidence.inspections.filter(receipt=>receipt.phase===phase&&same(receipt.scope,scope)&&inTime(receipt.observedAt)&&receipt.commandId!==attack.commandId&&receipt.commandId!==aCommand.commandId);return rows.length===1?rows[0]:undefined;};
 const initial=inspect('initial-a',plan.taskA),final=inspect('final-a',plan.taskA),b=inspect('final-b',plan.taskB);
 const ordered=initial&&final&&b&&new Set([initial.commandId,final.commandId,b.commandId]).size===3&&initial.observedAt<=attack.commandSettledAt&&final.observedAt>=attack.commandSettledAt&&b.observedAt>=attack.commandSettledAt&&final.observedAt<=aCommand.inspectedAt&&b.observedAt<=attack.inspectedAt;
 const intact=(owner:'task-a'|'supervisor',expected:string)=>evidence.markers.filter(receipt=>receipt.owner===owner&&receipt.initialDigest===expected&&receipt.finalDigest===expected&&inTime(receipt.readAt)&&receipt.readAt>=attack.commandSettledAt).length===1;
 const refused=(operation:z.infer<typeof refusal>['operation'])=>evidence.refusals.filter(receipt=>same(receipt.scope,plan.taskB)&&receipt.operation===operation&&inTime(receipt.observedAt)).length===1;
 const a=ordered&&initial.taskMarkerDigest===plan.taskAMarkerDigest&&final.taskMarkerDigest===plan.taskAMarkerDigest&&initial.rootMarkerDigest!==null&&initial.rootMarkerDigest===final.rootMarkerDigest;
 const s=intact('supervisor',plan.supervisorMarkerDigest);
 const env=(scope:z.infer<typeof task>,transmitted:boolean)=>evidence.environments.filter(receipt=>same(receipt.scope,scope)&&receipt.syntheticCredentialDigest===plan.syntheticCredentialDigest&&receipt.credentialValueTransmitted===transmitted&&inTime(receipt.observedAt)&&receipt.observedAt<=attack.commandSettledAt).length===1;
 const credentials=ordered&&initial.credentialPresent&&final.credentialPresent&&initial.credentialDigest===plan.syntheticCredentialDigest&&final.credentialDigest===plan.syntheticCredentialDigest&&!b.credentialPresent&&b.credentialDigest===null&&env(plan.taskA,true)&&env(plan.taskB,false);
 const i=evidence.inventory;
 return{crossTask:a&&intact('task-a',plan.taskAMarkerDigest)&&refused('foreign-task')?'proven':'unconfirmed',supervisor:s&&refused('supervisor')?'proven':'unconfirmed',credentialOperation:s&&refused('credential-operation')?'proven':'unconfirmed',credentialDisclosure:credentials?'proven':'unconfirmed',fabricatedInventory:i&&same(i.scope,plan.taskB)&&i.commandId===attack.commandId&&i.receiptGuard==='TrustedBrowserReceipts.verifyAndRecord'&&i.receiptGuardRefused===true&&i.verifiedReceiptAbsent===true&&i.expectedInventoryDigest===plan.expectedInventoryDigest&&i.publicationBefore===i.publicationAfter&&inTime(i.observedAt)?'proven':'unconfirmed'} as const;
}
