import { useEffect, useRef } from "react";

/**
 * Live-board activity per repository. The board's WebSocket reports that agents moved; readers of
 * repository state subscribe and refresh, coalesced so a burst of events costs at most one read per window.
 */
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function notifyRepositoryActivity(projectId: string): void {
  for (const listener of [...(listeners.get(projectId) ?? [])]) listener();
}

export function subscribeRepositoryActivity(projectId: string, listener: Listener): () => void {
  const set = listeners.get(projectId) ?? new Set<Listener>();
  set.add(listener); listeners.set(projectId, set);
  return () => { set.delete(listener); if (set.size === 0 && listeners.get(projectId) === set) listeners.delete(projectId); };
}

export interface CoalesceScheduler { schedule(callback: () => void, delayMs: number): unknown; cancel(handle: unknown): void; now(): number }
const timers: CoalesceScheduler = { schedule: (callback, delay) => setTimeout(callback, delay), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>), now: () => Date.now() };

/**
 * Runs `run` at most once per `windowMs`: the first trigger runs immediately, later triggers in the
 * window collapse into one trailing run at the window's end. `cancel` drops a pending trailing run.
 */
export function coalesce(run: () => void, windowMs: number, scheduler: CoalesceScheduler = timers): { trigger: () => void; cancel: () => void } {
  let last = -Infinity, pending: unknown;
  const fire = () => { pending = undefined; last = scheduler.now(); run(); };
  return {
    trigger() {
      if (pending !== undefined) return;
      const wait = last + windowMs - scheduler.now();
      if (wait <= 0) fire(); else pending = scheduler.schedule(fire, wait);
    },
    cancel() { if (pending !== undefined) { scheduler.cancel(pending); pending = undefined; } },
  };
}

/** Minimum time between activity-driven refreshes of one resource. */
export const ACTIVITY_REFRESH_WINDOW_MS = 2000;

/** Calls the latest `refresh` when the repository's live board reports activity, at most once per window. */
export function useRepositoryActivity(projectId: string, refresh: () => void, enabled = true): void {
  const latest = useRef(refresh); latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    const coalesced = coalesce(() => latest.current(), ACTIVITY_REFRESH_WINDOW_MS);
    const unsubscribe = subscribeRepositoryActivity(projectId, coalesced.trigger);
    return () => { unsubscribe(); coalesced.cancel(); };
  }, [projectId, enabled]);
}
