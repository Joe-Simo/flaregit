import type {ProjectRow} from './durable-object';
export class WorkspaceDiscoveryLimited extends Error{constructor(){super('Too many workspace repository requests; retry shortly');}}
export interface InheritedDiscovery{ids:string[];epoch:string}
export interface RepositoryDiscoveryCredential{personalTokenHash?:string;sessionExpiresAt?:number}
export interface RepositoryDiscoverySnapshot{project:ProjectRow;authorityEpoch:string}
interface Repository{repositoryDiscoverySnapshot(userId:string,credential?:RepositoryDiscoveryCredential):Promise<RepositoryDiscoverySnapshot|null>;assertRepositoryDiscovery(userId:string,authorityEpoch:string,credential?:RepositoryDiscoveryCredential):Promise<boolean>}
/** Candidate registries never authorize names. Each released projection is a
 * fresh, repository-local authority/identity/name observation. */
export async function discoverAccountRepositories(input:{userId:string;registered:()=>Promise<ProjectRow[]>;inherited:()=>Promise<InheritedDiscovery>;repository:(id:string)=>Repository;authorize:()=>Promise<void>;credential?:RepositoryDiscoveryCredential}){
 await input.authorize();const registered=await input.registered(),inherited=await input.inherited(),ids=[...new Set([...registered.map(row=>row.id),...inherited.ids])].sort();
 if(ids.length>1000)throw Error('Workspace repository discovery exceeds its supported inventory');
 const candidates=ids.filter(id=>/^[a-z0-9]{12,16}$/.test(id)),initial=new Map<string,RepositoryDiscoverySnapshot>();
 for(const id of candidates){const value=await input.repository(id).repositoryDiscoverySnapshot(input.userId,input.credential);if(value){if(value.project.id!==id)throw Error('Repository discovery identity changed');initial.set(id,value);}}
 await input.authorize();const latest=await input.inherited(),currentRegistered=await input.registered();if(latest.epoch!==inherited.epoch||JSON.stringify(latest.ids)!==JSON.stringify(inherited.ids)||JSON.stringify(currentRegistered.map(row=>row.id).sort())!==JSON.stringify(registered.map(row=>row.id).sort()))throw Error('Workspace repository authority changed; refresh discovery');
 await input.authorize();if((await input.inherited()).epoch!==inherited.epoch)throw Error('Inherited repository authority changed before release');
 const projected:RepositoryDiscoverySnapshot[]=[];
 for(const [id,old] of initial){const value=await input.repository(id).repositoryDiscoverySnapshot(input.userId,input.credential);if(!value)continue;if(value.project.id!==id||value.authorityEpoch!==old.authorityEpoch)throw Error('Repository discovery authority changed before release');projected.push(value);}
 const released:ProjectRow[]=[];for(const value of projected){if(await input.repository(value.project.id).assertRepositoryDiscovery(input.userId,value.authorityEpoch,input.credential))released.push(value.project);}return released;
}
