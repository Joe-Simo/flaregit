import {OrganizationAccessLedger,organizationTeamsFor} from './organization-access';
/** Canonical global grants produce candidate IDs only. No names, account
 * registry writes, memberships or token capabilities are created. */
export function inheritedRepositoryDiscovery(storage:DurableObjectStorage,userId:string){
 const docs=new OrganizationAccessLedger(storage).listForUser(userId).sort((a,b)=>a.id.localeCompare(b.id)),ids=new Set<string>();
 for(const doc of docs){const teams=organizationTeamsFor(doc,userId),owner=doc.members.some(member=>member.userId===userId&&member.role==='owner');const candidates=owner?doc.repositories:doc.grants.filter(grant=>grant.subject.kind==='user'?grant.subject.id===userId:teams.has(grant.subject.id)).map(grant=>grant.repositoryId);for(const id of candidates){if(!doc.repositories.includes(id))continue;ids.add(id);if(ids.size>1000)throw Error('Inherited repository discovery exceeds its supported inventory');}}
 return{ids:[...ids].sort(),epoch:JSON.stringify(docs.map(doc=>[doc.id,doc.revision]))};
}
