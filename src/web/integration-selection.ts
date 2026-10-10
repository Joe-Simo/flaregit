import type {FlareGitProjectState} from '@/core/types';
import {prepareIntegrationIntent,type IntegrationIntent} from './integration-intent-recovery';

export const MAX_COMBINED_CHANGES = 8;

/** Selected ids that can still be combined, deduplicated, in a stable order (oldest change first). */
export function combinableSelection(state:FlareGitProjectState,selected:readonly string[]):string[]{
 return [...new Set(selected)].filter(id=>{const task=state.tasks[id];return task?.status==='ready'||task?.status==='blocked';})
  .sort((a,b)=>state.tasks[a]!.createdAt.localeCompare(state.tasks[b]!.createdAt)||a.localeCompare(b));
}

/** Why the list-level combine action is unavailable, or null when it can run. */
export function combineSelectionBlocker(ids:readonly string[]):string|null{
 if(ids.length<1)return 'Select at least one ready or blocked change to combine.';
 if(ids.length>MAX_COMBINED_CHANGES)return `Select at most ${MAX_COMBINED_CHANGES} changes to combine.`;
 return null;
}

/** The exact integration intent sent for these task ids: a saved original for the same ids, otherwise a new one. */
export function integrationIntentFor(state:FlareGitProjectState,taskIds:readonly string[],saved:readonly IntegrationIntent[]):IntegrationIntent{
 const ids=[...taskIds];
 return saved.find(record=>JSON.stringify(record.request.taskIds)===JSON.stringify(ids))??prepareIntegrationIntent(state,ids);
}
