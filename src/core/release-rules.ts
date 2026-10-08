/** F11 slice: releases. Tags are unique, versions are semantic, and published assets carry a digest. */

export interface Release {
  readonly tag: string;
  readonly draft: boolean;
  readonly assets: readonly {readonly name: string; readonly sha256: string}[];
}

const SEMVER = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function publishRelease(existing: readonly Release[], release: Release): {readonly ok: true; readonly releases: Release[]} | {readonly ok: false; readonly error: string} {
  if (!SEMVER.test(release.tag)) return {ok: false, error: "Release tags must be semantic versions"};
  if (existing.some((candidate) => candidate.tag === release.tag)) return {ok: false, error: "That tag already has a release"};
  const names = release.assets.map((asset) => asset.name);
  if (new Set(names).size !== names.length) return {ok: false, error: "Asset names must be unique"};
  if (release.assets.some((asset) => !/^[0-9a-f]{64}$/.test(asset.sha256))) return {ok: false, error: "Every asset needs a SHA-256 digest"};
  return {ok: true, releases: [...existing, release]};
}
