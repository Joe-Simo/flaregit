import { z } from 'zod';
import { apiJson } from './api';

const id = z.string().min(1).max(256);
export const organizationRole = z.enum(['owner', 'member']);
export const repositoryRole = z.enum(['admin', 'write', 'read']);
export const organizationSubject = z.discriminatedUnion('kind', [z.object({kind: z.literal('user'), id}), z.object({kind: z.literal('team'), id})]);
export const organizationSnapshot = z.object({
  id, name: z.string(), revision: z.number().int().positive(),
  accessSyncPending: z.boolean().optional(),
  viewerRole: z.enum(['owner', 'member', 'outside', 'invited']).optional(),
  members: z.array(z.object({userId: id, role: organizationRole})),
  teams: z.array(z.object({id, name: z.string(), members: z.array(id), childTeams: z.array(id).default([])})),
  grants: z.array(z.object({repositoryId: id, subject: organizationSubject, role: repositoryRole})),
  invitations: z.array(z.object({id, userId: id, role: organizationRole, expiresAt: z.number().int().positive()})),
});
export type OrganizationSnapshot = z.infer<typeof organizationSnapshot>;
export type OrganizationRole = z.infer<typeof organizationRole>;
export type RepositoryRole = z.infer<typeof repositoryRole>;
export type OrganizationSubject = z.infer<typeof organizationSubject>;

export async function readOrganizations() {
  return z.array(organizationSnapshot).parse(await apiJson<unknown>('/organizations'));
}
export async function createOrganization(name: string) {
  return organizationSnapshot.parse(await apiJson<unknown>('/organizations', {method: 'POST', json: {name}}));
}
export async function changeOrganization(organization: OrganizationSnapshot, path: string, method: 'POST' | 'PUT' | 'DELETE', values: Record<string, unknown> = {}) {
  return organizationSnapshot.parse(await apiJson<unknown>(`/organizations/${encodeURIComponent(organization.id)}${path}`, {method, json: {...values, expectedRevision: organization.revision}}));
}
