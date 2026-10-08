/** F09 slice: organization roles and effective repository permission. The highest grant wins; the last owner cannot be removed. */

export type Role = "none" | "read" | "triage" | "write" | "admin";

const ORDER: readonly Role[] = ["none", "read", "triage", "write", "admin"];

export interface OrgMember {
  readonly id: string;
  readonly owner: boolean;
}

export interface Grant {
  readonly subject: string;
  readonly role: Role;
}

/** Effective role is the highest of the direct grant and every team grant the user belongs to. Org owners are admin everywhere. */
export function effectiveRole(userId: string, members: readonly OrgMember[], grants: readonly Grant[], teamsOf: readonly string[]): Role {
  if (members.find((member) => member.id === userId)?.owner) return "admin";
  const subjects = new Set([userId, ...teamsOf]);
  let best = 0;
  for (const grant of grants) if (subjects.has(grant.subject)) best = Math.max(best, ORDER.indexOf(grant.role));
  return ORDER[best] ?? "none";
}

export function can(role: Role, needed: Role): boolean {
  return ORDER.indexOf(role) >= ORDER.indexOf(needed);
}

/** An organization must always keep at least one owner. */
export function removeMember(members: readonly OrgMember[], id: string): {readonly ok: true; readonly members: OrgMember[]} | {readonly ok: false; readonly error: string} {
  const target = members.find((member) => member.id === id);
  if (!target) return {ok: false, error: "That user is not a member"};
  if (target.owner && members.filter((member) => member.owner).length === 1) return {ok: false, error: "An organization must keep at least one owner"};
  return {ok: true, members: members.filter((member) => member.id !== id)};
}
