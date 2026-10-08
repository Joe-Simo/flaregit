/** F12 slice: package access. A package inherits its repository's visibility; private packages never appear in listings for others. */

export interface PackageRecord {
  readonly name: string;
  readonly version: string;
  readonly private: boolean;
  readonly ownerId: string;
}

export function visiblePackages(packages: readonly PackageRecord[], viewerId: string | undefined, memberOf: readonly string[]): PackageRecord[] {
  return packages.filter((pkg) => !pkg.private || (viewerId !== undefined && (pkg.ownerId === viewerId || memberOf.includes(pkg.ownerId))));
}

/** A published version is immutable: republishing the same name and version is refused. */
export function canPublish(packages: readonly PackageRecord[], name: string, version: string): boolean {
  return !packages.some((pkg) => pkg.name === name && pkg.version === version);
}
