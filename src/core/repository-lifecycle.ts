/** F01 slice: repository archive state rules. Pure transitions; storage and routes are wired separately. */

export type RepositoryState = "active" | "archived";

export interface RepositoryLifecycle {
  readonly state: RepositoryState;
  readonly archivedAt: string | null;
  readonly version: number;
}

export type LifecycleAction = "archive" | "unarchive";

export interface LifecycleActor {
  readonly canAdmin: boolean;
}

export type LifecycleResult =
  | { readonly ok: true; readonly next: RepositoryLifecycle }
  | { readonly ok: false; readonly status: 403 | 409; readonly error: string };

export function initialLifecycle(): RepositoryLifecycle {
  return { state: "active", archivedAt: null, version: 1 };
}

/** Applies an archive or unarchive transition. Only repository administrators may change state. */
export function applyLifecycleAction(
  current: RepositoryLifecycle,
  action: LifecycleAction,
  actor: LifecycleActor,
  now: string,
): LifecycleResult {
  if (!actor.canAdmin) return { ok: false, status: 403, error: "Only repository administrators can change archive state" };
  if (action === "archive") {
    if (current.state === "archived") return { ok: false, status: 409, error: "Repository is already archived" };
    return { ok: true, next: { state: "archived", archivedAt: now, version: current.version + 1 } };
  }
  if (current.state === "active") return { ok: false, status: 409, error: "Repository is not archived" };
  return { ok: true, next: { state: "active", archivedAt: null, version: current.version + 1 } };
}

/** Archived repositories are read-only: any write must be refused before it reaches Git or storage. */
export function assertWritable(lifecycle: RepositoryLifecycle): void {
  if (lifecycle.state === "archived") throw new Error("Repository is archived and read-only");
}
