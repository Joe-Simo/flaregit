/** F15 slice: repository redirects and tombstones. Renamed names keep a permanent redirect, deleted names stay reserved for 90 days, and deleted resources answer "gone" rather than "not found". Pure transitions; storage and routes are wired separately. */

export const MAX_REDIRECT_DEPTH = 5;
export const NAME_REUSE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export type ResourceKind = "repository" | "issue";

export interface Tombstone {
  readonly kind: ResourceKind;
  readonly id: string;
  readonly deletedAt: number;
  readonly reason: string;
}

export interface RedirectRecord {
  readonly to: string;
  readonly actorId: string;
  readonly renamedAt: number;
}

export interface RedirectEntry extends RedirectRecord {
  readonly from: string;
}

/** Immutable state. `clock` returns milliseconds and drives timestamps and the name reuse window. */
export interface RedirectTable {
  readonly clock: () => number;
  readonly current: ReadonlySet<string>;
  readonly redirects: ReadonlyMap<string, RedirectRecord>;
  readonly tombstones: ReadonlyMap<string, Tombstone>;
}

export type RedirectResult = {readonly ok: true; readonly table: RedirectTable} | {readonly ok: false; readonly error: string};

/** `name` is the current name a successful lookup landed on, the deleted name for "gone", or the requested name for "not-found". */
export type ResolveResult =
  | {readonly ok: true; readonly name: string; readonly redirectedFrom: readonly string[]}
  | {readonly ok: false; readonly reason: "not-found"; readonly name: string; readonly redirectedFrom: readonly string[]}
  | {readonly ok: false; readonly reason: "gone"; readonly name: string; readonly redirectedFrom: readonly string[]; readonly tombstone: Tombstone}
  | {readonly ok: false; readonly reason: "too-deep"; readonly name: string; readonly redirectedFrom: readonly string[]};

export type MissingLookup = {readonly status: "gone"; readonly tombstone: Tombstone} | {readonly status: "not-found"};

type ParsedEntry = {readonly ok: true; readonly entry: RedirectEntry} | {readonly ok: false; readonly error: string};

interface Walk {
  readonly path: readonly string[];
  readonly cyclic: boolean;
}

export function createRedirectTable(clock: () => number): RedirectTable {
  return {clock, current: new Set(), redirects: new Map(), tombstones: new Map()};
}

function fail(error: string): {readonly ok: false; readonly error: string} {
  return {ok: false, error};
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function tombstoneKey(kind: ResourceKind, id: string): string {
  return `${kind}:${id}`;
}

/** Follows redirects from `start` until a name without one. The path always begins with `start`; `cyclic` means the walk revisited a name. */
function walk(redirects: ReadonlyMap<string, RedirectRecord>, start: string): Walk {
  const path = [start];
  const seen = new Set(path);
  let record = redirects.get(start);
  while (record) {
    if (seen.has(record.to)) return {path, cyclic: true};
    path.push(record.to);
    seen.add(record.to);
    record = redirects.get(record.to);
  }
  return {path, cyclic: false};
}

/** Returns the first broken redirect in the graph: a loop, or a chain with more than MAX_REDIRECT_DEPTH hops. */
function graphError(redirects: ReadonlyMap<string, RedirectRecord>): string | undefined {
  for (const from of redirects.keys()) {
    const {path, cyclic} = walk(redirects, from);
    if (cyclic) return `Redirects from ${from} form a loop`;
    if (path.length - 1 > MAX_REDIRECT_DEPTH) return `Redirects from ${from} exceed ${MAX_REDIRECT_DEPTH} hops`;
  }
  return undefined;
}

/** Why `name` cannot become a current repository name right now, if anything. */
function claimError(table: RedirectTable, name: string): string | undefined {
  if (table.current.has(name)) return `${name} is already claimed as a current name by another repository`;
  if (table.redirects.has(name)) return `${name} is a permanent redirect and cannot be reclaimed`;
  for (const record of table.redirects.values()) {
    if (record.to === name) return `${name} is still the target of a permanent redirect`;
  }
  const tombstone = table.tombstones.get(tombstoneKey("repository", name));
  if (tombstone && table.clock() - tombstone.deletedAt < NAME_REUSE_WINDOW_MS) {
    const reusable = new Date(tombstone.deletedAt + NAME_REUSE_WINDOW_MS).toISOString();
    return `${name} was deleted and cannot be reused until ${reusable}`;
  }
  return undefined;
}

/** Makes `name` a current name. A deletion tombstone for it is dropped because the reuse window has already passed. */
function markCurrent(table: RedirectTable, name: string): RedirectTable {
  const tombstones = new Map(table.tombstones);
  tombstones.delete(tombstoneKey("repository", name));
  return {...table, current: new Set(table.current).add(name), tombstones};
}

/** Claims a name for a repository that was not created by a rename. */
export function registerRepository(table: RedirectTable, name: string): RedirectResult {
  if (!isName(name)) return fail("A repository needs a name without surrounding whitespace");
  const blocked = claimError(table, name);
  if (blocked) return fail(blocked);
  return {ok: true, table: markCurrent(table, name)};
}

/**
 * Moves a current name to a new one and keeps the old name as a permanent redirect. Refuses self-renames, unknown old names,
 * names already claimed, names that are redirects, reuse inside the window, loops and chains deeper than MAX_REDIRECT_DEPTH.
 */
export function recordRename(table: RedirectTable, oldName: string, newName: string, actorId: string): RedirectResult {
  if (!isName(oldName) || !isName(newName)) return fail("A rename needs both repository names without surrounding whitespace");
  if (!isName(actorId)) return fail("A rename needs an actor");
  if (oldName === newName) return fail("A repository cannot be renamed to its own name");
  if (!table.current.has(oldName)) return fail(`${oldName} is not a current repository name`);
  if (walk(table.redirects, newName).path.includes(oldName)) {
    return fail(`Renaming ${oldName} to ${newName} would create a redirect loop`);
  }
  const blocked = claimError(table, newName);
  if (blocked) return fail(blocked);

  const redirects = new Map(table.redirects).set(oldName, {to: newName, actorId, renamedAt: table.clock()});
  const graph = graphError(redirects);
  if (graph) return fail(graph);

  const current = new Set(table.current);
  current.delete(oldName);
  return {ok: true, table: markCurrent({...table, current, redirects}, newName)};
}

/**
 * Marks a resource deleted. A deleted repository name leaves the current set and stays reserved for NAME_REUSE_WINDOW_MS,
 * and redirects that still point at it resolve to "gone" rather than to a live repository.
 */
export function deleteResource(table: RedirectTable, kind: ResourceKind, id: string, reason: string): RedirectResult {
  if (!isName(id)) return fail(`A deleted ${kind} needs an id without surrounding whitespace`);
  if (reason.trim().length === 0) return fail("A deletion needs a reason");
  const key = tombstoneKey(kind, id);
  if (table.tombstones.has(key)) return fail(`${kind} ${id} is already deleted`);
  if (kind === "repository" && !table.current.has(id)) return fail(`${id} is not a current repository name`);

  const current = new Set(table.current);
  if (kind === "repository") current.delete(id);
  const tombstones = new Map(table.tombstones).set(key, {kind, id, deletedAt: table.clock(), reason: reason.trim()});
  return {ok: true, table: {...table, current, tombstones}};
}

/** For a resource that is no longer live: "gone" when it was deleted, "not-found" when it never existed in this table. */
export function lookupMissing(table: RedirectTable, kind: ResourceKind, id: string): MissingLookup {
  const tombstone = table.tombstones.get(tombstoneKey(kind, id));
  return tombstone ? {status: "gone", tombstone} : {status: "not-found"};
}

/** Follows redirects from `name` to the current name. Chains longer than MAX_REDIRECT_DEPTH hops are not followed. */
export function resolve(table: RedirectTable, name: string): ResolveResult {
  const {path, cyclic} = walk(table.redirects, name);
  const terminal = path.at(-1) ?? name;
  const redirectedFrom = path.slice(0, -1);
  if (cyclic || redirectedFrom.length > MAX_REDIRECT_DEPTH) return {ok: false, reason: "too-deep", name: terminal, redirectedFrom};
  if (table.current.has(terminal)) return {ok: true, name: terminal, redirectedFrom};
  const tombstone = table.tombstones.get(tombstoneKey("repository", terminal));
  if (tombstone) return {ok: false, reason: "gone", name: terminal, redirectedFrom, tombstone};
  return {ok: false, reason: "not-found", name: terminal, redirectedFrom};
}

/** Lists every permanent redirect sorted by old name, so exporting the same table twice gives the same list. Tombstones are not included. */
export function exportRedirects(table: RedirectTable): RedirectEntry[] {
  return [...table.redirects]
    .map(([from, record]): RedirectEntry => ({from, ...record}))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

function parseEntry(item: unknown): ParsedEntry {
  if (typeof item !== "object" || item === null) return {ok: false, error: "Each redirect must be an object"};
  const {from, to, actorId, renamedAt} = item as Record<string, unknown>;
  if (!isName(from) || !isName(to)) return {ok: false, error: "Each redirect needs non-empty from and to names"};
  if (from === to) return {ok: false, error: `Redirect ${from} points to itself`};
  if (!isName(actorId)) return {ok: false, error: `Redirect ${from} needs an actor`};
  if (typeof renamedAt !== "number" || !Number.isFinite(renamedAt)) return {ok: false, error: `Redirect ${from} needs a renamedAt time`};
  return {ok: true, entry: {from, to, actorId, renamedAt}};
}

/**
 * Validates an exported redirect list before accepting it. Malformed entries, duplicate old names, loops and chains deeper than
 * MAX_REDIRECT_DEPTH are refused. Redirect targets that are not redirects themselves come back as current names.
 */
export function importRedirects(list: unknown, clock: () => number): RedirectResult {
  if (!Array.isArray(list)) return fail("A redirect import must be a list");
  const redirects = new Map<string, RedirectRecord>();
  for (const item of list) {
    const parsed = parseEntry(item);
    if (!parsed.ok) return fail(parsed.error);
    const {from, ...record} = parsed.entry;
    if (redirects.has(from)) return fail(`Redirect ${from} is listed more than once`);
    redirects.set(from, record);
  }
  const graph = graphError(redirects);
  if (graph) return fail(graph);

  const current = new Set<string>();
  for (const record of redirects.values()) {
    if (!redirects.has(record.to)) current.add(record.to);
  }
  return {ok: true, table: {clock, current, redirects, tombstones: new Map()}};
}
