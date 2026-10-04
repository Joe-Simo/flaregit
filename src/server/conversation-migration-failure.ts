import {z} from "zod";
import {GithubMigrationReadError} from './github-migration-reader';
export class ConversationMigrationAuthorityError extends Error {constructor(){super('Conversation migration owner or source scope changed');}}
export class ConversationMigrationCapacityError extends Error {constructor(readonly reason:'unconfigured'|'account_budget'|'global_budget'){super('Conversation migration read capacity unavailable');}}
export function conversationMigrationFailure(error:unknown){
 if(error instanceof ConversationMigrationAuthorityError)return {status:403,category:'owner_scope_changed',error:'Owner access or the saved import source changed. Refresh before retrying.'};
 if(error instanceof ConversationMigrationCapacityError)return {status:error.reason==='unconfigured'?503:429,category:error.reason==='unconfigured'?'read_budget_unconfigured':'read_budget_exhausted',error:error.reason==='unconfigured'?'Conversation read funding is not configured. Saved migration state remains preserved.':'Conversation read allowance is exhausted. Saved migration state remains preserved.'};
 if(error instanceof GithubMigrationReadError){
  const categories={rate_limited:'source_rate_limited',auth:'source_inaccessible',not_found:'source_inaccessible',provider_unavailable:'source_unavailable',timeout:'source_timeout',invalid:'source_invalid',source_changed:'source_identity_changed'};
  const delay=error.retryAfterSeconds;return {status:error.status,category:categories[error.code],error:error.message,...(delay!==undefined&&Number.isSafeInteger(delay)&&delay>=0&&delay<=3600?{retryAfterSeconds:delay}:{})};
 }
 return {status:409,category:'migration_unconfirmed',error:'Conversation migration was not confirmed. Saved pages and imported repository history remain preserved; refresh the staged operation before retrying.'};
}

const captureFailure=z.object({ok:z.literal(false),failure:z.union([z.object({code:z.enum(['rate_limited','auth','not_found','provider_unavailable','timeout','invalid','source_changed']),retryAfterSeconds:z.number().int().min(0).max(3600).optional()}).strict(),z.object({code:z.enum(['read_budget_unconfigured','read_budget_exhausted'])}).strict()])}).strict();
/** Validate a secret-free DTO; JavaScript error identity does not cross a DO RPC. */
export function conversationCaptureFailure(value:unknown):GithubMigrationReadError|ConversationMigrationCapacityError|null{const parsed=captureFailure.safeParse(value);if(!parsed.success)return null;const failure=parsed.data.failure;if(failure.code==='read_budget_unconfigured')return new ConversationMigrationCapacityError('unconfigured');if(failure.code==='read_budget_exhausted')return new ConversationMigrationCapacityError('account_budget');return new GithubMigrationReadError(failure.code,undefined,'retryAfterSeconds' in failure?failure.retryAfterSeconds:undefined);}
