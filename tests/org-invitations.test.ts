import {expect, test} from "bun:test";
import {canGrant, createOrgInvitations, type OrgStore} from "../src/core/org-invitations";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const START = 1_000_000;

function setup(owners: readonly string[] = ["boss"]) {
  const clock = {now: START};
  const invitations = createOrgInvitations({now: () => clock.now});
  const orgId = invitations.createOrganization(owners);
  return {clock, invitations, orgId, store: invitations.store};
}

type Harness = ReturnType<typeof setup>;

/** Returns the success payload, failing the test on a refusal. */
function unwrap<T extends {readonly ok: boolean}>(result: T): Extract<T, {readonly ok: true}> {
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return result as Extract<T, {readonly ok: true}>;
}

function expectRefused(result: {readonly ok: boolean; readonly error?: string}, message: RegExp): void {
  expect(result.ok).toBe(false);
  expect(result.error ?? "").toMatch(message);
}

async function invite(t: Harness, email: string, role: string, actor = "boss") {
  return unwrap(await t.invitations.createInvitation(t.orgId, email, role, actor));
}

/** Invites and accepts so that userId becomes a member holding role. */
async function addMember(t: Harness, userId: string, role: string) {
  const issued = await invite(t, `${userId}@example.com`, role);
  unwrap(await t.invitations.accept(issued.token, userId, `${userId}@example.com`));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function snapshot(store: OrgStore): string {
  return JSON.stringify({
    organizations: [...store.organizations.values()],
    invitations: [...store.invitations.values()],
    teams: [...store.teams.values()],
  });
}

test("an admin invitation expires in seven days and adds a member with exactly that role", async () => {
  const t = setup();
  const issued = await invite(t, "Dev@Example.com", "write");
  expect(issued.expiresAt).toBe(START + SEVEN_DAYS_MS);
  const joined = unwrap(await t.invitations.accept(issued.token, "dev", "dev@example.com"));
  expect(joined).toMatchObject({orgId: t.orgId, role: "write"});
  expect(t.invitations.roleOf(t.orgId, "dev")).toBe("write");
});

test("only the invited email can accept, ignoring case and surrounding spaces", async () => {
  const t = setup();
  const issued = await invite(t, "Dev@Example.com", "read");
  expectRefused(await t.invitations.accept(issued.token, "eve", "eve@example.com"), /different email/);
  expect(t.invitations.roleOf(t.orgId, "eve")).toBe("none");
  unwrap(await t.invitations.accept(issued.token, "dev", "  DEV@example.COM "));
  expect(t.invitations.roleOf(t.orgId, "dev")).toBe("read");
});

test("an invitation is still accepted one millisecond before seven days pass", async () => {
  const t = setup();
  const issued = await invite(t, "dev@example.com", "read");
  t.clock.now = START + SEVEN_DAYS_MS - 1;
  unwrap(await t.invitations.accept(issued.token, "dev", "dev@example.com"));
  expect(t.invitations.roleOf(t.orgId, "dev")).toBe("read");
});

test("an invitation is refused from the moment seven days have passed", async () => {
  const t = setup();
  const issued = await invite(t, "dev@example.com", "read");
  t.clock.now = START + SEVEN_DAYS_MS;
  expectRefused(await t.invitations.accept(issued.token, "dev", "dev@example.com"), /expired/);
  expect(t.invitations.roleOf(t.orgId, "dev")).toBe("none");
});

test("an invitation is accepted once, and an unknown token is refused", async () => {
  const t = setup();
  const issued = await invite(t, "dev@example.com", "write");
  expectRefused(await t.invitations.accept("not-a-real-token", "dev", "dev@example.com"), /not valid/);
  unwrap(await t.invitations.accept(issued.token, "dev", "dev@example.com"));
  expectRefused(await t.invitations.accept(issued.token, "dev", "dev@example.com"), /already been used/);
  expect(t.store.organizations.get(t.orgId)?.members.map((member) => member.id)).toEqual(["boss", "dev"]);
});

test("a revoked invitation cannot be accepted", async () => {
  const t = setup();
  const issued = await invite(t, "dev@example.com", "read");
  unwrap(t.invitations.revoke(issued.invitationId, "boss"));
  expectRefused(await t.invitations.accept(issued.token, "dev", "dev@example.com"), /revoked/);
  expect(t.invitations.roleOf(t.orgId, "dev")).toBe("none");
});

test("only an admin can revoke, and an accepted invitation cannot be revoked", async () => {
  const t = setup();
  await addMember(t, "dev", "write");
  const pending = await invite(t, "pat@example.com", "read");
  expectRefused(t.invitations.revoke(pending.invitationId, "dev"), /admin/);
  unwrap(t.invitations.revoke(pending.invitationId, "boss"));
  expectRefused(t.invitations.revoke(pending.invitationId, "boss"), /already revoked/);
  const used = await invite(t, "eve@example.com", "read");
  unwrap(await t.invitations.accept(used.token, "eve", "eve@example.com"));
  expectRefused(t.invitations.revoke(used.invitationId, "boss"), /accepted invitation/);
});

test("no grant may exceed the granting actor's role", async () => {
  const t = setup();
  await addMember(t, "dev", "write");
  expectRefused(await t.invitations.createInvitation(t.orgId, "pat@example.com", "read", "dev"), /admin/);
  expectRefused(await t.invitations.createInvitation(t.orgId, "pat@example.com", "admin", "dev"), /admin/);
  expect(canGrant("write", "admin")).toBe(false);
  expect(canGrant("write", "triage")).toBe(true);
  expect(canGrant("admin", "admin")).toBe(true);
  const top = await invite(t, "root@example.com", "admin");
  unwrap(await t.invitations.accept(top.token, "root", "root@example.com"));
  expect(t.invitations.roleOf(t.orgId, "root")).toBe("admin");
});

test("only admins create invitations, create teams, change team members or remove members", async () => {
  const t = setup();
  await addMember(t, "dev", "write");
  await addMember(t, "pat", "read");
  expectRefused(await t.invitations.createInvitation(t.orgId, "x@example.com", "read", "pat"), /admin/);
  expectRefused(await t.invitations.createInvitation(t.orgId, "x@example.com", "read", "stranger"), /admin/);
  expectRefused(t.invitations.createTeam(t.orgId, "core", "dev"), /admin/);
  const team = unwrap(t.invitations.createTeam(t.orgId, "core", "boss"));
  expectRefused(t.invitations.addTeamMember(team.teamId, "pat", "dev"), /admin/);
  unwrap(t.invitations.addTeamMember(team.teamId, "pat", "boss"));
  expectRefused(t.invitations.removeTeamMember(team.teamId, "pat", "dev"), /admin/);
  expectRefused(t.invitations.removeOrgMember(t.orgId, "pat", "dev"), /admin/);
});

test("only the SHA-256 hash of a token is stored", async () => {
  const t = setup();
  const issued = await invite(t, "dev@example.com", "write");
  const [record] = [...t.store.invitations.values()];
  expect(record?.tokenHash).toBe(await sha256Hex(issued.token));
  expect(record?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  expect(Object.keys(record ?? {})).not.toContain("token");
  expect(snapshot(t.store)).not.toContain(issued.token);
});

test("team names are 1 to 50 characters and unique per organization", () => {
  const t = setup();
  expectRefused(t.invitations.createTeam(t.orgId, "   ", "boss"), /1 to 50/);
  expectRefused(t.invitations.createTeam(t.orgId, "x".repeat(51), "boss"), /1 to 50/);
  unwrap(t.invitations.createTeam(t.orgId, "x".repeat(50), "boss"));
  unwrap(t.invitations.createTeam(t.orgId, "  Core  ", "boss"));
  expectRefused(t.invitations.createTeam(t.orgId, "core", "boss"), /already exists/);
  const other = t.invitations.createOrganization(["rival"]);
  unwrap(t.invitations.createTeam(other, "Core", "rival"));
});

test("team members must belong to the organization and cannot be added twice", async () => {
  const t = setup();
  const team = unwrap(t.invitations.createTeam(t.orgId, "core", "boss"));
  expectRefused(t.invitations.addTeamMember(team.teamId, "stranger", "boss"), /organization members/);
  await addMember(t, "dev", "read");
  unwrap(t.invitations.addTeamMember(team.teamId, "dev", "boss"));
  expectRefused(t.invitations.addTeamMember(team.teamId, "dev", "boss"), /already on this team/);
  unwrap(t.invitations.removeTeamMember(team.teamId, "dev", "boss"));
  expectRefused(t.invitations.removeTeamMember(team.teamId, "dev", "boss"), /not on this team/);
});

test("the last owner cannot be removed", () => {
  const solo = setup(["boss"]);
  expectRefused(solo.invitations.removeOrgMember(solo.orgId, "boss", "boss"), /at least one owner/);
  const pair = setup(["boss", "co"]);
  unwrap(pair.invitations.removeOrgMember(pair.orgId, "co", "boss"));
  expectRefused(pair.invitations.removeOrgMember(pair.orgId, "boss", "boss"), /at least one owner/);
  expect(() => pair.invitations.createOrganization([])).toThrow("at least one owner");
});

test("an admin who is not an owner cannot remove an owner", async () => {
  const t = setup(["boss", "co"]);
  await addMember(t, "dev", "admin");
  expectRefused(t.invitations.removeOrgMember(t.orgId, "boss", "dev"), /Only an owner/);
  expect(t.invitations.roleOf(t.orgId, "boss")).toBe("admin");
});

test("removing a member also drops their direct role and team seats", async () => {
  const t = setup();
  await addMember(t, "dev", "write");
  const team = unwrap(t.invitations.createTeam(t.orgId, "core", "boss"));
  unwrap(t.invitations.addTeamMember(team.teamId, "dev", "boss"));
  unwrap(t.invitations.removeOrgMember(t.orgId, "dev", "boss"));
  expect(t.invitations.roleOf(t.orgId, "dev")).toBe("none");
  expect(t.store.teams.get(team.teamId)?.memberIds).toEqual([]);
});
