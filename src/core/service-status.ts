/** F19 slice: service status, uptime and incident timeline. Pure: callers pass `now` from their injected clock. */

export interface HealthCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly checkedAt: number;
}

export type ServiceStatus = "operational" | "degraded" | "unknown";

/**
 * Any failed check is "degraded", whatever its age. Otherwise any check older than maxAgeMs makes the
 * status "unknown", and having no checks at all is "unknown" too. Stale or missing evidence never counts as ok.
 */
export function computeStatus(checks: readonly HealthCheck[], now: number, maxAgeMs: number): ServiceStatus {
  if (checks.length === 0) return "unknown";
  if (checks.some((check) => !check.ok)) return "degraded";
  if (checks.some((check) => now - check.checkedAt > maxAgeMs)) return "unknown";
  return "operational";
}

export interface UptimeSample {
  readonly at: number;
  readonly ok: boolean;
}

/** Fraction of samples in [now - windowMs, now] that are ok. Returns null when the window holds no samples. */
export function uptime(samples: readonly UptimeSample[], windowMs: number, now: number): number | null {
  const inWindow = samples.filter((sample) => sample.at >= now - windowMs && sample.at <= now);
  if (inWindow.length === 0) return null;
  return inWindow.filter((sample) => sample.ok).length / inWindow.length;
}

export interface Incident {
  readonly openedAt: number;
  readonly resolvedAt: number | null;
}

export type IncidentResolution = { readonly ok: true; readonly incident: Incident } | { readonly ok: false; readonly error: string };

export function openIncident(openedAt: number): Incident {
  return {openedAt, resolvedAt: null};
}

/** Resolves an open incident once. Refuses a second resolution, and an instant before the incident opened. */
export function resolveIncident(incident: Incident, resolvedAt: number): IncidentResolution {
  if (incident.resolvedAt !== null) return {ok: false, error: "Incident is already resolved"};
  if (resolvedAt < incident.openedAt) return {ok: false, error: "Incident cannot resolve before it opened"};
  return {ok: true, incident: {...incident, resolvedAt}};
}

/** Milliseconds from opening to resolution, or to `now` while the incident is still open. */
export function incidentDurationMs(incident: Incident, now: number): number {
  return (incident.resolvedAt ?? now) - incident.openedAt;
}
