import {z} from 'zod';
import {organizationRoleSchema,organizationRepositoryRoleSchema,organizationSubjectSchema} from './organization-access';
const id=z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:@-]+$/);
const revision=z.number().int().positive();
export const organizationMutationSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('member'),expectedRevision:revision,userId:id,role:organizationRoleSchema}).strict(),
 z.object({action:z.literal('remove-member'),expectedRevision:revision,userId:id}).strict(),
 z.object({action:z.literal('team'),expectedRevision:revision,teamId:id,name:z.string().min(1).max(128)}).strict(),
 z.object({action:z.literal('remove-team'),expectedRevision:revision,teamId:id}).strict(),
 z.object({action:z.literal('team-member'),expectedRevision:revision,teamId:id,userId:id,present:z.boolean()}).strict(),
 z.object({action:z.literal('grant'),expectedRevision:revision,repositoryId:z.string().regex(/^[a-z0-9]{12,16}$/),subject:organizationSubjectSchema,role:organizationRepositoryRoleSchema}).strict(),
 z.object({action:z.literal('revoke-grant'),expectedRevision:revision,repositoryId:z.string().regex(/^[a-z0-9]{12,16}$/),subject:organizationSubjectSchema}).strict(),
 z.object({action:z.literal('invite'),expectedRevision:revision,userId:id,role:organizationRoleSchema}).strict(),
 z.object({action:z.literal('revoke-invite'),expectedRevision:revision,invitationId:id}).strict(),
 z.object({action:z.literal('accept-invite'),expectedRevision:revision,invitationId:id}).strict(),
 z.object({action:z.literal('reconcile'),expectedRevision:revision}).strict(),
]);
export type OrganizationMutation=z.infer<typeof organizationMutationSchema>;
