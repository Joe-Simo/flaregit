import { z } from 'zod';
import { isSafeRef } from '../core/sanitize';
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const selected = z.object({
  journalId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
  acceptedRef: z.string().refine(value => value.startsWith('refs/heads/') && isSafeRef(value)).optional(),
  acceptedRootVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().refine(value => value.acceptedRootVersion === undefined || value.acceptedRef !== undefined, 'A recorded root version requires its accepted ref');
/** Missing selection retains the legacy exact-commit request contract. The DO
 * alone resolves an original UUID or a unique accepted target; no live default
 * or invented branch name is inserted at this boundary. */
export const privateRecoveryRequestSchema = z.object({
  commit: sha,
  expectedTree: sha.nullable(),
  idempotencyKey: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
  selected: selected.optional(),
}).strict();
