/** F13 slice: dependency advisory matching with strict x.y.z versions. Anything unparseable is reported, never skipped. */

export interface Dependency {
  readonly name: string;
  readonly version: string;
}

export interface Advisory {
  readonly id: string;
  readonly package: string;
  /** Space-separated comparators, all of which must hold, e.g. ">=1.0.0 <1.2.3". Operators: <, <=, >, >=, =. */
  readonly vulnerable: string;
}

export interface AdvisoryReport {
  readonly affected: readonly {readonly name: string; readonly version: string; readonly advisoryId: string}[];
  /** Dependencies or advisory ranges that could not be evaluated. */
  readonly unparseable: readonly {readonly subject: string; readonly value: string}[];
}

type Version = readonly [number, number, number];

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMPARATOR = /^(<=|>=|<|>|=)?(\S+)$/;

function parseVersion(text: string): Version | undefined {
  const match = VERSION.exec(text);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number) ? -1 : 1;
  return 0;
}

type Comparator = {readonly op: string; readonly version: Version};

function parseRange(range: string): Comparator[] | undefined {
  const parts = range.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;
  const comparators: Comparator[] = [];
  for (const part of parts) {
    const match = COMPARATOR.exec(part);
    const version = match === null ? undefined : parseVersion(match[2] as string);
    if (match === null || version === undefined) return undefined;
    comparators.push({op: match[1] ?? "=", version});
  }
  return comparators;
}

function satisfies(version: Version, comparators: readonly Comparator[]): boolean {
  return comparators.every(({op, version: bound}) => {
    const order = compare(version, bound);
    if (op === "<") return order < 0;
    if (op === "<=") return order <= 0;
    if (op === ">") return order > 0;
    if (op === ">=") return order >= 0;
    return order === 0;
  });
}

export function matchAdvisories(dependencies: readonly Dependency[], advisories: readonly Advisory[]): AdvisoryReport {
  const affected: {name: string; version: string; advisoryId: string}[] = [];
  const unparseable: {subject: string; value: string}[] = [];
  const ranges = new Map<string, Comparator[] | undefined>();
  for (const advisory of advisories) {
    const range = parseRange(advisory.vulnerable);
    ranges.set(advisory.id, range);
    if (range === undefined) unparseable.push({subject: `advisory ${advisory.id}`, value: advisory.vulnerable});
  }
  for (const dependency of dependencies) {
    const relevant = advisories.filter((advisory) => advisory.package === dependency.name);
    if (relevant.length === 0) continue;
    const version = parseVersion(dependency.version);
    if (version === undefined) {
      unparseable.push({subject: dependency.name, value: dependency.version});
      continue;
    }
    for (const advisory of relevant) {
      const range = ranges.get(advisory.id);
      if (range !== undefined && satisfies(version, range)) affected.push({name: dependency.name, version: dependency.version, advisoryId: advisory.id});
    }
  }
  return {affected, unparseable};
}
