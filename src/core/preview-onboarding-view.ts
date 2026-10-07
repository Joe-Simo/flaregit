import {z} from 'zod';
/** Shared HTTP contract; internal allocations and provider credentials never enter this DTO. */
export const previewOnboardingViewSchema=z.object({status:z.enum(['disabled','unconfigured','reserved','dispatch_unknown','deployed','active','retired']),canPrepare:z.boolean(),reason:z.enum(['provider_unavailable','registration_unavailable','dispatch_unconfirmed','provisioning_disabled','configuration_unavailable','capacity_exhausted']).nullable().optional(),canRetry:z.boolean(),nextAction:z.enum(['reconcile_original_dispatch','owner_reconciliation_required']).optional(),origin:z.url().optional(),requestId:z.uuid().optional()}).strict();
export type PreviewOnboardingView=z.infer<typeof previewOnboardingViewSchema>;
