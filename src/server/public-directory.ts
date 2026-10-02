import { z } from "zod";
import { safeSearchText } from "./metadata-search.js";
const repositoryId = z.string().regex(/^p?[0-9a-f]{12}$/);
export const directoryUpdateSchema = z.object({ enabled: z.boolean(), confirmed: z.literal(true), expectedVersion: z.number().int().nonnegative() }).strict();
export const directoryQuerySchema = z.object({ q: z.string().max(200).default(""), cursor: repositoryId.optional() }).strict();
export interface DirectoryRegistration { projectId: string; enabled: boolean; version: number }
export interface DirectoryState { enabled: boolean; version: number; delivery: "pending" | "delivered" }
export class PublicDirectory {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS public_directory_index(project_id TEXT PRIMARY KEY, version INTEGER NOT NULL, enabled INTEGER NOT NULL)");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS public_directory_registration(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL,version INTEGER NOT NULL,delivered_version INTEGER NOT NULL)");
  }
  state(): DirectoryState {
    const row = this.storage.sql.exec<{enabled:number;version:number;delivered_version:number}>("SELECT * FROM public_directory_registration WHERE id=1").toArray()[0];
    return { enabled: row?.enabled === 1, version: row?.version ?? 0, delivery: row && row.version !== row.delivered_version ? "pending" : "delivered" };
  }
  configure(input: unknown, publicNow: boolean): DirectoryState {
    const value = directoryUpdateSchema.parse(input);
    return this.storage.transactionSync(() => {
      const current = this.state();
      if (value.expectedVersion !== current.version) throw new Error("Directory settings changed; reload before saving");
      if (value.enabled && !publicNow) throw new Error("Only public repositories can join the directory");
      this.storage.sql.exec("INSERT INTO public_directory_registration VALUES(1,?,?,0) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,version=excluded.version", Number(value.enabled), current.version + 1);
      return this.state();
    });
  }
  pending(projectId: string): DirectoryRegistration | null {
    repositoryId.parse(projectId); const state = this.state();
    return state.delivery === "pending" ? {projectId, enabled: state.enabled, version: state.version} : null;
  }
  delivered(version: number): void { this.storage.sql.exec("UPDATE public_directory_registration SET delivered_version=? WHERE id=1 AND version=?",version,version); }
  register(input: DirectoryRegistration): void {
    repositoryId.parse(input.projectId); z.number().int().positive().parse(input.version); z.boolean().parse(input.enabled);
    this.storage.sql.exec("INSERT INTO public_directory_index VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled WHERE excluded.version>public_directory_index.version",input.projectId,input.version,Number(input.enabled));
  }
  page(cursor?: string): {rows: DirectoryRegistration[];nextCursor:string|null} {
    if(cursor)repositoryId.parse(cursor);
    const rows=this.storage.sql.exec<{project_id:string;version:number;enabled:number}>("SELECT * FROM public_directory_index WHERE enabled=1 AND project_id>? ORDER BY project_id LIMIT 21",cursor??"").toArray();
    return {rows:rows.slice(0,20).map(row=>({projectId:row.project_id,version:row.version,enabled:true})),nextCursor:rows.length>20?rows[19]!.project_id:null};
  }
}
interface PublicDirectoryRepository { directoryState():Promise<DirectoryState>; publicGrant():Promise<{name:string;version:number;acceptedCommit:string}|null> }
export async function projectPublicDirectory(input:{rows:DirectoryRegistration[];query:string;repository(id:string):PublicDirectoryRepository}) {
  const repositories:Array<{id:string;name:string;acceptedCommit:string;href:string}>=[];
  const publicationVersions = new Map<string, number>();
  let incomplete=false;
  const query=input.query.normalize("NFKC").toLocaleLowerCase("en-US").trim();
  for(const row of input.rows.slice(0,20)) {
    try {
      const repository=input.repository(row.projectId);
      const [directory,grant]=await Promise.all([repository.directoryState(),repository.publicGrant()]);
      if(!directory.enabled||directory.version!==row.version||!grant)continue;
      const name=safeSearchText(grant.name,160);
      if(!name.normalize("NFKC").toLocaleLowerCase("en-US").includes(query))continue;
      const [currentDirectory,currentGrant]=await Promise.all([repository.directoryState(),repository.publicGrant()]);
      if(!currentDirectory.enabled||currentDirectory.version!==directory.version||!currentGrant||currentGrant.version!==grant.version||currentGrant.acceptedCommit!==grant.acceptedCommit) {incomplete=true;continue;}
      publicationVersions.set(row.projectId, grant.version);
      repositories.push({id:row.projectId,name,acceptedCommit:grant.acceptedCommit,href:`/#/public/${row.projectId}`});
    }catch {incomplete=true;}
  }
  const currentRepositories:typeof repositories=[];
  for (const result of repositories) {
    try {
      const repository=input.repository(result.id), row=input.rows.find(item=>item.projectId===result.id)!;
      const [directory,grant]=await Promise.all([repository.directoryState(),repository.publicGrant()]);
      if(directory.enabled&&directory.version===row.version&&grant?.acceptedCommit===result.acceptedCommit&&grant.version===publicationVersions.get(result.id)&&safeSearchText(grant.name,160)===result.name)currentRepositories.push(result);
      else incomplete=true;
    }catch {incomplete=true;}
  }
  return {repositories:currentRepositories,incomplete,checked:Math.min(input.rows.length,20)};
}
