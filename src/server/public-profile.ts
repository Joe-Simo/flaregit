import type { PublicationModerationState } from "./publication-moderation.js";
import { safeContent } from "./public-community.js";
import type { Profile } from "./durable-object";
export interface PublicProfileState { profile: Profile; visibility: "public" | "private"; version: number; ownerId: string | null; moderation?: PublicationModerationState }
export function publicProfileProjection(handle: string, state: PublicProfileState | null) {
  if (!state || state.moderation?.suppressed || state.visibility !== "public" || !state.ownerId || state.profile.handle !== handle) return null;
  try { safeContent(state.profile.handle, state.profile.displayName, state.profile.bio); } catch { return null; }
  return { handle, displayName: state.profile.displayName, bio: state.profile.bio, joinedAt: state.profile.joinedAt, version: state.version, identityVerification: "self-described" as const };
}
export interface PublicContribution { repository: { id: string; name: string }; commit: string; acceptedAt: string }
