import { InitialArtifactCredentials } from './initial-artifact-credentials';
import { z } from 'zod';
const id = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
export const initialForkCredentialScopeSchema = z.object({ eventId: z.uuid(), allocationId: z.uuid(), taskId: id, projectId: id, incarnation: z.uuid(), canonicalRepoName: id, workspaceRepoName: id, accountKey: id, actorId: z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/) }).strict();
export type InitialForkCredentialScope = z.infer<typeof initialForkCredentialScopeSchema>;
export type InitialForkCredentialStatus = import('./initial-artifact-credentials').InitialArtifactCredentialStatus;
export type PendingInitialForkCredential = import('./initial-artifact-credentials').PendingInitialArtifactCredential<InitialForkCredentialScope>;
/** Fork-specific immutable scope; existing rows and payload encoding are retained. */
export class InitialForkCredentials extends InitialArtifactCredentials<InitialForkCredentialScope> {
  constructor(storage: DurableObjectStorage) { super(storage, { table: 'initial_fork_credentials', parse: value => initialForkCredentialScopeSchema.parse(value), repositoryName: scope => scope.workspaceRepoName }); }
}
