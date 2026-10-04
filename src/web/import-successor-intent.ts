const operation = /^import-history-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface ImportSuccessorIntent { predecessorId: string; expectedGeneration: number }
export function importSuccessorIntent(value: unknown): ImportSuccessorIntent | null {
 if(!value || typeof value !== 'object')return null;
 const input=value as Record<string,unknown>;
 return typeof input.predecessorId==='string' && operation.test(input.predecessorId) && typeof input.expectedGeneration==='number' && Number.isSafeInteger(input.expectedGeneration) && input.expectedGeneration>=0 ? {predecessorId:input.predecessorId,expectedGeneration:input.expectedGeneration} : null;
}
