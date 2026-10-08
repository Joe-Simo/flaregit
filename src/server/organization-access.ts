import { z } from 'zod';

const id = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:@-]+$/);
export const organizationRoleSchema = z.enum(['owner', 'member']);
export const organizationRepositoryRoleSchema = z.enum(['admin', 'write', 'read']);
export const organizationSubjectSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('user'), id }).strict(), z.object({ kind: z.literal('team'), id }).strict()]);
export type OrganizationSubject = z.infer<typeof organizationSubjectSchema>;
export type OrganizationRepositoryRole = z.infer<typeof organizationRepositoryRoleSchema>;
const memberSchema = z.object({ userId: id, role: organizationRoleSchema });
const teamSchema = z.object({ id, name: z.string().min(1).max(128), members: z.array(id), childTeams:z.array(id).default([]) });
const grantSchema = z.object({ repositoryId: id, subject: organizationSubjectSchema, role: organizationRepositoryRoleSchema });
const invitationSchema = z.object({ id, userId: id, role: organizationRoleSchema, expiresAt: z.number().int().positive() });
export const organizationDocumentSchema = z.object({ id, name: z.string().min(1).max(128), revision: z.number().int().positive(), members: z.array(memberSchema), teams: z.array(teamSchema), grants: z.array(grantSchema), repositories: z.array(id).default([]), invitations: z.array(invitationSchema) });
export type OrganizationAccessSnapshot = z.infer<typeof organizationDocumentSchema>;
export interface OrganizationAccessResolution { organizationId: string; revision: number; role: OrganizationRepositoryRole | null; sources: Array<{ kind: 'owner' | 'user' | 'team'; id: string; role: OrganizationRepositoryRole }> }
/** Parent grants include members of descendant teams; identifiers remain typed subjects. */
export function organizationTeamsFor(doc:OrganizationAccessSnapshot,userId:string):Set<string> {
  if(!doc.members.some(member=>member.userId===userId))return new Set();
  const teams=new Set(doc.teams.filter(team=>team.members.includes(userId)).map(team=>team.id));
  const pending=[...teams];
  while(pending.length){const child=pending.pop()!;for(const parent of doc.teams){if(parent.childTeams.includes(child)&&!teams.has(parent.id)){teams.add(parent.id);pending.push(parent.id);}}}
  return teams;
}
function assertTeamHierarchy(doc:OrganizationAccessSnapshot) {
  const byId=new Map(doc.teams.map(team=>[team.id,team])),visiting=new Set<string>(),visited=new Set<string>();
  const visit=(teamId:string)=>{if(visiting.has(teamId))throw Error('Nested teams cannot contain cycles');if(visited.has(teamId))return;const team=byId.get(teamId);if(!team)throw Error('Nested child team unavailable');visiting.add(teamId);for(const child of team.childTeams)visit(child);visiting.delete(teamId);visited.add(teamId);};
  for(const team of doc.teams){if(team.childTeams.length>100||new Set(team.childTeams).size!==team.childTeams.length)throw Error('Invalid nested team hierarchy');visit(team.id);}
}
type Storage = Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;
/** Canonical ledger: callers must supply authenticated user identities, never identities from request arguments. */
export class OrganizationAccessLedger {
  constructor(private readonly storage: Storage) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS organization_access (id TEXT PRIMARY KEY, doc TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS organization_access_deliveries (id TEXT NOT NULL, repository_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(id,repository_id))');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS organization_access_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, doc TEXT NOT NULL, PRIMARY KEY(id,revision))');
  }
  snapshot(organizationId: string): OrganizationAccessSnapshot | null {
    id.parse(organizationId);
    const row = this.storage.sql.exec<{ doc: string }>('SELECT doc FROM organization_access WHERE id=?', organizationId).toArray()[0];
    return row ? organizationDocumentSchema.parse(JSON.parse(row.doc)) : null;
  }
  listForUser(userId: string) {
    id.parse(userId);
    const rows=this.storage.sql.exec<{doc:string}>("SELECT doc FROM organization_access a WHERE EXISTS(SELECT 1 FROM json_each(a.doc,'$.members') m WHERE json_extract(m.value,'$.userId')=?) OR EXISTS(SELECT 1 FROM json_each(a.doc,'$.grants') g WHERE json_extract(g.value,'$.subject.kind')='user' AND json_extract(g.value,'$.subject.id')=?) OR EXISTS(SELECT 1 FROM json_each(a.doc,'$.invitations') i WHERE json_extract(i.value,'$.userId')=? AND json_extract(i.value,'$.expiresAt')>?) LIMIT 1001",userId,userId,userId,Date.now()).toArray();
    if(rows.length>1000)throw Error('Organization listing capacity reached');
    return rows.map(row=>organizationDocumentSchema.parse(JSON.parse(row.doc)));
  }
  pending(organizationId:string) {
    return this.storage.sql.exec<{repository_id:string;revision:number}>('SELECT repository_id,revision FROM organization_access_deliveries WHERE id=?',organizationId).toArray();
  }
  acknowledge(organizationId:string,repositoryId:string,revision:number) {
    this.storage.sql.exec('DELETE FROM organization_access_deliveries WHERE id=? AND repository_id=? AND revision=?',organizationId,repositoryId,revision);
  }
  revision(organizationId: string, revision: number): OrganizationAccessSnapshot | null {
    id.parse(organizationId); z.number().int().positive().parse(revision);
    const row = this.storage.sql.exec<{ doc: string }>('SELECT doc FROM organization_access_revisions WHERE id=? AND revision=?', organizationId, revision).toArray()[0];
    return row ? organizationDocumentSchema.parse(JSON.parse(row.doc)) : null;
  }
  private save(doc: OrganizationAccessSnapshot) {
    organizationDocumentSchema.parse(doc);
    assertTeamHierarchy(doc);
    if (!doc.members.some(m => m.role === 'owner')) throw Error('Organization requires an owner');
    if (doc.members.length > 1000 || doc.teams.length > 100 || doc.grants.length > 1000 || doc.repositories.length > 100 || doc.invitations.length > 1000) throw Error('Organization capacity reached');
    const serialized = JSON.stringify(doc);
    for (const repositoryId of doc.repositories) this.storage.sql.exec('INSERT INTO organization_access_deliveries VALUES(?,?,?) ON CONFLICT(id,repository_id) DO UPDATE SET revision=excluded.revision',doc.id,repositoryId,doc.revision);
    this.storage.sql.exec('INSERT INTO organization_access_revisions VALUES(?,?,?)', doc.id, doc.revision, serialized);
    this.storage.sql.exec('INSERT INTO organization_access VALUES(?,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc', doc.id, serialized);
    return structuredClone(doc);
  }
  createOrganization(organizationId: string, name: string, actorId: string) {
    id.parse(organizationId); id.parse(actorId); teamSchema.shape.name.parse(name);
    return this.storage.transactionSync(() => {
      if (this.snapshot(organizationId)) throw Error('Organization already exists');
      return this.save({ id: organizationId, name, revision: 1, members: [{ userId: actorId, role: 'owner' }], teams: [], grants: [], repositories: [], invitations: [] });
    });
  }
  private mutate(organizationId: string, actorId: string, expectedRevision: number, change: (doc: OrganizationAccessSnapshot) => void) {
    id.parse(actorId); z.number().int().positive().parse(expectedRevision);
    return this.storage.transactionSync(() => {
      const doc = this.snapshot(organizationId);
      if (!doc || !doc.members.some(m => m.userId === actorId && m.role === 'owner')) throw Error('Organization owner required');
      if (doc.revision !== expectedRevision) throw Error('Organization revision changed');
      change(doc); doc.revision++; return this.save(doc);
    });
  }
  setMember(organizationId: string, actorId: string, expectedRevision: number, userId: string, role: z.infer<typeof organizationRoleSchema>) {
    id.parse(userId); organizationRoleSchema.parse(role);
    return this.mutate(organizationId, actorId, expectedRevision, doc => { doc.members = doc.members.filter(m => m.userId !== userId); doc.members.push({ userId, role }); });
  }
  removeMember(organizationId: string, actorId: string, expectedRevision: number, userId: string) {
    id.parse(userId);
    return this.mutate(organizationId, actorId, expectedRevision, doc => {
      doc.members = doc.members.filter(m => m.userId !== userId);
      for (const team of doc.teams) team.members = team.members.filter(m => m !== userId);
      doc.grants = doc.grants.filter(g => !(g.subject.kind === 'user' && g.subject.id === userId));
      doc.invitations = doc.invitations.filter(i => i.userId !== userId);
    });
  }
  createTeam(organizationId: string, actorId: string, expectedRevision: number, teamId: string, name: string) {
    const team = teamSchema.parse({ id: teamId, name, members: [] });
    return this.mutate(organizationId, actorId, expectedRevision, doc => { if (doc.teams.some(t => t.id === teamId)) throw Error('Team already exists'); doc.teams.push(team); });
  }
  removeTeam(organizationId: string, actorId: string, expectedRevision: number, teamId: string) {
    id.parse(teamId);
    return this.mutate(organizationId, actorId, expectedRevision, doc => {
      doc.teams = doc.teams.filter(t => t.id !== teamId);
      for(const parent of doc.teams)parent.childTeams=parent.childTeams.filter(child=>child!==teamId);
      doc.grants = doc.grants.filter(g => !(g.subject.kind === 'team' && g.subject.id === teamId));
    });
  }
  setTeamMember(organizationId: string, actorId: string, expectedRevision: number, teamId: string, userId: string, present: boolean) {
    id.parse(teamId); id.parse(userId); z.boolean().parse(present);
    return this.mutate(organizationId, actorId, expectedRevision, doc => {
      const team = doc.teams.find(t => t.id === teamId); if (!team) throw Error('Team unavailable');
      if (present && !doc.members.some(m => m.userId === userId)) throw Error('Organization membership required');
      team.members = team.members.filter(m => m !== userId); if (present) team.members.push(userId);
    });
  }
  setTeamChild(organizationId:string,actorId:string,expectedRevision:number,teamId:string,childTeamId:string,present:boolean) {
    id.parse(teamId);id.parse(childTeamId);z.boolean().parse(present);
    return this.mutate(organizationId,actorId,expectedRevision,doc=>{
      const team=doc.teams.find(candidate=>candidate.id===teamId);
      if(!team||!doc.teams.some(candidate=>candidate.id===childTeamId))throw Error('Nested team unavailable');
      team.childTeams=team.childTeams.filter(child=>child!==childTeamId);
      if(present)team.childTeams.push(childTeamId);
    });
  }
  grantRepository(organizationId: string, actorId: string, expectedRevision: number, repositoryId: string, subject: OrganizationSubject, role: OrganizationRepositoryRole) {
    const grant = grantSchema.parse({ repositoryId, subject, role });
    return this.mutate(organizationId, actorId, expectedRevision, doc => {
      if (!doc.repositories.includes(repositoryId)) doc.repositories.push(repositoryId);
      if (subject.kind === 'team' && !doc.teams.some(t => t.id === subject.id)) throw Error('Team unavailable');
      doc.grants = doc.grants.filter(g => !(g.repositoryId === repositoryId && g.subject.kind === subject.kind && g.subject.id === subject.id)); doc.grants.push(grant);
    });
  }
  revokeRepositoryGrant(organizationId: string, actorId: string, expectedRevision: number, repositoryId: string, subject: OrganizationSubject) {
    id.parse(repositoryId); organizationSubjectSchema.parse(subject);
    return this.mutate(organizationId, actorId, expectedRevision, doc => { doc.grants = doc.grants.filter(g => !(g.repositoryId === repositoryId && g.subject.kind === subject.kind && g.subject.id === subject.id)); });
  }
  invite(organizationId: string, actorId: string, expectedRevision: number, invitation: z.infer<typeof invitationSchema>, now = Date.now()) {
    const value = invitationSchema.parse(invitation); this.validNow(now);
    if (value.expiresAt <= now || value.expiresAt > now + 30 * 86400000) throw Error('Invalid invitation expiry');
    return this.mutate(organizationId, actorId, expectedRevision, doc => { if (doc.invitations.some(i => i.id === value.id)) throw Error('Invitation already exists'); doc.invitations.push(value); });
  }
  revokeInvitation(organizationId: string, actorId: string, expectedRevision: number, invitationId: string) {
    id.parse(invitationId); return this.mutate(organizationId, actorId, expectedRevision, doc => { doc.invitations = doc.invitations.filter(i => i.id !== invitationId); });
  }
  acceptInvitation(organizationId: string, actorId: string, invitationId: string, now = Date.now()) {
    id.parse(actorId); id.parse(invitationId); this.validNow(now);
    return this.storage.transactionSync(() => {
      const doc = this.snapshot(organizationId), invitation = doc?.invitations.find(i => i.id === invitationId);
      if (!doc || !invitation || invitation.userId !== actorId || invitation.expiresAt <= now) throw Error('Invitation unavailable');
      const existing = doc.members.find(m => m.userId === actorId);
      if (!existing) doc.members.push({ userId: actorId, role: invitation.role });
      else if (invitation.role === 'owner') existing.role = 'owner';
      doc.invitations = doc.invitations.filter(i => i.id !== invitationId); doc.revision++; return this.save(doc);
    });
  }
  private validNow(now: number) { z.number().int().nonnegative().safe().parse(now); }
  resolveAccess(organizationId: string, repositoryId: string, userId: string): OrganizationAccessResolution | null {
    id.parse(repositoryId); id.parse(userId); const doc = this.snapshot(organizationId); if (!doc) return null;
    const sources: OrganizationAccessResolution['sources'] = [];
    const member = doc.members.find(m => m.userId === userId),teams=organizationTeamsFor(doc,userId);
    if (doc.repositories.includes(repositoryId) && member?.role === 'owner') sources.push({ kind: 'owner', id: userId, role: 'admin' });
    for (const grant of doc.grants.filter(g => g.repositoryId === repositoryId)) {
      if (grant.subject.kind === 'user' && grant.subject.id === userId) sources.push({ kind: 'user', id: userId, role: grant.role });
      if (member && grant.subject.kind === 'team' && teams.has(grant.subject.id)) sources.push({ kind: 'team', id: grant.subject.id, role: grant.role });
    }
    const ranks = { read: 1, write: 2, admin: 3 }; const role = sources.reduce<OrganizationRepositoryRole | null>((best, source) => !best || ranks[source.role] > ranks[best] ? source.role : best, null);
    return { organizationId, revision: doc.revision, role, sources };
  }
}
