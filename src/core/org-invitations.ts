/** F09 slice: organization invitations and teams, kept in memory. Invitation tokens are stored only as SHA-256 hashes. */
import {can, effectiveRole, removeMember, type Grant, type OrgMember, type Role} from "./org-access";

export type InvitableRole = Exclude<Role, "none">;

export type Failure = {readonly ok: false; readonly error: string};
export type Result<T = unknown> = ({readonly ok: true} & T) | Failure;

export interface Organization {
  readonly id: string;
  members: OrgMember[];
  grants: Grant[];
}

export interface Invitation {
  readonly id: string;
  readonly orgId: string;
  readonly email: string;
  readonly role: InvitableRole;
  readonly tokenHash: string;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
  revokedAt: number | null;
}

export interface Team {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  memberIds: string[];
}

export interface OrgStore {
  readonly organizations: Map<string, Organization>;
  readonly invitations: Map<string, Invitation>;
  readonly teams: Map<string, Team>;
}

export interface OrgInvitationOptions {
  /** Clock in epoch milliseconds. Defaults to Date.now. */
  readonly now?: () => number;
}

const INVITABLE_ROLES: readonly InvitableRole[] = ["read", "triage", "write", "admin"];
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TEAM_NAME_LENGTH = 50;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (error: string): Failure => ({ok: false, error});

export function isInvitableRole(value: string): value is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(value);
}

/** No grant may exceed the granting actor's own role. */
export function canGrant(actorRole: Role, granted: InvitableRole): boolean {
  return can(actorRole, granted);
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

export function createOrgInvitations(options: OrgInvitationOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const store: OrgStore = {organizations: new Map(), invitations: new Map(), teams: new Map()};

  function teamsIn(orgId: string): Team[] {
    return [...store.teams.values()].filter((team) => team.orgId === orgId);
  }

  function roleIn(org: Organization, userId: string): Role {
    const teamIds = teamsIn(org.id).filter((team) => team.memberIds.includes(userId)).map((team) => team.id);
    return effectiveRole(userId, org.members, org.grants, teamIds);
  }

  /** Resolves an organization and proves the actor is an admin in it. */
  function adminOf(orgId: string, actorId: string): Result<{readonly org: Organization}> {
    const org = store.organizations.get(orgId);
    if (!org) return fail("Organization not found");
    if (!can(roleIn(org, actorId), "admin")) return fail("Only an organization admin can do that");
    return {ok: true, org};
  }

  function roleOf(orgId: string, userId: string): Role {
    const org = store.organizations.get(orgId);
    return org ? roleIn(org, userId) : "none";
  }

  function createOrganization(owners: readonly string[]): string {
    if (owners.length === 0) throw new Error("An organization needs at least one owner");
    const id = crypto.randomUUID();
    store.organizations.set(id, {id, members: [...new Set(owners)].map((owner) => ({id: owner, owner: true})), grants: []});
    return id;
  }

  /** Returns the raw token once. Only its SHA-256 hash is kept. */
  async function createInvitation(
    orgId: string,
    email: string,
    role: string,
    actorId: string,
  ): Promise<Result<{readonly invitationId: string; readonly token: string; readonly expiresAt: number}>> {
    const address = normalizeEmail(email);
    if (!address) return fail("Enter a valid email address");
    if (!isInvitableRole(role)) return fail("Role must be read, triage, write or admin");
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256Hex(token);
    // Checked after the await, so the admin test and the insert run in one synchronous step.
    const admin = adminOf(orgId, actorId);
    if (!admin.ok) return admin;
    if (!canGrant(roleIn(admin.org, actorId), role)) return fail("A role cannot be granted above your own");
    const createdAt = now();
    const invitation: Invitation = {
      id: crypto.randomUUID(),
      orgId,
      email: address,
      role,
      tokenHash,
      createdBy: actorId,
      createdAt,
      expiresAt: createdAt + INVITATION_TTL_MS,
      usedBy: null,
      usedAt: null,
      revokedAt: null,
    };
    store.invitations.set(invitation.id, invitation);
    return {ok: true, invitationId: invitation.id, token, expiresAt: invitation.expiresAt};
  }

  async function accept(token: string, userId: string, userEmail: string): Promise<Result<{readonly orgId: string; readonly role: InvitableRole}>> {
    const tokenHash = await sha256Hex(token);
    // No await below this point, so the status checks and the write cannot interleave with another accept.
    const invitation = [...store.invitations.values()].find((item) => item.tokenHash === tokenHash);
    if (!invitation) return fail("This invitation is not valid");
    if (invitation.revokedAt !== null) return fail("This invitation was revoked");
    if (invitation.usedAt !== null) return fail("This invitation has already been used");
    if (now() >= invitation.expiresAt) return fail("This invitation has expired");
    if (normalizeEmail(userEmail) !== invitation.email) return fail("This invitation was sent to a different email address");
    const org = store.organizations.get(invitation.orgId);
    if (!org) return fail("Organization not found");
    if (org.members.some((member) => member.id === userId)) return fail("You are already a member of this organization");
    org.members.push({id: userId, owner: false});
    org.grants.push({subject: userId, role: invitation.role});
    invitation.usedAt = now();
    invitation.usedBy = userId;
    return {ok: true, orgId: org.id, role: invitation.role};
  }

  function revoke(invitationId: string, actorId: string): Result {
    const invitation = store.invitations.get(invitationId);
    if (!invitation) return fail("Invitation not found");
    const admin = adminOf(invitation.orgId, actorId);
    if (!admin.ok) return admin;
    if (invitation.usedAt !== null) return fail("An accepted invitation cannot be revoked");
    if (invitation.revokedAt !== null) return fail("This invitation is already revoked");
    invitation.revokedAt = now();
    return {ok: true};
  }

  function createTeam(orgId: string, name: string, actorId: string): Result<{readonly teamId: string}> {
    const admin = adminOf(orgId, actorId);
    if (!admin.ok) return admin;
    const teamName = name.trim();
    if (teamName.length < 1 || teamName.length > MAX_TEAM_NAME_LENGTH) return fail(`Team names must be 1 to ${MAX_TEAM_NAME_LENGTH} characters`);
    const folded = teamName.toLowerCase();
    if (teamsIn(orgId).some((team) => team.name.toLowerCase() === folded)) return fail("A team with that name already exists");
    const team: Team = {id: crypto.randomUUID(), orgId, name: teamName, memberIds: []};
    store.teams.set(team.id, team);
    return {ok: true, teamId: team.id};
  }

  function addTeamMember(teamId: string, userId: string, actorId: string): Result {
    const team = store.teams.get(teamId);
    if (!team) return fail("Team not found");
    const admin = adminOf(team.orgId, actorId);
    if (!admin.ok) return admin;
    if (!admin.org.members.some((member) => member.id === userId)) return fail("Only organization members can join a team");
    if (team.memberIds.includes(userId)) return fail("That user is already on this team");
    team.memberIds.push(userId);
    return {ok: true};
  }

  function removeTeamMember(teamId: string, userId: string, actorId: string): Result {
    const team = store.teams.get(teamId);
    if (!team) return fail("Team not found");
    const admin = adminOf(team.orgId, actorId);
    if (!admin.ok) return admin;
    if (!team.memberIds.includes(userId)) return fail("That user is not on this team");
    team.memberIds = team.memberIds.filter((id) => id !== userId);
    return {ok: true};
  }

  /** Removes an organization member with their direct role and team seats. The last owner is protected by removeMember. */
  function removeOrgMember(orgId: string, userId: string, actorId: string): Result {
    const admin = adminOf(orgId, actorId);
    if (!admin.ok) return admin;
    const {org} = admin;
    const target = org.members.find((member) => member.id === userId);
    const actorIsOwner = org.members.some((member) => member.id === actorId && member.owner);
    if (target?.owner && !actorIsOwner) return fail("Only an owner can remove an owner");
    const next = removeMember(org.members, userId);
    if (!next.ok) return next;
    org.members = next.members;
    org.grants = org.grants.filter((grant) => grant.subject !== userId);
    for (const team of teamsIn(orgId)) team.memberIds = team.memberIds.filter((id) => id !== userId);
    return {ok: true};
  }

  return {
    store,
    roleOf,
    createOrganization,
    createInvitation,
    accept,
    revoke,
    createTeam,
    addTeamMember,
    removeTeamMember,
    removeOrgMember,
  };
}
